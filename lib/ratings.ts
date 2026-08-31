import {
  POSITIONS,
  MIN_RATINGS_FOR_DISPLAY,
  type AttributeKey,
  type PositionKey,
} from "@/lib/config/positions";

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
 * Keyed by attribute. Sparse on purpose - an attribute nobody has rated
 * yet is absent, not zero. A zero would be a real rating of 0.0.
 */
export type AttributeRatings = Partial<Record<AttributeKey, AttributeRating>>;

export type PositionRating = {
  /** 45-99 display band, or null when the position is not fully covered. */
  rating: number | null;
  /** Uncompressed 0-100 score. SORT ON THIS, never on `rating`. */
  raw: number | null;
  /** Total officer inputs across this position's judged attributes. */
  inputs: number;
  /** How many required components have data. */
  covered: number;
  /** Judged attributes + speed. */
  required: number;
};

/**
 * Weighted positional rating - SPEC.md section 8.
 *
 * Weights live in lib/config/positions.ts and nowhere else. SQL does the
 * window functions (medians, percentiles); this does the weighting.
 *
 * Gating is deliberate and matters more than the formula. Prospects who
 * show up early or stand near the officers get rated more, so a
 * barely-rated 91 sitting above a fully-vetted 84 cuts the wrong player.
 * When a position is not fully covered this returns null and the caller
 * shows progress instead.
 *
 * @param speedPercentile 0-100 within the tryout class, or null when the
 *   prospect has no 40 time, or when fewer than MIN_TIMED_FOR_PERCENTILE
 *   prospects have one and the percentile is not yet meaningful.
 */
export function computePositionRating(
  position: PositionKey,
  attributeRatings: AttributeRatings,
  speedPercentile: number | null,
): PositionRating {
  const cfg = POSITIONS[position];

  const required = cfg.attributes.length + 1; // judged attributes + speed
  const covered =
    cfg.attributes.filter((a) => attributeRatings[a]).length +
    (speedPercentile !== null ? 1 : 0);
  const inputs = cfg.attributes.reduce(
    (sum, a) => sum + (attributeRatings[a]?.raterCount ?? 0),
    0,
  );

  // Gate: every component present AND enough total officer inputs.
  if (covered < required || inputs < MIN_RATINGS_FOR_DISPLAY) {
    return { rating: null, raw: null, inputs, covered, required };
  }

  let raw = 0;
  for (const attr of cfg.attributes) {
    // teamRating is 0-10; lift to 0-100 so it shares a scale with the
    // speed percentile before weighting.
    raw += attributeRatings[attr]!.teamRating * 10 * (cfg.weights[attr]! / 100);
  }
  raw += speedPercentile! * (cfg.weights.speed! / 100);

  // Compress 0-100 into a 45-99 display band so it reads like a football
  // rating. Cosmetic, and it squeezes real differences between prospects -
  // which is exactly why sorting uses `raw`.
  const display = Math.round(45 + (raw / 100) * 54);

  return { rating: display, raw, inputs, covered, required };
}

/**
 * Board ordering - SPEC.md sections 8 and 10.1.
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
 * UI shows in place of a gated rating - e.g. "4 of 6 inputs - missing
 * route running".
 */
export function missingComponents(
  position: PositionKey,
  attributeRatings: AttributeRatings,
  speedPercentile: number | null,
): string[] {
  const cfg = POSITIONS[position];
  const missing = cfg.attributes
    .filter((a) => !attributeRatings[a])
    .map((a) => a.replace(/_/g, " "));
  if (speedPercentile === null) missing.push("40 time");
  return missing;
}
