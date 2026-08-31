/**
 * Roster CSV validation against dirty data - SPEC.md sections 12 and 16.
 *
 * "The code is simple and the dirty data is not." Every case here is
 * something a real spreadsheet export actually does.
 *
 *   npm run verify:roster
 */

import { validateRoster, REQUIRED_COLUMNS } from "../lib/csv/roster";

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
const row = (
  first: string,
  last: string,
  jersey: string,
  pos: string,
): Record<string, unknown> => ({
  first_name: first,
  last_name: last,
  jersey_number: jersey,
  primary_position: pos,
});

console.log("=".repeat(70));
console.log("Roster CSV validation - dirty data cases");
console.log("=".repeat(70));

// ---- happy path --------------------------------------------------------
{
  const r = validateRoster(
    [row("Marcus", "Reid", "7", "QB"), row("Amir", "Jackson", "5", "WR")],
    HEADERS,
    new Set(),
  );
  check("clean file accepted", r.ok, true);
  check("both rows parsed", r.ok && r.rows.length, 2);
  check("jersey coerced to number", r.ok && r.rows[0].jersey_number, 7);
}

// ---- trailing blank rows: ignored, not an error ------------------------
{
  const r = validateRoster(
    [
      row("Marcus", "Reid", "7", "QB"),
      row("", "", "", ""),
      { first_name: null, last_name: "  ", jersey_number: "", primary_position: undefined },
    ],
    HEADERS,
    new Set(),
  );
  check("trailing blank rows do not fail the file", r.ok, true);
  check("blank rows counted, not imported", r.skippedBlank, 2);
  check("only the real row imported", r.ok && r.rows.length, 1);
}

// ---- position handling -------------------------------------------------
{
  const r = validateRoster([row("A", "B", "1", "qb")], HEADERS, new Set());
  check("lowercase position accepted and upcased", r.ok && r.rows[0].primary_position, "QB");
}
{
  const r = validateRoster([row("A", "B", "1", "RB")], HEADERS, new Set());
  // RB is in the old mockups but is NOT a position in this app.
  check("mockup-only position RB rejected", r.ok, false);
  check("names the bad value", !r.ok && /RB/.test(r.errors[0].message), true);
}

// ---- jersey numbers ----------------------------------------------------
{
  const r = validateRoster(
    [row("A", "B", "7", "QB"), row("C", "D", "7", "WR")],
    HEADERS,
    new Set(),
  );
  check("duplicate jersey within file rejected", r.ok, false);
  check("points at the earlier line", !r.ok && /line 2/.test(r.errors[0].message), true);
}
{
  const r = validateRoster([row("A", "B", "7", "QB")], HEADERS, new Set([7]));
  check("jersey already in tryout rejected", r.ok, false);
}
{
  const r = validateRoster([row("A", "B", "7.5", "QB")], HEADERS, new Set());
  check("non-integer jersey rejected", r.ok, false);
}
{
  const r = validateRoster([row("A", "B", "  12  ", "QB")], HEADERS, new Set());
  check("whitespace-padded jersey accepted", r.ok && r.rows[0].jersey_number, 12);
}

// ---- names -------------------------------------------------------------
{
  const r = validateRoster([row("", "Reid", "7", "QB")], HEADERS, new Set());
  check("empty first_name rejected", r.ok, false);
}
{
  const r = validateRoster([row("  ", "Reid", "7", "QB")], HEADERS, new Set());
  check("whitespace-only first_name rejected", r.ok, false);
}

// ---- headers -----------------------------------------------------------
{
  const r = validateRoster(
    [row("A", "B", "1", "QB")],
    ["first_name", "last_name", "jersey_number"],
    new Set(),
  );
  check("missing column rejected", r.ok, false);
  check("names the missing column", !r.ok && /primary_position/.test(r.errors[0].message), true);
}
{
  const r = validateRoster(
    [row("A", "B", "1", "QB")],
    [" First_Name ", "LAST_NAME", "jersey_number", "primary_position"],
    new Set(),
  );
  check("header case and padding tolerated", r.ok, true);
}

// ---- all-or-nothing ----------------------------------------------------
{
  const r = validateRoster(
    [
      row("Good", "Row", "1", "QB"),
      row("Bad", "Row", "abc", "QB"),
      row("Also", "Good", "2", "WR"),
    ],
    HEADERS,
    new Set(),
  );
  check("one bad row rejects the whole file", r.ok, false);
  check("exactly one error reported", !r.ok && r.errors.length, 1);
}
{
  const r = validateRoster([], HEADERS, new Set());
  check("empty file rejected", r.ok, false);
}

// ---- every error is reported, not just the first -----------------------
{
  const r = validateRoster(
    [row("", "", "abc", "XX")],
    HEADERS,
    new Set(),
  );
  check("all four problems on one row reported", !r.ok && r.errors.length, 4);
}

console.log("\n" + "=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`);
console.log("=".repeat(70));
process.exit(failures === 0 ? 0 : 1);
