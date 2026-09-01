/**
 * Hand-verification of computePositionRating - SPEC.md section 16,
 * generalized by SPEC-V2.md section 3.3.
 *
 * "No error will fire if the weighting is wrong, the numbers will just be
 * quietly off. Verify by hand with fake data."
 *
 * Every expected value below is arithmetic done by hand from the seeded
 * weights, written out in the `work` string so it can be re-checked without
 * trusting the code.
 *
 * The v1 flag football cases are UNCHANGED from the v1 version of this
 * script. That is the point: v2 moved the config from a TypeScript constant
 * into database rows and generalized speed into an arbitrary set of measured
 * drills, and every v1 number still comes out identical. If any of these
 * move, the port changed the math.
 *
 *   npm run verify:rating
 */

import {
  computePositionRating,
  compareForBoard,
  type AttributeRatings,
  type DrillPercentiles,
} from "../lib/ratings";
import type { Template } from "../lib/template";
import { BASEBALL, FLAG_FOOTBALL } from "./seed-templates";

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
  );
}

function run(
  template: Template,
  pos: string,
  attrs: AttributeRatings,
  drills: DrillPercentiles,
) {
  return computePositionRating(template, pos, attrs, drills);
}

/** Flag football: one drill, so a bare percentile reads like v1's `speed`. */
function ff(pos: string, attrs: AttributeRatings, speed: number | null) {
  return run(FLAG_FOOTBALL, pos, attrs, { forty: speed });
}

console.log("=".repeat(70));
console.log("computePositionRating - hand-checked against SPEC.md section 8");
console.log("=".repeat(70));
console.log("\n--- flag football: identical to v1 (SPEC-V2 §3.6 exact port) ---");

// ---- WR: catching 30, quickness 20, route_running 20, forty 30 ---------
const wr = ff("WR", rated({ catching: 8.0, quickness: 7.0, route_running: 6.0 }), 80);
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
  ff("WR", rated({ catching: 10, quickness: 10, route_running: 10 }), 100).rating,
  99,
);
check(
  "WR floor",
  "all 0.0 + 0th pct = 0 raw -> round(45+0) = 45 (bottom of band)",
  ff("WR", rated({ catching: 0, quickness: 0, route_running: 0 }), 0).rating,
  45,
);

// ---- QB: accuracy 35, throwing_power 30, pocket_movement 20, forty 15 --
check(
  "QB weighting (accuracy outweighs power)",
  "80*.35 + 90*.30 + 70*.20 + 60*.15 = 28+27+14+9 = 78 raw -> round(45+42.12)",
  ff("QB", rated({ throwing_power: 9.0, accuracy: 8.0, pocket_movement: 7.0 }), 60).rating,
  87,
);

// ---- R: only 2 judged attributes - quickness 35, flag_pulling 30, forty 35
const r = ff("R", rated({ quickness: 7.0, flag_pulling: 8.0 }), 50);
check(
  "R (2 judged attributes)",
  "70*.35 + 80*.30 + 50*.35 = 24.5+24+17.5 = 66 raw -> round(45+35.64)",
  r.rating,
  81,
);
check("R required = 2 judged + 1 drill", "must be 3, not 4", r.required, 3);

// ---- OL: blocking 40, quickness 25, catching 20, forty 15 --------------
check(
  "OL (blocking-dominant)",
  "90*.40 + 60*.25 + 50*.20 + 40*.15 = 36+15+10+6 = 67 raw -> round(45+36.18)",
  ff("OL", rated({ blocking: 9.0, quickness: 6.0, catching: 5.0 }), 40).rating,
  81,
);

// ---- Gating - SPEC.md section 8 ----------------------------------------
console.log("\n--- gating ---");

const missingAttr = ff("WR", rated({ catching: 8.0, quickness: 7.0 }), 80);
check(
  "gate: missing route_running",
  "covered 3 < required 4 -> null",
  missingAttr.rating,
  null,
);
check("gate: reports covered", "2 attrs + forty = 3", missingAttr.covered, 3);

