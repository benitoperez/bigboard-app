/**
 * Structural checks on the seed templates - SPEC-V2.md section 9.
 *
 * The weights are read out of supabase/migration-v2.sql (see
 * scripts/seed-templates.ts), so these assertions test the SQL that
 * actually seeds the database, not a TypeScript copy of it.
 *
 * A wrong weight fires no error anywhere in the app - the numbers are just
 * quietly off - which is why the sums are checked by machine.
 *
 *   npm run verify:templates
 */

import { BASEBALL, FLAG_FOOTBALL, SEEDS } from "./seed-templates";
import { weightErrors } from "../lib/template";

let failures = 0;

function check(name: string, work: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}\n` +
      `        ${work}\n` +
      `        expected ${expected}, got ${actual}`,
  );
}

console.log("=".repeat(70));
console.log("seed templates - parsed from supabase/migration-v2.sql");
console.log("=".repeat(70));

for (const t of SEEDS) {
  console.log(`\n--- ${t.name} (${t.sport}) ---`);

  // The guardrail shared by seeds and the from-scratch builder.
  check(
    `${t.sport}: every position sums to exactly 100`,
    weightErrors(t).join("; ") || "all positions balanced",
    weightErrors(t).length,
    0,
  );

  // A weight pointing at a component the template does not define would
  // silently drop out of the rating at load time.
  const attrKeys = new Set(t.attributes.map((a) => a.key));
  const drillKeys = new Set(t.drills.map((d) => d.key));
  const dangling = t.positions.flatMap((p) =>
    p.components
      .filter((c) =>
        c.kind === "attribute" ? !attrKeys.has(c.key) : !drillKeys.has(c.key),
      )
      .map((c) => `${p.code}.${c.key}`),
  );
  check(
    `${t.sport}: every weight references a defined component`,
    dangling.join(", ") || "no dangling references",
    dangling.length,
    0,
  );

  // Direction drives both the best-attempt pick and the percentile order.
  // A missing one would silently rank a drill backwards.
  check(
    `${t.sport}: every drill declares a direction`,
    t.drills.map((d) => `${d.key}=${d.direction}`).join(", "),
    t.drills.every(
      (d) =>
        d.direction === "lower_is_better" || d.direction === "higher_is_better",
    ),
    true,
  );

  check(
    `${t.sport}: every drill has a usable range`,
    t.drills.map((d) => `${d.key} ${d.valueMin}-${d.valueMax}`).join(", "),
    t.drills.every((d) => d.valueMin < d.valueMax),
    true,
  );

  // Codes and keys are the join keys between ratings/drill_results rows and
  // the template. Duplicates would make a rating ambiguous.
  const codes = t.positions.map((p) => p.code);
  check(
    `${t.sport}: position codes unique`,
    codes.join(","),
    new Set(codes).size,
    codes.length,
  );

  check(
    `${t.sport}: no position left unweighted`,
    "every position needs at least one component",
    t.positions.every((p) => p.components.length > 0),
    true,
  );
}

// ---- Flag football is an EXACT port of v1 ------------------------------
console.log("\n--- flag football: exact v1 port (SPEC-V2 §3.6) ---");

check(
  "board order matches v1 BOARD_ORDER",
  "QB, R, WR, DB, LB, OL",
  [...FLAG_FOOTBALL.positions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => p.code)
    .join(","),
  "QB,R,WR,DB,LB,OL",
);

check(
  "nine judged attributes, as in v1",
  FLAG_FOOTBALL.attributes.map((a) => a.key).join(","),
  FLAG_FOOTBALL.attributes.length,
  9,
);

check(
  "v1 MIN_RATINGS_FOR_DISPLAY preserved",
  "was a compile-time 3, now a template column",
  FLAG_FOOTBALL.minRatingsForDisplay,
  3,
);

const forty = FLAG_FOOTBALL.drills.find((d) => d.key === "forty");
check(
  "v1 MIN_TIMED_FOR_PERCENTILE preserved on the forty drill",
  "was a compile-time 15, now per-drill",
  forty?.minTimedForPercentile,
  15,
);
check("forty is lower_is_better", "a 40 time: faster is better", forty?.direction, "lower_is_better");
check("v1 MAX_FORTY_ATTEMPTS preserved", "capped at 2 attempts", forty?.maxAttempts, 2);
check(
  "v1 drill_results CHECK range preserved as template data",
  "was CHECK (value > 0 and value < 20)",
  `${forty?.valueMin}-${forty?.valueMax}`,
  "0-20",
);

// The v1 `speed` weight became the forty drill's weight. If this drifted,
// every flag football rating would quietly change.
for (const [code, expected] of [
  ["QB", 15],
  ["R", 35],
  ["WR", 30],
  ["DB", 30],
  ["LB", 25],
  ["OL", 15],
] as const) {
  const w = FLAG_FOOTBALL.positions
    .find((p) => p.code === code)
    ?.components.find((c) => c.kind === "drill" && c.key === "forty")?.weight;
  check(
    `${code}: v1 speed weight carried onto the forty drill`,
    `v1 weights.speed was ${expected}`,
    w,
    expected,
  );
}

// ---- Baseball specifics -----------------------------------------------
console.log("\n--- baseball (SPEC-V2 §3.7) ---");

// Structural, not cosmetic: a pure P has no hitting weight rows, so the
// rating form (which derives sliders from weights) never shows a pitcher a
// hitting slider.
const HITTING = ["contact_hitting", "power_hitting", "exit_velocity"];
const pitcher = BASEBALL.positions.find((p) => p.code === "P");
check(
  "pitchers are not rated on hitting",
  `P components: ${pitcher?.components.map((c) => c.key).join(", ")}`,
  pitcher?.components.some((c) => HITTING.includes(c.key)),
  false,
);

check(
  "both velocity drills are higher_is_better",
  "exit and throwing velocity: harder is better, unlike a 40 time",
  BASEBALL.drills
    .filter((d) => d.key.endsWith("velocity"))
    .every((d) => d.direction === "higher_is_better"),
  true,
);

check(
  "sixty_yard_dash is lower_is_better",
  "a run time in a template that also holds higher-is-better drills",
  BASEBALL.drills.find((d) => d.key === "sixty_yard_dash")?.direction,
  "lower_is_better",
);

// Multiple measured drills per template is the v2 generalization; C carries
// three of them, which v1's single hardcoded speed term could not express.
check(
  "a template supports multiple measured drills per position",
  "C weights throwing_velocity, exit_velocity and sixty_yard_dash",
  BASEBALL.positions
    .find((p) => p.code === "C")
    ?.components.filter((c) => c.kind === "drill").length,
  3,
);

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
