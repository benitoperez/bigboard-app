"use client";

import { useState } from "react";

/**
 * AI scouting summary — SPEC-V2.md section 6.4.
 *
 * The browser calls our own route, never Gemini: the key is server-side and
 * the route verifies org membership and the daily caps before anything
 * leaves for Google.
 *
 * Rendered in a visibly distinct block, and labelled as generated. An
 * officer must be able to tell at a glance which text on this screen came
 * from a teammate and which came from a model.
 */
export function ScoutingSummary({
  prospectId,
  orgId,
}: {
  prospectId: string;
  orgId: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/scouting-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId, orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "That did not work.");
        return;
      }
      setSummary(data.summary as string);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Scouting Summary
      </h2>

      {summary ? (
        <div className="mt-2 rounded-lg border border-chip-violet/40 bg-chip-violet/10 p-4">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            AI generated &middot; from ratings, drills and comments
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{summary}</p>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="min-h-tap mt-3 text-xs font-semibold text-muted-foreground disabled:opacity-50"
          >
            {pending ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="min-h-tap-large mt-2 w-full bb-card rounded-lg border border-border bg-card
                     text-sm font-semibold text-foreground active:bg-secondary disabled:opacity-50"
        >
          {pending ? "Writing..." : "Generate AI scouting summary"}
        </button>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {error}
        </p>
      )}

      {!summary && !error && (
        <p className="mt-2 text-xs text-muted-foreground">
          Three sentences from this athlete&apos;s own data. Not saved &mdash;
          regenerate any time. Names, ratings and comments are sent to
          Google&apos;s API to produce it.
        </p>
      )}
    </section>
  );
}
