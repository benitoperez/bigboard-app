import "server-only";

/**
 * Gemini client — SPEC-V2.md section 6.1.
 *
 * SERVER ONLY, and the `server-only` import at the top is what makes that a
 * build error rather than a code review note: if any client component ever
 * reaches this module, the build fails instead of shipping the key.
 *
 * GEMINI_API_KEY is a true secret. It has no NEXT_PUBLIC prefix, it is never
 * passed to a component, and the browser only ever talks to our own /api
 * routes. This is the first secret in the project — every other credential
 * is an anon key that RLS is designed to expose.
 *
 * Plain fetch rather than an SDK: one POST with a JSON body does not justify
 * a dependency, and the request shape here is easier to audit than a wrapper.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Overridable so a model deprecation is a config change, not a deploy. */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status: number };

/**
 * One completion. `json` asks the model to reply with JSON only, which the
 * caller still parses defensively — a model instructed to return JSON is not
 * a guarantee of valid JSON.
 */
export async function generate(
  prompt: string,
  options: { json?: boolean; maxOutputTokens?: number } = {},
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    // A missing key is a deployment problem, not a user problem. Vercel does
    // not apply new env vars to an existing build, so this most often means
    // the var was added without a redeploy.
    return {
      ok: false,
      status: 503,
      error: "AI is not configured on this deployment.",
    };
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 1024,
      ...(options.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
      // A phone on stadium wifi should not hang on this. The caller treats a
      // failure as "try again", and quota is only spent on success.
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { ok: false, status: 504, error: "The AI request timed out." };
  }

  if (!response.ok) {
    // Never surface the provider's body: it can echo request content and, on
    // an auth failure, describe the key.
    const status = response.status === 429 ? 429 : 502;
    return {
      ok: false,
      status,
      error:
        status === 429
          ? "The AI service is rate limiting us. Try again shortly."
          : "The AI service could not be reached.",
    };
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    // Empty usually means the response was filtered. Saying so plainly beats
    // rendering a blank panel.
    return { ok: false, status: 502, error: "The AI returned nothing usable." };
  }

  return { ok: true, text };
}

/** Parse a JSON reply, tolerating a stray code fence. Never throws. */
export function parseJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
