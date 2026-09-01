import { createClient } from "@/lib/supabase/server";
import { signHeadshots } from "@/lib/data/storage";
import { getTemplateForTryout } from "@/lib/data/template";
import { isPositionCode, type Template } from "@/lib/template";
import {
  computePositionRating,
  missingComponents,
  type AttributeRatings,
  type DrillPercentiles,
  type PositionRating,
} from "@/lib/ratings";

/** One prospect's result in a measured drill, from prospect_drill_stats. */
export type DrillStat = {
  /** Best attempt: the minimum for a lower_is_better drill, max otherwise. */
  best: number;
  avg: number;
  attempts: number;
  /**
   * 0-100 within the tryout class, where 100 is always best regardless of
   * direction. Null until the drill's minTimedForPercentile is met.
   */
  percentile: number | null;
};

export type ProspectRow = {
  id: string;
  jerseyNumber: number;
  firstName: string;
  lastName: string;
  fullName: string;
  primaryPosition: string;
  secondaryPositions: string[];
  /** Signed, render-ready URL. Null when there is no headshot. */
  headshotUrl: string | null;
  /** Underlying storage path, for replace/remove. */
  headshotPath: string | null;
  /** Rating at the prospect's PRIMARY position - what the directory shows. */
  primary: PositionRating;
  /**
   * Rating at EVERY position this prospect plays. A prospect trying out at
   * WR and DB belongs on both boards, carrying a different number on each,
   * because the weights differ per position.
   */
  ratingsByPosition: Record<string, PositionRating>;
  /** Every position played, primary first. */
  playedPositions: string[];
  /** What is still missing, for the progress label when primary.rating is null. */
  missing: string[];
  /** Keyed by drill key. Sparse: an unmeasured drill is absent. */
  drills: Record<string, DrillStat>;
  /** Percentiles alone, gated by each drill's threshold. Feeds the rating. */
  drillPercentiles: DrillPercentiles;
  attributeRatings: AttributeRatings;
};

export type ProspectsResult = {
  /** Null when the tryout has no readable template (wrong org, or deleted). */
  template: Template | null;
  prospects: ProspectRow[];
};

/**
 * Every prospect in a tryout with their positional ratings already computed.
 *
 * Four queries rather than one join: the views aggregate at different grains
 * (one row per prospect per attribute, one per prospect per drill, one per
 * prospect), so joining them in SQL would fan out the prospect rows and
 * force a de-duplication pass anyway. At 60-120 prospects this is a handful
 * of small round trips, which SPEC.md section 1 explicitly prefers over
 * cleverness.
 *
 * Everything is RLS-scoped, so this returns only what the caller's org
 * membership allows - cross-org isolation is enforced by the database, not
 * by remembering to filter here.
 */
export async function getProspects(tryoutId: string): Promise<ProspectsResult> {
  const supabase = await createClient();

  const template = await getTemplateForTryout(tryoutId);
  if (!template) return { template: null, prospects: [] };

  const [{ data: prospects }, { data: attrRows }, { data: drillRows }] =
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
        .from("prospect_drill_stats")
        .select(
          "prospect_id, drill_key, best, avg_value, attempts, percentile, measured_count",
        )
        .eq("tryout_id", tryoutId),
    ]);

  if (!prospects) return { template, prospects: [] };

  // Private bucket: paths become signed URLs in one batch, not per row.
  const signed = await signHeadshots(prospects.map((p) => p.headshot_url));

  // Group attribute ratings by prospect.
  const byProspect = new Map<string, AttributeRatings>();
  for (const r of attrRows ?? []) {
    const existing = byProspect.get(r.prospect_id) ?? {};
    existing[r.attribute_key] = {
      teamRating: Number(r.team_rating),
      raterCount: Number(r.rater_count),
    };
    byProspect.set(r.prospect_id, existing);
  }

  // SPEC-V2.md section 3.2: a percentile is meaningless until enough of the
  // class has done that drill, and the threshold is PER DRILL - a class can
  // have plenty of 40 times and almost no exit velocities. Below the
  // threshold the component counts as missing, which gates the rating,
  // deliberately: a rating built on a meaningless percentile is worse than
  // no rating.
  const measuredPerDrill = new Map<string, number>();
  for (const d of drillRows ?? []) {
    measuredPerDrill.set(d.drill_key, Number(d.measured_count));
  }
  const percentileIsValid = new Map<string, boolean>();
  for (const drill of template.drills) {
    percentileIsValid.set(
      drill.key,
      (measuredPerDrill.get(drill.key) ?? 0) >= drill.minTimedForPercentile,
    );
  }

  const drillsByProspect = new Map<string, Record<string, DrillStat>>();
  for (const d of drillRows ?? []) {
    const existing = drillsByProspect.get(d.prospect_id) ?? {};
    existing[d.drill_key] = {
      best: Number(d.best),
      avg: Number(d.avg_value),
      attempts: Number(d.attempts),
      percentile:
        percentileIsValid.get(d.drill_key) && d.percentile != null
          ? Number(d.percentile)
          : null,
    };
    drillsByProspect.set(d.prospect_id, existing);
  }

  const rows = prospects.flatMap((p): ProspectRow[] => {
    // A position code that is not in the template is data corruption, not a
    // display problem. Drop the row rather than crash the whole screen.
    if (!isPositionCode(template, p.primary_position)) return [];

    const secondaryPositions = (p.secondary_positions ?? []).filter(
      (s: unknown): s is string => isPositionCode(template, s),
    );
    const attributeRatings = byProspect.get(p.id) ?? {};
    const drills = drillsByProspect.get(p.id) ?? {};

    const drillPercentiles: DrillPercentiles = {};
    for (const drill of template.drills) {
      drillPercentiles[drill.key] = drills[drill.key]?.percentile ?? null;
    }

    const playedPositions = [p.primary_position, ...secondaryPositions];
    const ratingsByPosition: Record<string, PositionRating> = {};
    for (const pos of playedPositions) {
      ratingsByPosition[pos] = computePositionRating(
        template,
        pos,
        attributeRatings,
        drillPercentiles,
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
        headshotUrl: p.headshot_url ? (signed.get(p.headshot_url) ?? null) : null,
        headshotPath: p.headshot_url ?? null,
        primary: ratingsByPosition[p.primary_position]!,
        ratingsByPosition,
        playedPositions,
        missing: missingComponents(
          template,
          p.primary_position,
          attributeRatings,
          drillPercentiles,
        ),
        drills,
        drillPercentiles,
        attributeRatings,
      },
    ];
  });

  return { template, prospects: rows };
}
