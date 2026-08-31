import { createClient } from "@/lib/supabase/server";
import {
  POSITIONS,
  MIN_TIMED_FOR_PERCENTILE,
  type PositionKey,
} from "@/lib/config/positions";
import {
  computePositionRating,
  missingComponents,
  type AttributeRatings,
  type PositionRating,
} from "@/lib/ratings";

export type Tryout = {
  id: string;
  name: string;
  tryout_date: string;
};

export type ProspectRow = {
  id: string;
  jerseyNumber: number;
  firstName: string;
  lastName: string;
  fullName: string;
  primaryPosition: PositionKey;
  secondaryPositions: PositionKey[];
  headshotUrl: string | null;
  /** Rating at the prospect's PRIMARY position - what the directory shows. */
  primary: PositionRating;
  /**
   * Rating at EVERY position this prospect plays. A prospect trying out at
   * WR and DB belongs on both boards, carrying a different number on each,
   * because the weights differ per position.
   */
  ratingsByPosition: Partial<Record<PositionKey, PositionRating>>;
  /** Every position played, primary first. */
  playedPositions: PositionKey[];
  /** What is still missing, for the progress label when primary.rating is null. */
  missing: string[];
  bestForty: number | null;
  avgForty: number | null;
  speedPercentile: number | null;
  attributeRatings: AttributeRatings;
};

function isPositionKey(v: unknown): v is PositionKey {
  return typeof v === "string" && v in POSITIONS;
}

export async function getActiveTryout(): Promise<Tryout | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tryouts")
    .select("id, name, tryout_date")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Every prospect in a tryout with their positional rating already computed.
 *
 * Three queries rather than one join: the two views aggregate at different
 * grains (one row per prospect per attribute vs one row per prospect), so
 * joining them in SQL would fan out the prospect rows and force a
 * de-duplication pass anyway. At 60-120 prospects this is three small round
 * trips, which SPEC.md section 1 explicitly prefers over cleverness.
 */
export async function getProspects(tryoutId: string): Promise<ProspectRow[]> {
  const supabase = await createClient();

  const [{ data: prospects }, { data: attrRows }, { data: speedRows }] =
    await Promise.all([
      supabase
        .from("prospects")
        .select(
          "id, jersey_number, first_name, last_name, primary_position, secondary_positions, headshot_url",
        )
        .eq("tryout_id", tryoutId)
        .order("jersey_number", { ascending: true }),
      supabase
        .from("prospect_attribute_ratings")
        .select("prospect_id, attribute_key, team_rating, rater_count"),
      supabase
        .from("prospect_speed")
        .select(
          "prospect_id, best_forty, avg_forty, speed_percentile, timed_count",
        )
        .eq("tryout_id", tryoutId),
    ]);

  if (!prospects) return [];

  // Group attribute ratings by prospect.
  const byProspect = new Map<string, AttributeRatings>();
  for (const r of attrRows ?? []) {
    const existing = byProspect.get(r.prospect_id) ?? {};
    existing[r.attribute_key as keyof AttributeRatings] = {
      teamRating: Number(r.team_rating),
      raterCount: Number(r.rater_count),
    };
    byProspect.set(r.prospect_id, existing);
  }

  const speedByProspect = new Map(
    (speedRows ?? []).map((s) => [s.prospect_id, s]),
  );

  // SPEC.md section 8: the percentile is meaningless until enough of the
  // class has been timed. Below the threshold speed counts as missing, which
  // gates every rating - deliberately, because a rating built on a
  // meaningless percentile is worse than no rating.
  const timedCount = Number(speedRows?.[0]?.timed_count ?? 0);
  const percentileIsValid = timedCount >= MIN_TIMED_FOR_PERCENTILE;

  return prospects.flatMap((p): ProspectRow[] => {
    // A position code that is not in the config is data corruption, not a
    // display problem. Drop the row rather than crash the whole screen.
    if (!isPositionKey(p.primary_position)) return [];

    const secondaryPositions = (p.secondary_positions ?? []).filter(
      isPositionKey,
    );
    const attributeRatings = byProspect.get(p.id) ?? {};
    const speed = speedByProspect.get(p.id);

    const speedPercentile =
      percentileIsValid && speed?.speed_percentile != null
        ? Number(speed.speed_percentile)
        : null;

    const playedPositions: PositionKey[] = [
      p.primary_position,
      ...secondaryPositions,
    ];
    const ratingsByPosition: Partial<Record<PositionKey, PositionRating>> = {};
    for (const pos of playedPositions) {
      ratingsByPosition[pos] = computePositionRating(
        pos,
        attributeRatings,
        speedPercentile,
      );
    }

    return [
      {
        id: p.id,
        jerseyNumber: p.jersey_number,
        firstName: p.first_name,
        lastName: p.last_name,
        fullName: `${p.first_name} ${p.last_name}`,
        primaryPosition: p.primary_position,
        secondaryPositions,
        headshotUrl: p.headshot_url,
        primary: ratingsByPosition[p.primary_position]!,
        ratingsByPosition,
        playedPositions,
        missing: missingComponents(
          p.primary_position,
          attributeRatings,
          speedPercentile,
        ),
        bestForty: speed?.best_forty != null ? Number(speed.best_forty) : null,
        avgForty: speed?.avg_forty != null ? Number(speed.avg_forty) : null,
        speedPercentile,
        attributeRatings,
      },
    ];
  });
}
