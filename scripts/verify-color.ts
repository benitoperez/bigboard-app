/**
 * Rating color band boundaries - SPEC.md section 14.
 *
 * Every boundary is checked from both sides. Off-by-one here is invisible in
 * review and obvious on the field, where an 80 and a 79 are supposed to look
 * different.
 *
 *   npm run verify:color
 */

import {
  ratingBand,
  ratingColor,
  attributeColor,
  formatRating,
  NOT_RATED,
  type RatingBand,
} from "../lib/rating-color";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}` +
      (pass ? "" : `\n        expected ${expected}, got ${actual}`),
  );
}

console.log("=".repeat(70));
console.log("Rating color scale - boundary checks");
console.log("=".repeat(70));

// Each boundary from both sides, per the SPEC.md section 14 table.
const cases: [number, RatingBand][] = [
  [100, "elite"],
  [99, "elite"],
  [90, "elite"],  // boundary
  [89, "high"],   // boundary
  [80, "high"],   // boundary
  [79, "good"],   // boundary
  [75, "good"],   // boundary
  [74, "mid"],    // boundary
  [70, "mid"],    // boundary
  [69, "low"],    // boundary
  [60, "low"],    // boundary
  [59, "poor"],   // boundary
  [45, "poor"],   // bottom of the display band
  [0, "poor"],
];
for (const [n, band] of cases) check(`${n} -> ${band}`, ratingBand(n), band);

console.log("\n--- unrated ---");
check("null -> none", ratingBand(null), "none");
check("undefined -> none", ratingBand(undefined), "none");
check("NaN -> none", ratingBand(NaN), "none");
check("null formats as hyphen", formatRating(null), NOT_RATED);
check("0 formats as 0, not a hyphen", formatRating(0), "0");

console.log("\n--- no gaps between bands ---");
{
  // Walk the whole range in 0.5 steps; every value must land in a band, and
  // the sequence must never improve as the number falls.
  const order: RatingBand[] = ["poor", "low", "mid", "good", "high", "elite"];
  let ok = true;
  let prevIndex = -1;
  for (let n = 0; n <= 100; n += 0.5) {
    const idx = order.indexOf(ratingBand(n));
    if (idx === -1) ok = false;
    if (idx < prevIndex) ok = false;
    prevIndex = idx;
  }
  check("every value 0-100 lands in a band, monotonically", ok, true);
}
{
  // Fractional values must not fall through boundaries.
  check("89.5 -> high (not a gap)", ratingBand(89.5), "high");
  check("74.9 -> mid (not a gap)", ratingBand(74.9), "mid");
}

console.log("\n--- attribute scale (0-10 lifted to 0-100) ---");
check("attribute 9.0 matches rating 90", attributeColor(9.0), ratingColor(90));
check("attribute 8.0 matches rating 80", attributeColor(8.0), ratingColor(80));
check("attribute 5.9 matches rating 59", attributeColor(5.9), ratingColor(59));
check("attribute null is the unrated color", attributeColor(null), ratingColor(null));

console.log("\n--- tokens, not hex literals ---");
{
  const allVars = [100, 85, 77, 72, 65, 40, null].every((n) =>
    ratingColor(n).startsWith("var(--color-rating-"),
  );
  check("every band returns a CSS custom property", allVars, true);
  const distinct = new Set(
    [95, 85, 77, 72, 65, 40, null].map((n) => ratingColor(n)),
  );
  check("all seven bands are distinct colors", distinct.size, 7);
}

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
