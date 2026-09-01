import { createClient } from "@/lib/supabase/server";
import { signHeadshots } from "@/lib/data/storage";
import { getTemplateForTryout } from "@/lib/data/template";
import {
  attributeUnion,
  drillUnion,
  isPositionCode,
  type Template,
  type TemplateDrill,
} from "@/lib/template";
import {
  computePositionRating,
  missingComponents,
  type AttributeRatings,
  type DrillPercentiles,
  type PositionRating,
} from "@/lib/ratings";

/** One officer's rating of one attribute, for the "who rated" dropdown. */
export type RaterEntry = {
  officerId: string;
  displayName: string;
  value: number;
};

export type AttributeDetail = {
  key: string;
  label: string;
  short: string;
  /** Median across officers, 0-10. Null when nobody has rated it. */
  teamRating: number | null;
  raterCount: number;
  /** This officer's own rating, which is what the slider is bound to. */
  myValue: number | null;
  raters: RaterEntry[];
};

/**
 * One measured drill on the profile: the template's definition, this
 * prospect's attempts, and where those land in the class.
 */
export type DrillDetail = {
  drill: TemplateDrill;
  /** Best attempt: minimum for lower_is_better, maximum otherwise. */
  best: number | null;
  avg: number | null;
  /** Null until enough of the class has done this drill. */
  percentile: number | null;
  /** False while the class is below the drill's threshold. */
  percentileIsValid: boolean;
  /** How many prospects have a result, for the gating message. */
  measuredCount: number;
  /** Individual attempts, up to the drill's maxAttempts. */
  attempts: { attemptNumber: number; value: number }[];
};

export type ProspectDetail = {
  id: string;
  tryoutId: string;
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
  /** Union of attributes across every position this prospect plays. */
  attributes: AttributeDetail[];
  /** The measured drills that count for the positions this prospect plays. */
  drills: DrillDetail[];
  /** Rating per position played, primary first. */
  positionRatings: { position: string; label: string; rating: PositionRating; missing: string[] }[];
};

export type ProspectDetailResult = {
  template: Template;
  prospect: ProspectDetail;
};

export async function getProspectDetail(
  prospectId: string,
  officerId: string,
): Promise<ProspectDetailResult | null> {
  const supabase = await createClient();

  const { data: p } = await supabase
    .from("prospects")
    .select(
      "id, tryout_id, jersey_number, first_name, last_name, primary_position, secondary_positions, headshot_url",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (!p) return null;

  const template = await getTemplateForTryout(p.tryout_id);
  if (!template || !isPositionCode(template, p.primary_position)) return null;

  const [
    { data: aggRows },
    { data: rawRatings },
    { data: statRows },
    { data: attemptRows },
  ] = await Promise.all([
    supabase
      .from("prospect_attribute_ratings")
      .select("attribute_key, team_rating, rater_count")
      .eq("prospect_id", prospectId),
    // Every officer's individual rating, for the "who rated" dropdown.
    // SPEC.md section 8: an 8.4 from one officer and an 8.4 from nine are
    // not the same fact, and the UI must not pretend otherwise.
    supabase
      .from("ratings")
      .select("attribute_key, value, officer_id, profiles(display_name)")
      .eq("prospect_id", prospectId),
    // One row per drill this prospect has attempted.
    supabase
      .from("prospect_drill_stats")
      .select("drill_key, best, avg_value, percentile, measured_count")
      .eq("prospect_id", prospectId),
    // Every attempt across every drill, in one query rather than one per
    // drill - a template may define several.
    supabase
      .from("drill_results")
      .select("drill_key, attempt_number, value")
      .eq("prospect_id", prospectId)
      .order("attempt_number", { ascending: true }),
  ]);

  const secondaryPositions = (p.secondary_positions ?? []).filter(
    (s: unknown): s is string => isPositionCode(template, s),
  );
  const playedPositions = [p.primary_position, ...secondaryPositions];

  // Union of attributes across all positions played. Shared attributes like
  // quickness appear once and count toward every position that uses them.
  // This is also what covers baseball two-way players: P plus a field
  // position simply unions to both component sets, no new mechanics.
  const unionAttributes = attributeUnion(template, playedPositions);
  const unionDrills = drillUnion(template, playedPositions);

  const agg = new Map(
    (aggRows ?? []).map((r) => [
      r.attribute_key,
      { teamRating: Number(r.team_rating), raterCount: Number(r.rater_count) },
    ]),
  );

  const ratersByAttr = new Map<string, RaterEntry[]>();
  const myRatings = new Map<string, number>();
  for (const r of rawRatings ?? []) {
    const officer = r.profiles as unknown as { display_name: string } | null;
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

  const attributes: AttributeDetail[] = unionAttributes.map((a) => {
    const agged = agg.get(a.key);
    return {
      key: a.key,
      label: a.label,
      short: a.short,
      teamRating: agged ? agged.teamRating : null,
      raterCount: agged ? agged.raterCount : 0,
      myValue: myRatings.get(a.key) ?? null,
      raters: (ratersByAttr.get(a.key) ?? []).sort((x, y) => y.value - x.value),
    };
  });

  const statByDrill = new Map((statRows ?? []).map((s) => [s.drill_key, s]));

  const drills: DrillDetail[] = unionDrills.map((drill) => {
    const stat = statByDrill.get(drill.key);
    const measuredCount = Number(stat?.measured_count ?? 0);
    // SPEC-V2.md section 3.2: the threshold is per drill. A class can have
    // plenty of 40 times and almost no exit velocities, and each percentile
    // becomes meaningful on its own schedule.
    const percentileIsValid = measuredCount >= drill.minTimedForPercentile;

    return {
      drill,
      best: stat?.best != null ? Number(stat.best) : null,
      avg: stat?.avg_value != null ? Number(stat.avg_value) : null,
      percentile:
        percentileIsValid && stat?.percentile != null
          ? Number(stat.percentile)
          : null,
      percentileIsValid,
      measuredCount,
      attempts: (attemptRows ?? [])
        .filter((a) => a.drill_key === drill.key)
        .map((a) => ({
          attemptNumber: a.attempt_number,
          value: Number(a.value),
        })),
    };
  });

  const signed = await signHeadshots([p.headshot_url]);

  const attributeRatings: AttributeRatings = {};
  for (const a of attributes) {
    if (a.teamRating !== null) {
      attributeRatings[a.key] = {
        teamRating: a.teamRating,
        raterCount: a.raterCount,
      };
    }
  }

  const drillPercentiles: DrillPercentiles = {};
  for (const d of drills) drillPercentiles[d.drill.key] = d.percentile;

  return {
    template,
    prospect: {
      id: p.id,
      tryoutId: p.tryout_id,
      jerseyNumber: p.jersey_number,
      firstName: p.first_name,
      lastName: p.last_name,
      fullName: `${p.first_name} ${p.last_name}`,
      primaryPosition: p.primary_position,
      secondaryPositions,
      headshotUrl: p.headshot_url ? (signed.get(p.headshot_url) ?? null) : null,
      headshotPath: p.headshot_url ?? null,
      attributes,
      drills,
      positionRatings: playedPositions.map((position) => ({
        position,
        label:
          template.positions.find((tp) => tp.code === position)?.label ??
          position,
        rating: computePositionRating(
          template,
          position,
          attributeRatings,
          drillPercentiles,
        ),
        missing: missingComponents(
          template,
          position,
          attributeRatings,
          drillPercentiles,
        ),
      })),
    },
  };
}
