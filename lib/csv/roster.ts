import { POSITIONS, type PositionKey } from "@/lib/config/positions";

/**
 * Roster CSV validation - SPEC.md section 12.
 *
 * The whole file is validated before anything is inserted. A partial import
 * leaves a roster that is half right, at night, mid-tryout, and untangling it
 * means knowing which rows made it. Rejecting the file outright is worse for
 * thirty seconds and better for the next hour.
 *
 * Pure on purpose: no Supabase, no papaparse. The dirty-data cases are the
 * hard part here, not the parsing, so they need to be testable directly.
 * See scripts/verify-roster.ts.
 */

export const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "jersey_number",
  "primary_position",
] as const;

export type RosterRow = {
  first_name: string;
  last_name: string;
  jersey_number: number;
  primary_position: PositionKey;
};

export type RowError = {
  /** 1-based line in the file as the user sees it, header counted. */
  line: number;
  message: string;
};

export type ValidationResult =
  | { ok: true; rows: RosterRow[]; skippedBlank: number }
  | { ok: false; errors: RowError[]; skippedBlank: number };

const VALID_POSITIONS = Object.keys(POSITIONS) as PositionKey[];

function isBlankRecord(rec: Record<string, unknown>) {
  return Object.values(rec).every(
    (v) => v === null || v === undefined || String(v).trim() === "",
  );
}

/**
 * @param records Parsed CSV rows, header-keyed (papaparse `header: true`).
 * @param headers The header row as parsed, to report missing columns.
 * @param existingJerseys Jersey numbers already used in this tryout.
 */
export function validateRoster(
  records: Record<string, unknown>[],
  headers: string[],
  existingJerseys: ReadonlySet<number>,
): ValidationResult {
  const errors: RowError[] = [];

  // --- header check. Without columns nothing else is worth reporting. ---
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !normalized.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      skippedBlank: 0,
      errors: [
        {
          line: 1,
          message: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected ${REQUIRED_COLUMNS.join(", ")}.`,
        },
      ],
    };
  }

  const rows: RosterRow[] = [];
  const seenJerseys = new Map<number, number>(); // jersey -> first line seen
  let skippedBlank = 0;

  records.forEach((rec, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header row

    // SPEC.md section 12: trailing blank rows are ignored, not an error.
    // Spreadsheet exports are full of them.
    if (isBlankRecord(rec)) {
      skippedBlank++;
      return;
    }

    const get = (k: string) => String(rec[k] ?? "").trim();

    const first = get("first_name");
    const last = get("last_name");
    const jerseyRaw = get("jersey_number");
    const posRaw = get("primary_position");

    if (!first) errors.push({ line, message: "first_name is empty." });
    if (!last) errors.push({ line, message: "last_name is empty." });

    // --- jersey ---
    let jersey: number | null = null;
    if (!jerseyRaw) {
      errors.push({ line, message: "jersey_number is empty." });
    } else if (!/^\d+$/.test(jerseyRaw)) {
      errors.push({
        line,
        message: `jersey_number "${jerseyRaw}" is not a whole number.`,
      });
    } else {
      jersey = Number(jerseyRaw);
      if (jersey < 0 || jersey > 999) {
        errors.push({
          line,
          message: `jersey_number ${jersey} is out of range.`,
        });
      } else if (seenJerseys.has(jersey)) {
        errors.push({
          line,
          message: `jersey_number ${jersey} is already used on line ${seenJerseys.get(jersey)}.`,
        });
      } else if (existingJerseys.has(jersey)) {
        errors.push({
          line,
          message: `jersey_number ${jersey} is already taken in this tryout.`,
        });
      } else {
        seenJerseys.set(jersey, line);
      }
    }

    // --- position ---
    // Compared against POSITIONS, never a list written out here.
    const pos = posRaw.toUpperCase() as PositionKey;
    if (!posRaw) {
      errors.push({ line, message: "primary_position is empty." });
    } else if (!VALID_POSITIONS.includes(pos)) {
      errors.push({
        line,
        message: `primary_position "${posRaw}" is not a known position. Valid: ${VALID_POSITIONS.join(", ")}.`,
      });
    }

    if (first && last && jersey !== null && VALID_POSITIONS.includes(pos)) {
      rows.push({
        first_name: first,
        last_name: last,
        jersey_number: jersey,
        primary_position: pos,
      });
    }
  });

  if (rows.length === 0 && errors.length === 0) {
    return {
      ok: false,
      skippedBlank,
      errors: [{ line: 1, message: "The file has no data rows." }],
    };
  }

  if (errors.length > 0) return { ok: false, errors, skippedBlank };
  return { ok: true, rows, skippedBlank };
}
