/**
 * Roster CSV validation against dirty data - SPEC.md sections 12 and 16.
 *
 * "The code is simple and the dirty data is not." Every case here is
 * something a real Google Sheets export actually does.
 *
 *   npm run verify:roster
 */

import {
  validateRoster,
  normalizePosition,
  REQUIRED_COLUMNS,
} from "../lib/csv/roster";
import { FLAG_FOOTBALL } from "./seed-templates";

/**
 * Every case runs against the seeded flag football template, whose single
 * drill is `forty` with two attempts - so the column names below are the
 * same ones a real sheet carries, and the assertions still exercise the v1
 * dirty-data cases. The template is read from the migration SQL, so a drill
 * renamed there changes the expected columns here rather than drifting.
 */
const T = FLAG_FOOTBALL;

const vr = (
  records: Record<string, unknown>[],
  headers: string[],
  taken: ReadonlySet<number>,
) => validateRoster(records, headers, taken, T);

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
  }
}

const HEADERS = [...REQUIRED_COLUMNS];
const FULL = [...REQUIRED_COLUMNS, "forty_1", "forty_2", "selected"];

/** A row in the new shape. */
const row = (
  first: string,
  last: string,
  jersey: string,
  positions: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  first_name: first,
  last_name: last,
  jersey_number: jersey,
  positions,
  ...extra,
});

console.log("=".repeat(70));
console.log("Roster CSV validation - Google Sheets export shape");
console.log("=".repeat(70));

// ---- position normalization (pure) -------------------------------------
console.log("--- normalizePosition ---");
check("strips a parenthetical gloss", normalizePosition("R (Rush)"), "R");
check("uppercases", normalizePosition("wr"), "WR");
check("trims", normalizePosition("  DB  "), "DB");
check("handles both together", normalizePosition(" ol (o-line) "), "OL");
check("leaves a bare code alone", normalizePosition("QB"), "QB");

// ---- the positions multi-select cell ------------------------------------
console.log("\n--- positions cell ---");
{
  const r = vr([row("A", "B", "7", "WR, DB")], HEADERS, new Set());
  check("first value is primary", r.ok && r.rows[0].primary_position, "WR");
  check("rest are secondary", r.ok && r.rows[0].secondary_positions, ["DB"]);
}
{
  const r = vr([row("A", "B", "7", "QB")], HEADERS, new Set());
  check("single position, no secondaries", r.ok && r.rows[0].secondary_positions, []);
}
{
  const r = vr([row("A", "B", "7", "R (Rush), DB")], HEADERS, new Set());
  check("normalizes inside the cell", r.ok && r.rows[0].primary_position, "R");
}
{
  const r = vr([row("A", "B", "7", "WR,DB,LB")], HEADERS, new Set());
  check("no spaces after commas is fine", r.ok && r.rows[0].secondary_positions, ["DB", "LB"]);
}
{
  const r = vr([row("A", "B", "7", "WR, WR, DB")], HEADERS, new Set());
  check("duplicate inside the cell collapses", r.ok && r.rows[0].secondary_positions, ["DB"]);
  check("and does not become its own secondary", r.ok && r.rows[0].primary_position, "WR");
}
{
  const r = vr([row("A", "B", "7", "WR, , DB")], HEADERS, new Set());
  check("empty value between commas ignored", r.ok && r.rows[0].secondary_positions, ["DB"]);
}
{
  const r = vr([row("A", "B", "7", "")], HEADERS, new Set());
  check("empty positions rejected", r.ok, false);
}
{
  const r = vr([row("A", "B", "7", "WR, RB")], HEADERS, new Set());
  // RB is in the old mockups but is NOT a position in this app.
  check("unknown position rejected", r.ok, false);
  check("names the bad value", !r.ok && /RB/.test(r.errors[0].message), true);
}
{
  const r = vr([row("A", "B", "7", "Wide Receiver")], HEADERS, new Set());
  check("a full position name is not guessed at", r.ok, false);
}

// ---- selected -----------------------------------------------------------
console.log("\n--- selected flag ---");
for (const truthy of ["TRUE", "true", "1"]) {
  const r = vr(
    [row("A", "B", "7", "WR", { selected: truthy })],
    FULL,
    new Set(),
  );
  check(`"${truthy}" is truthy`, r.ok && r.rows[0].selected, true);
}
for (const falsy of ["FALSE", "false", "0", ""]) {
  const r = vr(
    [row("A", "B", "7", "WR", { selected: falsy })],
    FULL,
    new Set(),
  );
  check(`"${falsy}" is falsy`, r.ok && r.rows[0].selected, false);
}
{
  const r = vr(
    [row("A", "B", "7", "WR", { selected: "maybe" })],
    FULL,
    new Set(),
  );
  check("unrecognized selected value rejected", r.ok, false);
}
{
  const r = vr([row("A", "B", "7", "WR")], HEADERS, new Set());
  check("no selected column at all defaults to false", r.ok && r.rows[0].selected, false);
}

