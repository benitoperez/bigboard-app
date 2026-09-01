import { NextResponse, type NextRequest } from "next/server";
import { guardAiRequest, recordAiUsage } from "@/lib/ai/guard";
import { generate, parseJson } from "@/lib/ai/gemini";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getTemplateForTryout } from "@/lib/data/template";
import { optionalColumns, REQUIRED_COLUMNS } from "@/lib/csv/roster";
import type { Template } from "@/lib/template";

/**
 * AI CSV cleanup — SPEC-V2.md section 6.3.
 *
 * Normalizes a messy sheet into the import format BEFORE validation. It is a
 * pre-processor and never an authority: whatever comes back is shown to the
 * admin as a diff, and accepting it runs the ordinary deterministic
 * validator unchanged. A hallucinated position fails validation exactly like
 * a typo'd one.
 *
 * Admin-only, because only admins import.
 */

/** Enough rows to fix a sheet, few enough to stay inside a sane prompt. */
const MAX_ROWS = 200;
const MAX_CHARS = 60_000;

type CleanedResponse = {
  headers?: string[];
  rows?: Record<string, string>[];
  notes?: string[];
};

export async function POST(request: NextRequest) {
  let body: { csv?: string; orgId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const csv = (body.csv ?? "").trim();
  if (!csv) {
    return NextResponse.json({ error: "No file contents." }, { status: 400 });
  }
  if (csv.length > MAX_CHARS) {
    return NextResponse.json(
      {
        error:
          "That file is too large for AI cleanup. Import it directly, or split it.",
      },
      { status: 413 },
    );
  }

  const guard = await guardAiRequest(body.orgId, "admin");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // The template decides what "clean" means — which position codes are real
  // and which drill columns exist. Without it the model would be guessing at
  // the target format.
  const tryout = await getActiveTryout();
  const template = tryout ? await getTemplateForTryout(tryout.id) : null;
  if (!template) {
    return NextResponse.json(
      { error: "This tryout has no evaluation template." },
      { status: 400 },
    );
  }

  const result = await generate(buildPrompt(template, csv), {
    json: true,
    maxOutputTokens: 8192,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const parsed = parseJson<CleanedResponse>(result.text);
  if (!parsed?.headers?.length || !Array.isArray(parsed.rows)) {
    // Instructing a model to return JSON is not a guarantee of valid JSON,
    // so this is a normal outcome, not an exception.
    return NextResponse.json(
      { error: "The AI response could not be read. Try again, or import directly." },
      { status: 502 },
    );
  }

  // Every value is coerced to a string and every row reduced to the declared
  // headers. The validator is next and would reject anything odd, but there
  // is no reason to hand it shapes it was never written for.
  const headers = parsed.headers.map((h) => String(h).trim()).filter(Boolean);
  const rows = parsed.rows.slice(0, MAX_ROWS).map((row) => {
    const clean: Record<string, string> = {};
    for (const h of headers) clean[h] = String(row?.[h] ?? "").trim();
    return clean;
  });

  await recordAiUsage(guard.orgId, guard.actor.userId!, "csv-cleanup");

  return NextResponse.json({
    headers,
    rows,
    notes: (parsed.notes ?? []).slice(0, 20).map((n) => String(n)),
  });
}

function buildPrompt(template: Template, csv: string): string {
  const codes = template.positions.map((p) => p.code).join(", ");
  const optional = optionalColumns(template).join(", ");

  return `You are cleaning up a roster spreadsheet exported from Google Sheets so it can be imported into a tryout evaluation app.

Return ONLY JSON matching this shape:
{"headers": string[], "rows": [{"column": "value"}], "notes": string[]}

TARGET FORMAT
Required columns (exact names): ${REQUIRED_COLUMNS.join(", ")}
Optional columns (exact names): ${optional}

Column rules:
- first_name, last_name: split a combined name column if needed. Trim whitespace.
- jersey_number: a whole number, digits only.
- positions: ONE quoted comma-separated cell, first value is the primary position. Valid codes are exactly: ${codes}
- Drill columns hold plain numbers. Blank means not measured; leave it blank.
- selected: TRUE, FALSE, or blank.

WHAT TO DO
- Rename headers to the exact target names above.
- Map position spellings and full names onto the valid codes (for example a full position name, a lowercase code, or a code with a parenthetical gloss).
- Split, trim, and normalize obvious formatting mess: stray spaces, smart quotes, a stray unit like "s" or "sec" after a time.
- Drop completely blank rows.

WHAT NOT TO DO
- Do NOT invent data. If a value is missing, leave the cell blank.
- Do NOT guess a position you cannot confidently map. Leave the original text in place so validation can reject it and a human can look.
- Do NOT reorder or drop athletes.
- Do NOT change numbers other than removing units and stray characters.

In "notes", list the kinds of changes you made in short plain sentences, at most 10. If you left something unmapped, say so.

SPREADSHEET:
${csv}`;
}
