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

/**
 * Overridable so a model retirement is a config change, not a deploy.
 *
 * This is not hypothetical: the first default here (gemini-2.0-flash) was
 * already retired by the time the feature was switched on, and the API
 * answered 404 with a message naming its replacement. Whatever is current
 * when you read this, the env var is the way to move.
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/**
 * One piece of a request. Text, or an inline image.
 *
 * Images are sent as base64 in the request body rather than uploaded first:
 * a resized roster photo is a few hundred KB, and the Files API would add a
 * round trip and a lifetime to manage for something used once.
 */
export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

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
  return generateFromParts([{ text: prompt }], options);
}

/** The multimodal form. `generate` is the text-only shorthand for it. */
export async function generateFromParts(
  parts: Part[],
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
    contents: [{ role: "user", parts }],
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
      // failure as "try again", and quota is only spent on success. Reading
      // several roster photos genuinely takes longer than answering about
      // one athlete, so the budget scales with what was sent.
      signal: AbortSignal.timeout(
        parts.some((p) => "inlineData" in p) ? 90_000 : 25_000,
      ),
    });
  } catch {
    return { ok: false, status: 504, error: "The AI request timed out." };
  }

  if (!response.ok) {
    // The provider's body never reaches the client - it can echo request
    // content and, on an auth failure, describe the key. It DOES go to the
    // server log, because "could not be reached" is untriageable otherwise
    // and this is the only place the real reason exists. Vercel:
    // Deployments -> the deployment -> Logs.
    const detail = await response.text().catch(() => "");
    console.error(
      `[gemini] ${MODEL} -> HTTP ${response.status}: ${detail.slice(0, 500)}`,
    );

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
