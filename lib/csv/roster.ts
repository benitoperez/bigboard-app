import { POSITIONS, type PositionKey } from "@/lib/config/positions";

/**
 * Roster CSV validation - SPEC.md section 12.
 *
 * The source is a Google Sheets export. That shapes the format: positions
 * arrive as one quoted multi-select cell, and the sheet already carries 40
 * times and a selection flag.
 *
 * The whole file is validated before anything is inserted. A partial import
 * leaves a roster that is half right, at night, mid-tryout, and untangling it
 * means knowing which rows made it. Rejecting the file outright is worse for
 * thirty seconds and better for the next hour.
 *
 * Pure on purpose: no Supabase, no papaparse. The dirty data is the hard part
 * here, not the parsing, so it needs to be testable directly.
 * See scripts/verify-roster.ts.
 */

export const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "jersey_number",
  "positions",
] as const;

export const OPTIONAL_COLUMNS = ["forty_1", "forty_2", "selected"] as const;

/**
 * Accepted spellings for the optional columns. A real sheet header is
 * whatever the person who built it typed.
 */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  forty_1: ["forty_1", "forty1", "40_1", "401", "forty_time_1", "40 time 1", "forty 1"],
  forty_2: ["forty_2", "forty2", "40_2", "402", "forty_time_2", "40 time 2", "forty 2"],
  selected: ["selected", "select", "is_selected", "team", "keep"],
};

export type RosterRow = {
  first_name: string;
  last_name: string;
  jersey_number: number;
  /** First value from the positions cell. */
  primary_position: PositionKey;
  /** The rest, deduped, never containing the primary. */
  secondary_positions: PositionKey[];
  forty_1: number | null;
  forty_2: number | null;
  selected: boolean;
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

/**
 * "R (Rush)" -> "R", "  wr " -> "WR".
 *
 * A sheet built for humans labels its options the way a human reads them, so
 * the parenthetical gloss is stripped rather than making someone re-type the
 * column before every import.
 */
export function normalizePosition(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").trim().toUpperCase();
}

/** Read a column under any of its accepted spellings. */
function readColumn(
  rec: Record<string, unknown>,
  canonical: string,
): string | undefined {
  const accepted = COLUMN_ALIASES[canonical] ?? [canonical];
  for (const key of Object.keys(rec)) {
    if (accepted.includes(key.trim().toLowerCase())) {
      return String(rec[key] ?? "").trim();
    }
  }
  return undefined;
}

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

    // Trailing blank rows are ignored, not an error. Spreadsheet exports are
    // full of them.
    if (isBlankRecord(rec)) {
      skippedBlank++;
      return;
    }

    const get = (k: string) => String(rec[k] ?? "").trim();

    const first = get("first_name");
    const last = get("last_name");
    const jerseyRaw = get("jersey_number");
    const positionsRaw = get("positions");

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
        errors.push({ line, message: `jersey_number ${jersey} is out of range.` });
        jersey = null;
      } else if (seenJerseys.has(jersey)) {
        errors.push({
          line,
          message: `jersey_number ${jersey} is already used on line ${seenJerseys.get(jersey)}.`,
        });
        jersey = null;
      } else if (existingJerseys.has(jersey)) {
        errors.push({
          line,
          message: `jersey_number ${jersey} is already taken in this tryout.`,
        });
        jersey = null;
      } else {
        seenJerseys.set(jersey, line);
      }
    }

    // --- positions (multi-select cell) ---
    // First value is primary, the rest are secondary. Order is meaningful.
    let primary: PositionKey | null = null;
    const secondary: PositionKey[] = [];

    if (!positionsRaw) {
      errors.push({
        line,
        message: `positions is empty. Expected something like "WR, DB".`,
      });
    } else {
      const parts = positionsRaw
        .split(",")
        .map((x) => normalizePosition(x))
        .filter((x) => x.length > 0);

      if (parts.length === 0) {
        errors.push({ line, message: "positions has no usable values." });
      }

      const seen = new Set<PositionKey>();
      for (const part of parts) {
        if (!VALID_POSITIONS.includes(part as PositionKey)) {
          errors.push({
            line,
            message: `position "${part}" is not a known position. Valid: ${VALID_POSITIONS.join(", ")}.`,
          });
          continue;
        }
        const key = part as PositionKey;
        // Duplicates within a cell collapse; a prospect cannot be his own
        // secondary position.
        if (seen.has(key)) continue;
        seen.add(key);
        if (primary === null) primary = key;
        else secondary.push(key);
      }
    }

    // --- optional 40 times ---
    // A blank cell means not timed. Something unparseable IS an error -
    // silently dropping a time the user believes they imported is worse than
    // refusing the file.
    const forty: Record<1 | 2, number | null> = { 1: null, 2: null };
    for (const attempt of [1, 2] as const) {
      const raw = readColumn(rec, `forty_${attempt}`);
      if (raw === undefined || raw === "") continue;
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw)) {
        errors.push({
          line,
          message: `40 time "${raw}" (attempt ${attempt}) is not a time like 4.61.`,
        });
        continue;
      }
      const v = Number(raw);
      // Mirrors the CHECK constraint: value > 0 and value < 20.
      if (!(v > 0 && v < 20)) {
        errors.push({
          line,
          message: `40 time ${v} (attempt ${attempt}) must be between 0 and 20 seconds.`,
        });
        continue;
      }
      forty[attempt] = v;
    }

    // --- optional selected flag ---
    let selected = false;
    const selRaw = readColumn(rec, "selected");
    if (selRaw !== undefined && selRaw !== "") {
      const v = selRaw.toLowerCase();
      if (v === "true" || v === "1") selected = true;
      else if (v === "false" || v === "0") selected = false;
      else {
        errors.push({
          line,
          message: `selected "${selRaw}" is not recognized. Use TRUE, true, 1, FALSE, false, 0, or leave it blank.`,
        });
      }
    }

    if (first && last && jersey !== null && primary !== null) {
      rows.push({
        first_name: first,
        last_name: last,
        jersey_number: jersey,
        primary_position: primary,
        secondary_positions: secondary,
        forty_1: forty[1],
        forty_2: forty[2],
        selected,
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