check(
  "gate: no 40 time",
  "forty percentile null -> covered 3 < required 4 -> null",
  ff("WR", rated({ catching: 8, quickness: 7, route_running: 6 }), null).rating,
  null,
);

const thin = ff("R", rated({ quickness: 7.0, flag_pulling: 8.0 }, 1), 50);
check(
  "gate: too few officer inputs",
  "fully covered but 1+1 = 2 inputs < minRatingsForDisplay (3) -> null",
  thin.rating,
  null,
);
check("gate: still reports inputs", "must expose 2 for the progress label", thin.inputs, 2);

// ---- Why sorting uses raw ----------------------------------------------
console.log("\n--- display band collision (why sorting uses raw) ---");
const a = ff("WR", rated({ catching: 8.0, quickness: 7.0, route_running: 6.0 }), 80);
const b = ff("WR", rated({ catching: 8.1, quickness: 7.0, route_running: 6.1 }), 80);
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

// ---- Baseball: multiple drills per position (SPEC-V2 §3.7) -------------
console.log("\n--- baseball: multiple measured drills, mixed directions ---");

// P: command 30, throwing_velocity 25, breaking_ball 20, offspeed 15,
//    ground_balls 10. No hitting anywhere in the weights.
const p = run(
  BASEBALL,
  "P",
  rated({ command: 8.0, breaking_ball: 7.0, offspeed: 6.0, ground_balls: 5.0 }),
  { throwing_velocity: 90 },
);
check(
  "P (one drill among five components)",
  "80*.30 + 90*.25 + 70*.20 + 60*.15 + 50*.10 = 24+22.5+14+9+5 = 74.5 raw -> round(45+40.23)",
  p.rating,
  85,
);
check("P raw is uncompressed", "raw must stay 74.5", p.raw, 74.5);
check(
  "P is not gated by hitting data it never uses",
  "5 weighted components, all covered",
  p.covered,
  5,
);

// C: receiving 25, arm_accuracy 15, throwing_velocity 15, contact_hitting 15,
//    power_hitting 10, exit_velocity 10, sixty_yard_dash 5, base_running 5.
// Three measured drills in one position - impossible in v1.
const c = run(
  BASEBALL,
  "C",
  rated({
    receiving: 8.0,
    arm_accuracy: 7.0,
    contact_hitting: 6.0,
    power_hitting: 5.0,
    base_running: 4.0,
  }),
  { throwing_velocity: 80, exit_velocity: 70, sixty_yard_dash: 60 },
);
check(
  "C (three measured drills)",
  "80*.25 + 70*.15 + 80*.15 + 60*.15 + 50*.10 + 70*.10 + 60*.05 + 40*.05 = " +
    "20+10.5+12+9+5+7+3+2 = 68.5 raw -> round(45+36.99)",
  c.rating,
  82,
);
check("C counts eight components", "8 weighted inputs", c.required, 8);

check(
  "gate: one missing drill gates the whole position",
  "C without an exit velocity -> covered 7 < required 8 -> null",
  run(
    BASEBALL,
    "C",
    rated({
      receiving: 8.0,
      arm_accuracy: 7.0,
      contact_hitting: 6.0,
      power_hitting: 5.0,
      base_running: 4.0,
    }),
    { throwing_velocity: 80, sixty_yard_dash: 60 },
  ).rating,
  null,
);

// Direction is handled in SQL (the view orders the percentile so 100 is
// always best); the formula must treat both kinds of drill identically.
const cf = run(
  BASEBALL,
  "CF",
  rated({
    fly_balls: 7.0,
    base_running: 7.0,
    contact_hitting: 7.0,
    power_hitting: 7.0,
    arm_accuracy: 7.0,
  }),
  { sixty_yard_dash: 70, exit_velocity: 70 },
);
check(
  "CF: a lower-is-better and a higher-is-better drill weigh identically at equal percentile",
  "every component at the 70 mark -> 70 raw -> round(45+37.8)",
  cf.rating,
  83,
);
check("CF raw", "all components equal 70 -> raw exactly 70", cf.raw, 70);

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
