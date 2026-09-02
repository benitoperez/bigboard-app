/**
 * Wide-format export column checks - SPEC-V2.md section 10c.
 *
 * The rule that matters most here is that MISSING DATA IS BLANK, NEVER ZERO.
 * A spreadsheet averages a column; a 0 standing in for "nobody rated this"
 * drags the average down and makes an unevaluated athlete look bad, silently.
 * Nothing in the app would surface that - the file just quietly lies - which
 * is exactly the kind of failure worth a machine check.
 *
 *   npm run verify:export
 */

import { buildColumns, buildCsv, escapeCsv, exportFilename } from "../lib/csv/export";
import type { ExportProspect } from "../lib/csv/export";
import { BASEBALL, FLAG_FOOTBALL } from "./seed-templates";

let failures = 0;

function check(name: string, work: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}\n` +
      `        ${work}\n` +
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** A prospect with nothing recorded at all - the blank-cell worst case. */
function emptyProspect(overrides: Partial<ExportProspect> = {}): ExportProspect {
  return {
    id: "p1",
    jerseyNumber: 17,
    firstName: "Marcus",
    lastName: "Reid",
    fullName: "Marcus Reid",
    primaryPosition: "QB",
    secondaryPositions: [],
    headshotUrl: null,
    headshotPath: null,
    primary: { rating: null, raw: null, inputs: 0, covered: 0, required: 4 },
    ratingsByPosition: {},
    playedPositions: ["QB"],
    missing: [],
    drills: {},
    drillPercentiles: {},
    attributeRatings: {},
    attempts: {},
    ...overrides,
  } as ExportProspect;
}

console.log("=".repeat(70));
console.log("CSV export - columns generated from the org template");
console.log("=".repeat(70));

// ---- columns come from the template, never hardcoded --------------------
console.log("\n--- column generation ---");

const ffHeaders = buildColumns(FLAG_FOOTBALL, new Set()).map((c) => c.header);
const bbHeaders = buildColumns(BASEBALL, new Set()).map((c) => c.header);

check(
  "flag football exports its own drill, not baseball's",
  ffHeaders.filter((h) => h.startsWith("forty")).join(", "),
  ffHeaders.includes("forty_best") && !ffHeaders.includes("exit_velocity_best"),
  true,
);
check(
  "baseball exports all three of its drills",
  "sixty_yard_dash, exit_velocity, throwing_velocity",
  ["sixty_yard_dash", "exit_velocity", "throwing_velocity"].every((k) =>
    bbHeaders.includes(`${k}_best`),
  ),
  true,
);
check(
  "one attempt column per attempt the drill allows",
  "forty has maxAttempts 2",
  ffHeaders.filter((h) => /^forty_\d+$/.test(h)),
  ["forty_1", "forty_2"],
);
check(
  "a rating and an input count per position",
  "6 flag football positions",
  FLAG_FOOTBALL.positions.every(
    (p) =>
      ffHeaders.includes(`${p.code}_rating`) &&
      ffHeaders.includes(`${p.code}_inputs`),
  ),
  true,
);
check(
  "a median and a rater count per attribute",
  "an 8.4 from one officer and from nine are not the same fact",
  FLAG_FOOTBALL.attributes.every(
    (a) =>
      ffHeaders.includes(`${a.key}_median`) &&
      ffHeaders.includes(`${a.key}_raters`),
  ),
  true,
);
check(
  "position columns follow board order",
  "QB, R, WR, DB, LB, OL",
  ffHeaders.filter((h) => h.endsWith("_rating")),
  ["QB_rating", "R_rating", "WR_rating", "DB_rating", "LB_rating", "OL_rating"],
);

// ---- THE rule: blank, never zero ---------------------------------------
console.log("\n--- missing data is blank, never zero ---");

const columns = buildColumns(FLAG_FOOTBALL, new Set());
const cell = (header: string, p: ExportProspect) =>
  columns.find((c) => c.header === header)!.value(p);

const blank = emptyProspect();

check(
  "an unrated attribute is empty",
  "catching_median with no ratings - a 0 would drag a spreadsheet average",
  cell("catching_median", blank),
  "",
);
check(
  "its rater count is empty too, not 0",
  "catching_raters",
  cell("catching_raters", blank),
  "",
);
check(
  "an unmeasured drill is empty",
  "forty_best with no attempts",
  cell("forty_best", blank),
  "",
);
check(
  "a missing attempt is empty",
  "forty_2 when only one attempt was run",
  cell("forty_2", emptyProspect({ attempts: { forty: [4.61] } })),
  "",
);
check(
  "a position the prospect does not play is empty",
  "WR_rating on a QB-only athlete",
  cell("WR_rating", blank),
  "",
);

// A GATED rating is the subtle one: the inputs exist, the rating does not.
const gated = emptyProspect({
  ratingsByPosition: {
    QB: { rating: null, raw: null, inputs: 2, covered: 3, required: 4 },
  },
});
check(
  "a gated rating is empty",
  "covered 3 of 4 - no number was ever shown on screen either",
  cell("QB_rating", gated),
  "",
);
check(
  "and its input count is empty too",
  "2 inputs beside a blank rating would imply a rating exists",
  cell("QB_inputs", gated),
  "",
);

// ---- real values still come through ------------------------------------
console.log("\n--- values that DO exist ---");

const rated = emptyProspect({
  ratingsByPosition: {
    QB: { rating: 84, raw: 72.2, inputs: 6, covered: 4, required: 4 },
  },
  attributeRatings: { catching: { teamRating: 8, raterCount: 3 } },
  drills: { forty: { best: 4.61, avg: 4.68, attempts: 2, percentile: 92 } },
  attempts: { forty: [4.61, 4.75] },
  secondaryPositions: ["WR"],
});

check("rating exports as the display band", "45-99, as shown on screen", cell("QB_rating", rated), "84");
check("input count exports", "6 officer inputs", cell("QB_inputs", rated), "6");
check("attribute median keeps one decimal", "8 -> 8.0", cell("catching_median", rated), "8.0");
check("rater count exports", "3 raters", cell("catching_raters", rated), "3");
check("best uses the drill's decimals", "forty has decimals 2", cell("forty_best", rated), "4.61");
check("each attempt exports", "attempt 2", cell("forty_2", rated), "4.75");
check("percentile exports", "92nd in class", cell("forty_percentile", rated), "92");
check(
  "secondary positions round-trip through the importer's format",
  'comma separated, which validateRoster splits and trims',
  cell("secondary_positions", rated),
  "WR",
);

// ---- CSV mechanics ------------------------------------------------------
console.log("\n--- CSV escaping and naming ---");

check("a comma forces quoting", 'WR, DB', escapeCsv("WR, DB"), '"WR, DB"');
check(
  "an embedded quote is doubled",
  'O"Brien -> "O""Brien"',
  escapeCsv('O"Brien'),
  '"O""Brien"',
);
check("a newline forces quoting", "a name with a line break", escapeCsv("a\nb"), '"a\nb"');
check("a plain value is untouched", "Reid", escapeCsv("Reid"), "Reid");

const csv = buildCsv(FLAG_FOOTBALL, [rated], new Set(["p1"]));
check(
  "selected reads TRUE when on the list",
  "membership comes from the selections set, not the prospect row",
  csv.split("\r\n")[1].split(",")[5],
  "TRUE",
);
check(
  "header row then one row per prospect",
  "1 prospect -> 2 lines plus the trailing terminator",
  csv.trimEnd().split("\r\n").length,
  2,
);
check(
  "the filename carries the org and the class",
  "two clubs must not produce the same file name",
  exportFilename("NCSU Club Flag Football", "2026 Fall Tryouts").startsWith(
    "ncsu-club-flag-football-2026-fall-tryouts-",
  ),
  true,
);
check(
  "a scoped export says so",
  "selected appears in the name",
  exportFilename("Org", "Class", "selected").includes("-selected-"),
  true,
);

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
