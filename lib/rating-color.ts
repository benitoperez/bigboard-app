/**
 * Rating color scale - SPEC.md section 14.
 *
 * ONE pure function maps a number to a color. Every dial, row, and circle in
 * the app goes through it. Never hand-pick a rating color at a call site: the
 * moment two places decide independently what "good" looks like, the boards
 * stop being comparable at a glance, which is the entire job of this screen.
 *
 * | Range    | Color        |
 * |----------|--------------|
 * | 90+      | deep green   |
 * | 80 - 89  | medium green |
 * | 75 - 79  | pale green   |
 * | 70 - 74  | yellow       |
 * | 60 - 69  | orange       |
 * | below 60 | red          |
 * | not rated| neutral gray |
 *
 * Bands are expressed as `>=` in descending order, so the scale is continuous
 * and a fractional value cannot fall through a gap between bands.
 */

export type RatingBand =
  | "elite"
  | "high"
  | "good"
  | "mid"
  | "low"
  | "poor"
  | "none";

export function ratingBand(rating: number | null | undefined): RatingBand {
  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return "none";
  }
  if (rating >= 90) return "elite";
  if (rating >= 80) return "high";
  if (rating >= 75) return "good";
  if (rating >= 70) return "mid";
  if (rating >= 60) return "low";
  return "poor";
}

/** CSS custom property per band. Defined once in app/globals.css. */
const BAND_VAR: Record<RatingBand, string> = {
  elite: "var(--color-rating-elite)",
  high: "var(--color-rating-high)",
  good: "var(--color-rating-good)",
  mid: "var(--color-rating-mid)",
  low: "var(--color-rating-low)",
  poor: "var(--color-rating-poor)",
  none: "var(--color-rating-none)",
};

/**
 * A CSS color value, for SVG `stroke` and inline styles.
 *
 * Returns a var() reference rather than a hex literal so the palette stays
 * defined in exactly one place and re-themes without touching this file.
 */
export function ratingColor(rating: number | null | undefined): string {
  return BAND_VAR[ratingBand(rating)];
}

/**
 * Attribute ratings are 0-10; the scale above is 0-100. Lifting here rather
 * than at each call site means nobody has to remember which scale they hold.
 */
export function attributeColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return BAND_VAR.none;
  }
  return ratingColor(value * 10);
}

/** SPEC.md section 14: an unrated prospect shows a hyphen, never a zero. */
export const NOT_RATED = "--";

export function formatRating(rating: number | null | undefined): string {
  return rating === null || rating === undefined ? NOT_RATED : String(rating);
}
