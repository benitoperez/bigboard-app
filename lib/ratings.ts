import {
  componentLabel,
  getPosition,
  type Template,
} from "@/lib/template";

/**
 * The team's rating for one attribute, as produced by the
 * `prospect_attribute_ratings` view: a median across officers plus how
 * many officers weighed in.
 */
export type AttributeRating = {
  teamRating: number;   // median of officer ratings, 0-10
  raterCount: number;   // how many officers rated it
};

/**
 * Keyed by attribute key. Sparse on purpose - an attribute nobody has rated
 * yet is absent, not zero. A zero would be a real rating of 0.0.
 */
export type AttributeRatings = Record<string, AttributeRating | undefined>;

/**
 * Percentile per drill key, 0-100 within the tryout class. Null when the
 * prospect has no result, or when fewer than the drill's
 * minTimedForPercentile prospects have one and the percentile is not yet
 * meaningful. Sparse, same reasoning as AttributeRatings.
 */
export type DrillPercentiles = Record<string, number | null | undefined>;

export type PositionRating = {
  /** 45-99 display band, or null when the position is not fully covered. */
  rating: number | null;
  /** Uncompressed 0-100 score. SORT ON THIS, never on `rating`. */
  raw: number | null;
  /** Total officer inputs across this position's judged attributes. */
  inputs: number;
  /** How many required components have data. */
  covered: number;
  /** Every weighted component: judged attributes + measured drills. */
  required: number;
};

/**
 * Weighted positional rating - SPEC.md section 8, generalized by
 * SPEC-V2.md section 3.3.
 *
 * The MATH IS UNCHANGED from v1. What changed is where the config comes
 * from (org-owned database rows, not a TypeScript constant) and that speed
 * is no longer a hardcoded special case - a position may weight any number
 * of measured drills, each exactly like the old `speed` term.
 *
 * SQL still does the window functions (medians, percentiles); this still
 * does the weighting. One source of truth for weights, it just moved.
 *
 * Gating is deliberate and matters more than the formula. Prospects who
 * show up early or stand near the officers get rated more, so a
 * barely-rated 91 sitting above a fully-vetted 84 cuts the wrong player.
 * When a position is not fully covered this returns null and the caller
 * shows progress instead.
 */
export function computePositionRating(
  template: Template,
  positionCode: string,
  attributeRatings: AttributeRatings,
  drillPercentiles: DrillPercentiles,
): PositionRating {
  const cfg = getPosition(template, positionCode);
  if (!cfg) {
    return { rating: null, raw: null, inputs: 0, covered: 0, required: 0 };
  }

  const required = cfg.components.length;

  const has = (c: (typeof cfg.components)[number]) =>
    c.kind === "attribute"
      ? attributeRatings[c.key] !== undefined
      : drillPercentiles[c.key] != null;

  const covered = cfg.components.filter(has).length;

  const inputs = cfg.components.reduce(
    (sum, c) =>
      c.kind === "attribute"
        ? sum + (attributeRatings[c.key]?.raterCount ?? 0)
        : sum,
    0,
  );

  // Gate: every component present AND enough total officer inputs.
  if (covered < required || inputs < template.minRatingsForDisplay) {
    return { rating: null, raw: null, inputs, covered, required };
  }

  let raw = 0;
  for (const c of cfg.components) {
    if (c.kind === "attribute") {
      // teamRating is 0-10; lift to 0-100 so it shares a scale with the
      // drill percentiles before weighting.
      raw += attributeRatings[c.key]!.teamRating * 10 * (c.weight / 100);
    } else {
      // Percentile is already 0-100 and already direction-aware: the view
      // orders it so 100 is always the best in the class, whether the drill
      // is lower_is_better or higher_is_better.
      raw += drillPercentiles[c.key]! * (c.weight / 100);
    }
  }

  // Compress 0-100 into a 45-99 display band so it reads like a sports
  // rating. Cosmetic, and it squeezes real differences between prospects -
  // which is exactly why sorting uses `raw`.
  const display = Math.round(45 + (raw / 100) * 54);

  return { rating: display, raw, inputs, covered, required };
}

/**
 * Board ordering - SPEC.md sections 8 and 10.1. Unchanged in v2.
 *
 * Sorts on `raw`, NEVER on the 45-99 display band. The band compresses real
 * differences, so two prospects can share a display number while one is
 * genuinely ahead; sorting on the display value would present that as a tie
 * and order them arbitrarily.
 *
 * Gated prospects (raw === null) sort to the bottom rather than being
 * hidden, so officers can see who still needs eyes on them. Among themselves
 * they order by jersey number, which is stable - two gated prospects have no
 * meaningful ranking and should not appear to.
 */
export function compareForBoard(
  a: { raw: number | null; jerseyNumber: number },
  b: { raw: number | null; jerseyNumber: number },
): number {
  if (a.raw === null && b.raw === null) return a.jerseyNumber - b.jerseyNumber;
  if (a.raw === null) return 1;
  if (b.raw === null) return -1;
  if (a.raw !== b.raw) return b.raw - a.raw;
  return a.jerseyNumber - b.jerseyNumber; // stable tiebreak
}

/**
 * Which required components are still missing, for the progress label the
 * UI shows in place of a gated rating - e.g. "5 of 8 inputs - missing exit
 * velocity". Drill components name the drill, so an untimed prospect reads
 * "missing 40 yard dash" rather than v1's hardcoded "40 time".
 */
export function missingComponents(
  template: Template,
  positionCode: string,
  attributeRatings: AttributeRatings,
  drillPercentiles: DrillPercentiles,
): string[] {
  const cfg = getPosition(template, positionCode);
  if (!cfg) return [];

  return cfg.components
    .filter((c) =>
      c.kind === "attribute"
        ? attributeRatings[c.key] === undefined
        : drillPercentiles[c.key] == null,
    )
    .map((c) => componentLabel(template, c).toLowerCase());
}
