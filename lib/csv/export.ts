import type { Template } from "@/lib/template";
import type { ProspectRow } from "@/lib/data/prospects";

/**
 * A prospect plus their individual drill attempts.
 *
 * ProspectRow carries best/avg/percentile because that is what every screen
 * shows; the export also needs the raw attempts, because those are what an
 * importer can read back in. lib/data/export.ts assembles this.
 */
export type ExportProspect = ProspectRow & {
  /** Attempt values by drill key, 1-based positionally, null where absent. */
  attempts: Record<string, (number | null)[]>;
};

/**
 * Wide-format roster export — SPEC-V2.md section 10c.
 *
 * One row per prospect. Every column is derived from the org's template, so
 * a baseball club exports exit velocities where a football club exports 40
 * times, and nothing here knows the name of either.
 *
 * Pure on purpose: no Supabase, no file system. The column shape is the part
 * worth testing, and scripts/verify-export.ts does exactly that.
 */

/** A blank cell. NOT zero — see toCell. */
const BLANK = "";

/**
 * Missing data exports as an empty cell, never 0.
 *
 * This is the single most consequential rule in this file. A spreadsheet
 * averages a column; a 0 standing in for "nobody rated this" drags that
 * average down and silently makes an unevaluated athlete look bad. Every
 * absent value here — an ungated rating, an unrated attribute, an unmeasured
 * drill — is blank.
 */
function toCell(v: number | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return BLANK;
  return decimals === undefined ? String(v) : v.toFixed(decimals);
}

/** RFC 4180: quote when the value could otherwise break the row. */
export function escapeCsv(value: string): string {
  if (value === "") return "";
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type ExportColumn = {
  header: string;
  value: (p: ExportProspect) => string;
};

export function buildColumns(
  template: Template,
  selectedIds: ReadonlySet<string>,
): ExportColumn[] {
  const columns: ExportColumn[] = [
    { header: "first_name", value: (p) => p.firstName },
    { header: "last_name", value: (p) => p.lastName },
    { header: "jersey_number", value: (p) => String(p.jerseyNumber) },
    { header: "primary_position", value: (p) => p.primaryPosition },
    {
      // Space after the comma so a spreadsheet shows it readably in one
      // cell; the importer splits on comma and trims, so this round-trips.
      header: "secondary_positions",
      value: (p) => p.secondaryPositions.join(", "),
    },
    {
      header: "selected",
      value: (p) => (selectedIds.has(p.id) ? "TRUE" : "FALSE"),
    },
  ];

  // Per drill: every attempt, then best and average. Attempts are what the
  // importer reads back; best and avg are what a coach actually sorts on.
  for (const drill of template.drills) {
    for (let n = 1; n <= drill.maxAttempts; n++) {
      const index = n - 1;
      columns.push({
        header: `${drill.key}_${n}`,
        value: (p) => toCell(p.attempts[drill.key]?.[index], drill.decimals),
      });
    }
    columns.push({
      header: `${drill.key}_best`,
      value: (p) => toCell(p.drills[drill.key]?.best, drill.decimals),
    });
    columns.push({
      header: `${drill.key}_avg`,
      value: (p) => toCell(p.drills[drill.key]?.avg, drill.decimals),
    });
    columns.push({
      header: `${drill.key}_percentile`,
      value: (p) => toCell(p.drills[drill.key]?.percentile),
    });
  }

  // Per position: the rating and how many officer inputs produced it. Both
  // blank where the prospect does not play the position, and both blank
  // where the rating is gated — a gated position has no number, and the
  // input count alone would imply one.
  for (const position of [...template.positions].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )) {
    columns.push({
      header: `${position.code}_rating`,
      value: (p) => toCell(p.ratingsByPosition[position.code]?.rating),
    });
    columns.push({
      header: `${position.code}_inputs`,
      value: (p) => {
        const r = p.ratingsByPosition[position.code];
        if (!r || r.rating === null) return BLANK;
        return String(r.inputs);
      },
    });
  }

  // Per attribute: the team median and the rater count. An 8.4 from one
  // officer and an 8.4 from nine are not the same fact (SPEC.md section 8),
  // and an export that dropped the count would lose that distinction the
  // whole app is built to preserve.
  for (const attr of template.attributes) {
    columns.push({
      header: `${attr.key}_median`,
      value: (p) => toCell(p.attributeRatings[attr.key]?.teamRating, 1),
    });
    columns.push({
      header: `${attr.key}_raters`,
      value: (p) => toCell(p.attributeRatings[attr.key]?.raterCount),
    });
  }

  return columns;
}

export function buildCsv(
  template: Template,
  prospects: ExportProspect[],
  selectedIds: ReadonlySet<string>,
): string {
  const columns = buildColumns(template, selectedIds);

  const lines = [columns.map((c) => escapeCsv(c.header)).join(",")];
  for (const p of prospects) {
    lines.push(columns.map((c) => escapeCsv(c.value(p))).join(","));
  }

  // CRLF per RFC 4180, and a trailing newline so the last row is terminated.
  return lines.join("\r\n") + "\r\n";
}

/**
 * `{org}-{tryout}-{date}.csv`, slugified.
 *
 * The org is in the name because someone running two clubs will otherwise
 * end up with two files called the same thing in one downloads folder.
 */
export function exportFilename(
  orgName: string,
  tryoutName: string,
  scope?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const parts = [orgName, tryoutName, scope, date].filter(Boolean) as string[];
  return `${parts.map(slug).filter(Boolean).join("-")}.csv`;
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
