import type { Template, TemplateDrill } from "@/lib/template";

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
 *
 * SPEC-V2.md: the drill columns are TEMPLATE-DRIVEN. A flag football sheet
 * still carries forty_1 and forty_2; a baseball sheet carries
 * exit_velocity_1, sixty_yard_dash_1 and so on. Nothing here knows the name
 * of a single drill.
 */

export const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "jersey_number",
  "positions",
] as const;

const SELECTED_ALIASES = ["selected", "select", "is_selected", "team", "keep"];

/**
 * Accepted spellings for one drill attempt column. A real sheet header is
 * whatever the person who built it typed, so the drill's key AND its label
 * both generate candidates - "forty_1", "40_1" and "40 yard dash 1" all
 * reach the same column, without any drill name being written out here.
 */
export function drillColumnAliases(
  drill: TemplateDrill,
  attempt: number,
): string[] {
  const stems = new Set<string>([drill.key, drill.label.toLowerCase()]);

  // A label that opens with a number gives the shorthand people actually
  // type: "40 Yard Dash" -> "40".
  const leadingNumber = drill.label.match(/^(\d+)/)?.[1];
  if (leadingNumber) stems.add(leadingNumber);

  const out = new Set<string>();
  for (const stem of stems) {
    const base = stem.trim().toLowerCase();
    const snake = base.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const spaced = base.replace(/[^a-z0-9]+/g, " ").trim();
    out.add(`${snake}_${attempt}`);
    out.add(`${snake}${attempt}`);
    out.add(`${spaced} ${attempt}`);
    out.add(`${snake}_time_${attempt}`);
    out.add(`${spaced} time ${attempt}`);
  }
  return [...out];
}

/** Every optional column this template accepts, for error messages and docs. */
export function optionalColumns(template: Template): string[] {
  const cols: string[] = [];
  for (const drill of template.drills) {
    for (let n = 1; n <= drill.maxAttempts; n++) cols.push(`${drill.key}_${n}`);
  }
  cols.push("selected");
  return cols;
}

export type RosterRow = {
  first_name: string;
  last_name: string;
  jersey_number: number;
  /** First value from the positions cell. */
  primary_position: string;
  /** The rest, deduped, never containing the primary. */
  secondary_positions: string[];
  /**
   * Parsed attempts per drill key, indexed by attempt number (1-based) with
   * null for a blank cell. Only drills the template defines appear.
   */
  drills: Record<string, (number | null)[]>;
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
  accepted: readonly string[],
): string | undefined {
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
 * @param template The tryout's evaluation template: the ONLY source of valid
 *   position codes and of which drill columns exist.
 */
export function validateRoster(
  records: Record<string, unknown>[],
  headers: string[],
  existingJerseys: ReadonlySet<number>,
  template: Template,
): ValidationResult {
  const validPositions = template.positions.map((p) => p.code);
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
    let primary: string | null = null;
    const secondary: string[] = [];

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

      const seen = new Set<string>();
      for (const part of parts) {
        if (!validPositions.includes(part)) {
          errors.push({
            line,
            message: `position "${part}" is not a known position. Valid: ${validPositions.join(", ")}.`,
          });
          continue;
        }
        const key = part;
        // Duplicates within a cell collapse; a prospect cannot be his own
        // secondary position.
        if (seen.has(key)) continue;
        seen.add(key);
        if (primary === null) primary = key;
        else secondary.push(key);
      }
    }

    // --- optional drill columns, one group per measured drill ---
    // A blank cell means not measured. Something unparseable IS an error -
    // silently dropping a value the user believes they imported is worse
    // than refusing the file.
    const drills: Record<string, (number | null)[]> = {};
    for (const drill of template.drills) {
      const attempts: (number | null)[] = [];
      for (let n = 1; n <= drill.maxAttempts; n++) {
        const raw = readColumn(rec, drillColumnAliases(drill, n));
        if (raw === undefined || raw === "") {
          attempts.push(null);
          continue;
        }
        if (!/^\d{1,3}(\.\d{1,3})?$/.test(raw)) {
          errors.push({
            line,
            message: `${drill.label} "${raw}" (attempt ${n}) is not a number.`,
          });
          attempts.push(null);
          continue;
        }
        const v = Number(raw);
        // The drill's own range, not a hardcoded 40-time window.
        if (!(v > drill.valueMin && v <= drill.valueMax)) {
          errors.push({
            line,
            message: `${drill.label} ${v} (attempt ${n}) must be between ${drill.valueMin} and ${drill.valueMax} ${drill.unit}.`,
          });
          attempts.push(null);
          continue;
        }
        attempts.push(v);
      }
      drills[drill.key] = attempts;
    }

    // --- optional selected flag ---
    let selected = false;
    const selRaw = readColumn(rec, SELECTED_ALIASES);
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
        drills,
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
