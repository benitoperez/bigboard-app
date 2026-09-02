import { NextResponse, type NextRequest } from "next/server";
import { guardAiRequest, recordAiUsage } from "@/lib/ai/guard";
import { generateFromParts, parseJson, type Part } from "@/lib/ai/gemini";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getTemplateForTryout } from "@/lib/data/template";
import type { Template } from "@/lib/template";

/**
 * Extract a roster from photos or pasted text — SPEC-V2.md section 10b.4.
 *
 * Evaluator+, because import is (section 10b.1). Same guard order and the
 * same ai_usage accounting as every other AI route.
 *
 * NOTHING here writes to the database. The response is a proposal that lands
 * in the review table, where a person edits and confirms it. That separation
 * is the entire safety model for AI-sourced data: the model reads, a human
 * decides.
 */

/** Enough for several pages of roster, small enough to stay in one request. */
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;

type ExtractedRow = {
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | null;
  positions: string[] | null;
  drills?: Record<string, (string | null)[]>;
  /** Field names the model could not read confidently. */
  uncertain?: string[];
};

export async function POST(request: NextRequest) {
  let body: {
    orgId?: string;
    text?: string;
    /** data: URLs, already resized client-side. */
    images?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const images = body.images ?? [];

  if (!text && images.length === 0) {
    return NextResponse.json(
      { error: "Send a photo or some text to read." },
      { status: 400 },
    );
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Up to ${MAX_IMAGES} images at a time.` },
      { status: 413 },
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: "That is too much text at once. Split it up." },
      { status: 413 },
    );
  }

  const guard = await guardAiRequest(body.orgId, "evaluator");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const tryout = await getActiveTryout();
  const template = tryout ? await getTemplateForTryout(tryout.id) : null;
  if (!template) {
    return NextResponse.json(
      { error: "This tryout has no evaluation template." },
      { status: 400 },
    );
  }

  const parts: Part[] = [{ text: buildPrompt(template, text) }];

  for (const image of images) {
    const parsed = parseDataUrl(image);
    if (!parsed) {
      return NextResponse.json(
        { error: "One of the images could not be read." },
        { status: 400 },
      );
    }
    // The cap is re-checked here, not just in the browser: the client
    // resizes for speed, this refuses oversized payloads regardless of what
    // sent them.
    if (parsed.bytes > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "An image is larger than 5MB even after resizing." },
        { status: 413 },
      );
    }
    parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
  }

  const result = await generateFromParts(parts, {
    json: true,
    maxOutputTokens: 8192,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const parsed = parseJson<{ rows?: ExtractedRow[]; notes?: string[] }>(
    result.text,
  );
  if (!parsed?.rows || !Array.isArray(parsed.rows)) {
    return NextResponse.json(
      { error: "The AI response could not be read. Try again, or type it in." },
      { status: 502 },
    );
  }

  await recordAiUsage(guard.orgId, guard.actor.userId!, "roster-extract");

  const validCodes = new Set(template.positions.map((p) => p.code));

  // Every field is coerced and every position checked against the template
  // HERE, so the review table never receives a shape it was not written for.
  // An unrecognized position is kept rather than dropped: the table flags it
  // for correction, and silently discarding it would hide that the model
  // read something the org does not have.
  const rows = parsed.rows.slice(0, 300).map((r) => ({
    first_name: str(r.first_name),
    last_name: str(r.last_name),
    jersey_number: str(r.jersey_number),
    positions: Array.isArray(r.positions) ? r.positions.map(str) : [],
    invalidPositions: Array.isArray(r.positions)
      ? r.positions.map(str).filter((p) => p && !validCodes.has(p.toUpperCase()))
      : [],
    drills: sanitizeDrills(r.drills, template),
    uncertain: Array.isArray(r.uncertain) ? r.uncertain.map(str) : [],
  }));

  return NextResponse.json({
    rows,
    notes: (parsed.notes ?? []).slice(0, 20).map(str),
  });
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function sanitizeDrills(
  drills: Record<string, (string | null)[]> | undefined,
  template: Template,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!drills) return out;
  for (const drill of template.drills) {
    const raw = drills[drill.key];
    if (!Array.isArray(raw)) continue;
    out[drill.key] = raw.slice(0, drill.maxAttempts).map(str);
  }
  return out;
}

/** `data:image/jpeg;base64,...` → the pieces Gemini's inlineData wants. */
function parseDataUrl(
  url: string,
): { mimeType: string; data: string; bytes: number } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!/^image\/(jpeg|jpg|png|heic|heif|webp)$/i.test(mimeType)) return null;
  // base64 is 4 characters per 3 bytes.
  return { mimeType, data, bytes: Math.floor((data.length * 3) / 4) };
}

function buildPrompt(template: Template, pastedText: string): string {
  const codes = template.positions
    .map((p) => `${p.code} (${p.label})`)
    .join(", ");

  const drillFields = template.drills.length
    ? template.drills
        .map(
          (d) =>
            `    "${d.key}": [${Array.from({ length: d.maxAttempts }, () => "string|null").join(", ")}]  // ${d.label} in ${d.unit}`,
        )
        .join("\n")
    : "    (this template defines no measured drills — omit the drills object)";

  return `You are reading a sports team roster and turning it into structured data for a tryout evaluation app.

${pastedText ? "The roster is in the TEXT below." : "The roster is in the attached image(s). There may be several pages."}

Return ONLY JSON in this exact shape:
{
  "rows": [
    {
      "first_name": "string|null",
      "last_name": "string|null",
      "jersey_number": "string|null",
      "positions": ["CODE", ...],
      "drills": {
${drillFields}
      },
      "uncertain": ["field_name", ...]
    }
  ],
  "notes": ["short plain sentence", ...]
}

VALID POSITION CODES — use ONLY these, exactly as written:
${codes}

RULES, IN ORDER OF IMPORTANCE:

1. NEVER GUESS. If you cannot read a value confidently, put null and add that
   field's name to "uncertain" for that row. A blank a human fixes is far
   better than a plausible wrong value that gets imported without anyone
   looking twice. This applies especially to jersey numbers and to
   handwriting.
2. Do not invent people. Only rows actually present in the source.
3. Do not infer a position from a name, a number, or a body type. If the
   source does not state a position, return an empty positions array.
4. Map position words onto the codes above when the meaning is unambiguous
   (a full position name, a common abbreviation). If a position does not map
   to a code above, return it as written and list "positions" in
   "uncertain" — do not substitute the closest one.
5. Split combined name cells into first and last. If only one name is
   present, put it in first_name and null the other.
6. Numbers are digits only, with no units. Leave a value null rather than
   converting between units.
7. Keep the source order.

In "notes", say briefly what was hard to read or what you left blank, at most
10 sentences.${pastedText ? `\n\nTEXT:\n${pastedText}` : ""}`;
}