// ---- 40 times -----------------------------------------------------------
console.log("\n--- 40 times ---");
{
  const r = vr(
    [row("A", "B", "7", "WR", { forty_1: "4.61", forty_2: "4.72" })],
    FULL,
    new Set(),
  );
  check("both parsed", r.ok && r.rows[0].drills.forty, [4.61, 4.72]);
}
{
  const r = vr(
    [row("A", "B", "7", "WR", { forty_1: "4.61", forty_2: "" })],
    FULL,
    new Set(),
  );
  check("blank second time is null, not an error", r.ok && r.rows[0].drills.forty[1], null);
}
{
  const r = vr(
    [row("A", "B", "7", "WR", { forty_1: "abc" })],
    FULL,
    new Set(),
  );
  check("unparseable time rejected, not dropped", r.ok, false);
}
{
  const r = vr(
    [row("A", "B", "7", "WR", { forty_1: "25.0" })],
    FULL,
    new Set(),
  );
  check("out-of-range time rejected", r.ok, false);
}
{
  const r = vr(
    [row("A", "B", "7", "WR", { "40_1": "4.55" })],
    [...HEADERS, "40_1"],
    new Set(),
  );
  check("alias header 40_1 accepted", r.ok && r.rows[0].drills.forty[0], 4.55);
}

// ---- jerseys, names, blanks --------------------------------------------
console.log("\n--- jerseys, names, blank rows ---");
{
  const r = vr(
    [row("A", "B", "7", "WR"), row("C", "D", "7", "DB")],
    HEADERS,
    new Set(),
  );
  check("duplicate jersey within file rejected", r.ok, false);
  check("points at the earlier line", !r.ok && /line 2/.test(r.errors[0].message), true);
}
{
  const r = vr([row("A", "B", "7", "WR")], HEADERS, new Set([7]));
  check("jersey already in tryout rejected", r.ok, false);
}
{
  const r = vr([row("A", "B", "7.5", "WR")], HEADERS, new Set());
  check("non-integer jersey rejected", r.ok, false);
}
{
  const r = vr([row("", "B", "7", "WR")], HEADERS, new Set());
  check("empty first_name rejected", r.ok, false);
}
{
  const r = vr(
    [
      row("A", "B", "7", "WR"),
      { first_name: "", last_name: "", jersey_number: "", positions: "" },
    ],
    HEADERS,
    new Set(),
  );
  check("trailing blank row ignored, not an error", r.ok, true);
  check("blank counted", r.skippedBlank, 1);
}

// ---- headers ------------------------------------------------------------
console.log("\n--- headers ---");
{
  const r = vr(
    [row("A", "B", "7", "WR")],
    ["first_name", "last_name", "jersey_number"],
    new Set(),
  );
  check("missing positions column rejected", r.ok, false);
  check("names the missing column", !r.ok && /positions/.test(r.errors[0].message), true);
}
{
  const r = vr(
    [row("A", "B", "7", "WR")],
    [" First_Name ", "LAST_NAME", "jersey_number", "POSITIONS"],
    new Set(),
  );
  check("header case and padding tolerated", r.ok, true);
}

// ---- whole-file rejection -----------------------------------------------
console.log("\n--- all or nothing ---");
{
  const r = vr(
    [
      row("Good", "Row", "1", "QB"),
      row("Bad", "Row", "2", "TE"),
      row("Also", "Good", "3", "WR"),
    ],
    HEADERS,
    new Set(),
  );
  check("one bad position rejects the whole file", r.ok, false);
  check("exactly one error reported", !r.ok && r.errors.length, 1);
  check("error is row numbered", !r.ok && r.errors[0].line, 3);
}
{
  const r = vr([], HEADERS, new Set());
  check("empty file rejected", r.ok, false);
}
{
  const r = vr(
    [row("", "", "abc", "XX", { forty_1: "nope", selected: "huh" })],
    FULL,
    new Set(),
  );
  // first_name, last_name, jersey, position, forty, selected = 6
  check("every problem on a row is reported", !r.ok && r.errors.length, 6);
}

// ---- a realistic sheet --------------------------------------------------
console.log("\n--- a realistic export ---");
{
  const r = vr(
    [
      row("Marcus", "Reid", "17", "QB", { forty_1: "4.72", forty_2: "4.68", selected: "TRUE" }),
      row("DeShawn", "Carter", "21", "WR, DB", { forty_1: "4.51", forty_2: "", selected: "" }),
      row("Amir", "Jackson", "27", "R (Rush), LB", { forty_1: "", forty_2: "", selected: "1" }),
    ],
    FULL,
    new Set(),
  );
  check("file accepted", r.ok, true);
  check("three rows", r.ok && r.rows.length, 3);
  check("multi-position split", r.ok && r.rows[1].secondary_positions, ["DB"]);
  check("normalized primary", r.ok && r.rows[2].primary_position, "R");
  check("selections counted", r.ok && r.rows.filter((x) => x.selected).length, 2);
  check("times counted", r.ok && r.rows.filter((x) => x.drills.forty[0] !== null).length, 2);
}

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
