/**
 * Hand-verification of computePositionRating - SPEC.md section 16.
 *
 * "No error will fire if the weighting is wrong, the numbers will just be
 * quietly off. Verify by hand with fake data."
 *
 * Every expected value below is arithmetic done by hand from the weights in
 * lib/config/positions.ts, written out in the `work` string so it can be
 * re-checked without trusting the code. Re-run this whenever weights move:
 *
 *   npm run verify:rating
 */

import {
  computePositionRating,
  compareForBoard,
  type AttributeRatings,
} from "../lib/ratings";
import type { PositionKey } from "../lib/config/positions";

let failures = 0;

function check(
  name: string,
  work: string,
  actual: unknown,
  expected: unknown,
) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}\n` +
      `        ${work}\n` +
      `        expected ${expected}, got ${actual}`,
  );
}

/** Every attribute rated by the same number of officers. */
function rated(
  values: Record<string, number>,
  raterCount = 3,
): AttributeRatings {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { teamRating: v, raterCount }]),
  ) as AttributeRatings;
}

function run(
  pos: PositionKey,
  attrs: AttributeRatings,
  speed: number | null,
) {
  return computePositionRating(pos, attrs, speed);
}

console.log("=".repeat(70));
console.log("computePositionRating - hand-checked against SPEC.md section 8");
console.log("=".repeat(70));

// ---- WR: catching 30, quickness 20, route_running 20, speed 30 ----------
const wr = run(
  "WR",
  rated({ catching: 8.0, quickness: 7.0, route_running: 6.0 }),
  80,
);
check(
  "WR mid-range",
  "80*.30 + 70*.20 + 60*.20 + 80*.30 = 24+14+12+24 = 74 raw -> round(45+74*.54)=round(84.96)",
  wr.rating,
  85,
);
check("WR raw is uncompressed", "raw must stay 74, not 85", wr.raw, 74);

// ---- Band edges --------------------------------------------------------
check(
  "WR perfect",
  "all 10.0 + 100th pct = 100 raw -> round(45+54) = 99 (top of band)",
  run("WR", rated({ catching: 10, quickness: 10, route_running: 10 }), 100).rating,
  99,
);
check(
  "WR floor",
  "all 0.0 + 0th pct = 0 raw -> round(45+0) = 45 (bottom of band)",
  run("WR", rated({ catching: 0, quickness: 0, route_running: 0 }), 0).rating,
  45,
);

// ---- QB: accuracy 35, throwing_power 30, pocket_movement 20, speed 15 ---
check(
  "QB weighting (accuracy outweighs power)",
  "80*.35 + 90*.30 + 70*.20 + 60*.15 = 28+27+14+9 = 78 raw -> round(45+42.12)",
  run(
    "QB",
    rated({ throwing_power: 9.0, accuracy: 8.0, pocket_movement: 7.0 }),
    60,
  ).rating,
  87,
);

// ---- R: only 2 judged attributes - quickness 35, flag_pulling 30, speed 35
const r = run("R", rated({ quickness: 7.0, flag_pulling: 8.0 }), 50);
check(
  "R (2 judged attributes)",
  "70*.35 + 80*.30 + 50*.35 = 24.5+24+17.5 = 66 raw -> round(45+35.64)",
  r.rating,
  81,
);
check("R required = 2 judged + speed", "must be 3, not 4", r.required, 3);

// ---- OL: blocking 40, quickness 25, catching 20, speed 15 --------------
check(
  "OL (blocking-dominant)",
  "90*.40 + 60*.25 + 50*.20 + 40*.15 = 36+15+10+6 = 67 raw -> round(45+36.18)",
  run("OL", rated({ blocking: 9.0, quickness: 6.0, catching: 5.0 }), 40).rating,
  81,
);

// ---- Gating - SPEC.md section 8 ----------------------------------------
console.log("\n--- gating ---");

const missingAttr = run("WR", rated({ catching: 8.0, quickness: 7.0 }), 80);
check(
  "gate: missing route_running",
  "covered 3 < required 4 -> null",
  missingAttr.rating,
  null,
);
check("gate: reports covered", "2 attrs + speed = 3", missingAttr.covered, 3);

check(
  "gate: no 40 time",
  "speed null -> covered 3 < required 4 -> null",
  run("WR", rated({ catching: 8, quickness: 7, route_running: 6 }), null).rating,
  null,
);

const thin = run("R", rated({ quickness: 7.0, flag_pulling: 8.0 }, 1), 50);
check(
  "gate: too few officer inputs",
  "fully covered but 1+1 = 2 inputs < MIN_RATINGS_FOR_DISPLAY (3) -> null",
  thin.rating,
  null,
);
check("gate: still reports inputs", "must expose 2 for the progress label", thin.inputs, 2);

// ---- Why sorting uses raw ----------------------------------------------
console.log("\n--- display band collision (why sorting uses raw) ---");
const a = run("WR", rated({ catching: 8.0, quickness: 7.0, route_running: 6.0 }), 80);
const b = run("WR", rated({ catching: 8.1, quickness: 7.0, route_running: 6.1 }), 80);
console.log(
  `        A raw=${a.raw} display=${a.rating}\n` +
    `        B raw=${b.raw?.toFixed(2)} display=${b.rating}`,
);
check(
  "two prospects collide in the display band",
  "different raw, identical display - sorting on display would tie them",
  a.rating === b.rating && (a.raw ?? 0) < (b.raw ?? 0) ? "ok" : "no",
  "ok",
);

// ---- Board ordering - SPEC.md sections 8 and 10.1 ----------------------
console.log("\n--- board ordering ---");
check(
  "higher raw wins even when the display number ties",
  "raw 74.0 and 74.5 both display 85; #20 holds the higher raw",
  [
    { raw: 74.0, jerseyNumber: 10 },
    { raw: 74.5, jerseyNumber: 20 },
  ].sort(compareForBoard)[0].jerseyNumber,
  20,
);
check(
  "gated sorts below a rated prospect, however low",
  "an unrated prospect never outranks a real 50",
  [
    { raw: null, jerseyNumber: 1 },
    { raw: 50, jerseyNumber: 99 },
  ].sort(compareForBoard)[0].jerseyNumber,
  99,
);
check(
  "two gated prospects order stably by jersey",
  "they have no meaningful ranking and must not appear to",
  [
    { raw: null, jerseyNumber: 42 },
    { raw: null, jerseyNumber: 7 },
  ]
    .sort(compareForBoard)
    .map((x) => x.jerseyNumber)
    .join(","),
  "7,42",
);
check(
  "full board: rated descending, then gated by jersey",
  "90, 75, 60, then the two gated ones",
  [
    { raw: 60, jerseyNumber: 3 },
    { raw: null, jerseyNumber: 4 },
    { raw: 90, jerseyNumber: 5 },
    { raw: null, jerseyNumber: 1 },
    { raw: 75, jerseyNumber: 6 },
  ]
    .sort(compareForBoard)
    .map((r) => r.jerseyNumber)
    .join(","),
  "5,6,3,1,4",
);

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
