import { createClient } from "@/lib/supabase/server";
import {
  ATTRIBUTES,
  POSITIONS,
  MIN_TIMED_FOR_PERCENTILE,
  type AttributeKey,
  type PositionKey,
} from "@/lib/config/positions";
import {
  computePositionRating,
  missingComponents,
  type AttributeRatings,
  type PositionRating,
} from "@/lib/ratings";

/** One officer's rating of one attribute, for the "who rated" dropdown. */
export type RaterEntry = {
  officerId: string;
  displayName: string;
  value: number;
};

export type AttributeDetail = {
  key: AttributeKey;
  label: string;
  /** Median across officers, 0-10. Null when nobody has rated it. */
  teamRating: number | null;
  raterCount: number;
  /** This officer's own rating, which is what the slider is bound to. */
  myValue: number | null;
  raters: RaterEntry[];
};

export type ProspectDetail = {
  id: string;
  jerseyNumber: number;
  firstName: string;
  lastName: string;
  fullName: string;
  primaryPosition: PositionKey;
  secondaryPositions: PositionKey[];
  headshotUrl: string | null;
  /** Union of attributes across every position this prospect plays. */
  attributes: AttributeDetail[];
  /** Rating per position played, primary first. */
  positionRatings: { position: PositionKey; rating: PositionRating; missing: string[] }[];
  bestForty: number | null;
  avgForty: number | null;
  speedPercentile: number | null;
  /** False until enough of the class is timed for a percentile to mean anything. */
  percentileIsValid: boolean;
};

function isPositionKey(v: unknown): v is PositionKey {
  return typeof v === "string" && v in POSITIONS;
}

export async function getProspectDetail(
  prospectId: string,
  officerId: string,
): Promise<ProspectDetail | null> {
  const supabase = await createClient();

  const { data: p } = await supabase
    .from("prospects")
    .select(
      "id, tryout_id, jersey_number, first_name, last_name, primary_position, secondary_positions, headshot_url",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (!p || !isPositionKey(p.primary_position)) return null;

  const [{ data: aggRows }, { data: rawRatings }, { data: speed }] =
    await Promise.all([
      supabase
        .from("prospect_attribute_ratings")
        .select("attribute_key, team_rating, rater_count")
        .eq("prospect_id", prospectId),
      // Every officer's individual rating, for the "who rated" dropdown.
      // SPEC.md section 8: an 8.4 from one officer and an 8.4 from nine are
      // not the same fact, and the UI must not pretend otherwise.
      supabase
        .from("ratings")
        .select("attribute_key, value, officer_id, officers(display_name)")
        .eq("prospect_id", prospectId),
      supabase
        .from("prospect_speed")
        .select("best_forty, avg_forty, speed_percentile, timed_count")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
    ]);

  const secondaryPositions = (p.secondary_positions ?? []).filter(isPositionKey);
  const playedPositions: PositionKey[] = [p.primary_position, ...secondaryPositions];

  // Union of attributes across all positions played. Shared attributes like
  // quickness appear once and count toward every position that uses them.
  const attrKeys: AttributeKey[] = [];
  for (const pos of playedPositions) {
    for (const a of POSITIONS[pos].attributes) {
      if (!attrKeys.includes(a)) attrKeys.push(a);
    }
  }

  const agg = new Map(
    (aggRows ?? []).map((r) => [
      r.attribute_key,
      { teamRating: Number(r.team_rating), raterCount: Number(r.rater_count) },
    ]),
  );

  const ratersByAttr = new Map<string, RaterEntry[]>();
  const myRatings = new Map<string, number>();
  for (const r of rawRatings ?? []) {
    const officer = r.officers as unknown as { display_name: string } | null;
    const list = ratersByAttr.get(r.attribute_key) ?? [];
    list.push({
      officerId: r.officer_id,
      displayName: officer?.display_name ?? "Unknown officer",
      value: Number(r.value),
    });
    ratersByAttr.set(r.attribute_key, list);
    if (r.officer_id === officerId) {
      myRatings.set(r.attribute_key, Number(r.value));
    }
  }

  const attributes: AttributeDetail[] = attrKeys.map((key) => {
    const a = agg.get(key);
    return {
      key,
      label: ATTRIBUTES[key].label,
      teamRating: a ? a.teamRating : null,
      raterCount: a ? a.raterCount : 0,
      myValue: myRatings.get(key) ?? null,
      raters: (ratersByAttr.get(key) ?? []).sort((x, y) => y.value - x.value),
    };
  });

  const timedCount = Number(speed?.timed_count ?? 0);
  const percentileIsValid = timedCount >= MIN_TIMED_FOR_PERCENTILE;
  const speedPercentile =
    percentileIsValid && speed?.speed_percentile != null
      ? Number(speed.speed_percentile)
      : null;

  const attributeRatings: AttributeRatings = {};
  for (const a of attributes) {
    if (a.teamRating !== null) {
      attributeRatings[a.key] = {
        teamRating: a.teamRating,
        raterCount: a.raterCount,
      };
    }
  }

  return {
    id: p.id,
    jerseyNumber: p.jersey_number,
    firstName: p.first_name,
    lastName: p.last_name,
    fullName: `${p.first_name} ${p.last_name}`,
    primaryPosition: p.primary_position,
    secondaryPositions,
    headshotUrl: p.headshot_url,
    attributes,
    positionRatings: playedPositions.map((position) => ({
      position,
      rating: computePositionRating(position, attributeRatings, speedPercentile),
      missing: missingComponents(position, attributeRatings, speedPercentile),
    })),
    bestForty: speed?.best_forty != null ? Number(speed.best_forty) : null,
    avgForty: speed?.avg_forty != null ? Number(speed.avg_forty) : null,
    speedPercentile,
    percentileIsValid,
  };
}
