"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attributeColor, NOT_RATED } from "@/lib/rating-color";
import type { AttributeDetail } from "@/lib/data/prospect-detail";

const DEFAULT_VALUE = 5.0;

type Status = "idle" | "saving" | "saved" | "error";

/**
 * The rating form — SPEC.md section 8, with the save model changed in v2.
 *
 * V1 SAVED ON POINTER RELEASE. This does not. Moving a slider now changes
 * nothing but local state; a Save button appears under the one you moved,
 * and a bar at the bottom commits every pending change at once.
 *
 * That reverses CLAUDE.md rule 3, and it is worth being explicit about WHY,
 * because the rule existed for a real bug:
 *
 *   Rule 3 was written against the stale-response race — save on every drag
 *   event and an older response lands after a newer one, silently writing
 *   the wrong number. Save-on-release fixed that by cutting the number of
 *   requests to one per gesture. An EXPLICIT save cuts it to one per
 *   decision, which is strictly safer still: there is no in-flight request
 *   to be superseded, because nothing is in flight until the officer says
 *   so. The sequence-number guard is gone because there is nothing left for
 *   it to guard.
 *
 * What rule 3 was protecting is therefore preserved, not discarded. What
 * changed is the trade it made: an officer scrolling a long form with
 * gloves on kept nudging sliders and committing ratings they never meant to
 * leave, and an accidental 5.0 counts toward the median exactly like a
 * deliberate one.
 *
 * Still true, and still load-bearing:
 *   - onChange updates local state ONLY. It never touches the network.
 *   - No framer-motion anywhere near the drag path (CLAUDE.md rule 4).
 *   - The upsert conflict target is (prospect_id, officer_id, attribute_key),
 *     which is what makes "an officer can only overwrite his own rating"
 *     true at the database rather than by convention.
 */
export function RatingsPanel({
  attributes,
  prospectId,
  officerId,
}: {
  attributes: AttributeDetail[];
  prospectId: string;
  officerId: string;
}) {
  const router = useRouter();

  const [persisted, setPersisted] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(attributes.map((a) => [a.key, a.myValue])),
  );
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(attributes.map((a) => [a.key, a.myValue ?? DEFAULT_VALUE])),
  );

  /**
   * Which sliders the officer has actually moved.
   *
   * An unrated attribute starts the slider at 5.0 with nothing persisted.
   * Comparing values alone would call every unrated attribute "changed" the
   * moment the form loads and offer to save a wall of 5.0s nobody chose —
   * which is precisely the accidental-rating problem this redesign exists
   * to stop.
   */
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-sync when the server sends a different attribute set.
   *
   * useState initializers run ONCE, on mount. Adding a position widens the
   * attribute union, so the new sliders arrived with no entry in `draft` —
   * and `value.toFixed(1)` on undefined threw during render, which is what
   * put the whole profile behind "This page couldn't load". A reload looked
   * like it fixed it only because a fresh mount re-ran the initializer.
   *
   * The server is the truth for what IS saved, so `persisted` is replaced
   * wholesale. Unsaved edits survive: a slider the officer has moved keeps
   * its draft, everything else re-reads from the server. Attributes that
   * disappeared (a position removed) are dropped, so nothing pending can
   * reference a key the template no longer has.
   */
  const [syncedTo, setSyncedTo] = useState(attributes);
  if (syncedTo !== attributes) {
    setSyncedTo(attributes);
    setPersisted(Object.fromEntries(attributes.map((a) => [a.key, a.myValue])));
    setDraft((d) =>
      Object.fromEntries(
        attributes.map((a) => [
          a.key,
          touched.has(a.key) && d[a.key] !== undefined
            ? d[a.key]
            : (a.myValue ?? DEFAULT_VALUE),
        ]),
      ),
    );
    setTouched((t) => {
      const keys = new Set(attributes.map((a) => a.key));
      return new Set([...t].filter((k) => keys.has(k)));
    });
  }

  const dirty = useMemo(
    () =>
      attributes
        .map((a) => a.key)
        .filter(
          (k) =>
            touched.has(k) && (persisted[k] === null || draft[k] !== persisted[k]),
        ),
    [attributes, touched, persisted, draft],
  );

  function change(key: string, value: number) {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
    if (status !== "idle") setStatus("idle");
  }

  function revert(key: string) {
    setDraft((d) => ({ ...d, [key]: persisted[key] ?? DEFAULT_VALUE }));
    setTouched((t) => {
      const next = new Set(t);
      next.delete(key);
      return next;
    });
  }

  /**
   * Write the given attributes in ONE upsert.
   *
   * A row per attribute in a single statement, not a request each: the whole
   * set lands or none of it does, and there is no window where half an
   * officer's opinion is in the database.
   */
  async function save(keys: string[]) {
    if (keys.length === 0) return;

    setStatus("saving");
    setError(null);

    const rows = keys.map((key) => ({
      prospect_id: prospectId,
      officer_id: officerId,
      attribute_key: key,
      value: draft[key],
      updated_at: new Date().toISOString(),
    }));

    const supabase = createClient();
    const { error: err } = await supabase
      .from("ratings")
      .upsert(rows, { onConflict: "prospect_id,officer_id,attribute_key" });

    if (err) {
      setStatus("error");
      setError(err.message);
      return;
    }

    setPersisted((p) => {
      const next = { ...p };
      for (const k of keys) next[k] = draft[k];
      return next;
    });
    setTouched((t) => {
      const next = new Set(t);
      for (const k of keys) next.delete(k);
      return next;
    });
    setStatus("saved");

    // Pull the recomputed team medians and position ratings. The sliders are
    // already correct locally, so nothing is blocked on this.
    router.refresh();
  }

  return (
    <>
      <div className="bb-card mt-2 rounded-lg border border-border bg-card px-4">
        {attributes.map((a) => (
          <Slider
            key={a.key}
            attribute={a}
            value={draft[a.key] ?? a.myValue ?? DEFAULT_VALUE}
            persisted={persisted[a.key]}
            isDirty={dirty.includes(a.key)}
            saving={status === "saving"}
            onChange={(v) => change(a.key, v)}
            onSave={() => save([a.key])}
            onRevert={() => revert(a.key)}
          />
        ))}
      </div>

      {/* One bar for the whole form. It only exists while something is
          pending, so the layout does not carry a permanent empty row. */}
      {dirty.length > 0 && (
        <div className="bb-card-raised sticky bottom-4 z-20 mt-3 rounded-lg border border-primary/50 bg-card p-3">
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-foreground">
              <span className="tnum font-bold">{dirty.length}</span>{" "}
              {dirty.length === 1 ? "rating" : "ratings"} not saved yet
            </p>
            <button
              type="button"
              onClick={() => dirty.forEach(revert)}
              disabled={status === "saving"}
              className="min-h-tap shrink-0 rounded-md border border-border px-3 text-xs
                         font-semibold text-muted-foreground disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => save(dirty)}
              disabled={status === "saving"}
              className="min-h-tap shrink-0 rounded-md bg-primary px-4 text-sm font-bold
                         text-primary-foreground disabled:opacity-50"
            >
              {status === "saving" ? "Saving..." : `Save ${dirty.length}`}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {dirty.length === 0 && status === "saved" && (
        <p role="status" className="mt-2 text-center text-xs text-success">
          Saved. Ratings and boards updated.
        </p>
      )}
    </>
  );
}

function Slider({
  attribute,
  value,
  persisted,
  isDirty,
  saving,
  onChange,
  onSave,
  onRevert,
}: {
  attribute: AttributeDetail;
  value: number;
  persisted: number | null;
  isDirty: boolean;
  saving: boolean;
  onChange: (v: number) => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const percent = (value / 10) * 100;

  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-foreground">
              {attribute.label}
            </span>
            {persisted === null && !isDirty && (
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Not rated
              </span>
            )}
            {isDirty && (
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">
                Unsaved
              </span>
            )}
          </div>
        </div>

        <TeamRating attribute={attribute} />
      </div>

      {/* Value bubble sits over the handle so the officer's own number is
          readable without looking away from the slider. */}
      <div className="relative mt-6 mb-1 h-0">
        <span
          className="tnum absolute -top-5 -translate-x-1/2 text-sm font-bold text-primary"
          style={{ left: `calc(${percent}% + ${(50 - percent) * 0.32}px)` }}
          aria-hidden="true"
        >
          {value.toFixed(1)}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={10}
        step={0.1}
        value={value}
        // Local state only. Nothing here reaches the network — the Save
        // button below is the only thing that writes.
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${attribute.label}, your rating`}
        aria-valuetext={value.toFixed(1)}
        className="bb-slider w-full"
        style={{ "--pct": `${percent}%` } as React.CSSProperties}
      />

      {/* Tick marks at whole numbers. The value still moves continuously. */}
      <div className="mt-1 flex justify-between px-1" aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={i}
            className={
              "h-1 w-px " + (i % 5 === 0 ? "bg-border-strong" : "bg-border")
            }
          />
        ))}
      </div>

      {/* The per-attribute save. Appears only once this slider has moved, so
          the form stays quiet while an officer scrolls past attributes they
          are not judging. */}
      {isDirty && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold
                       text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : `Save ${value.toFixed(1)}`}
          </button>
          <button
            type="button"
            onClick={onRevert}
            disabled={saving}
            className="min-h-tap rounded-md border border-border px-3 text-xs
                       font-semibold text-muted-foreground disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * SPEC.md section 8: show the team rating with its rater count, or a hyphen
 * if nobody has rated it. An 8.4 from one officer and an 8.4 from nine are
 * not the same fact.
 *
 * The circle takes its color from the shared scale, lifted from the 0-10
 * attribute scale to the 0-100 one by attributeColor().
 */
function TeamRating({ attribute }: { attribute: AttributeDetail }) {
  const { teamRating, raterCount, raters } = attribute;
  const color = attributeColor(teamRating);

  return (
    <div className="shrink-0 text-center">
      <div
        className="bb-attr-dial flex h-12 w-12 items-center justify-center rounded-full border-2 bg-secondary"
        style={{ borderColor: color }}
      >
        <span className="tnum text-base font-bold" style={{ color }}>
          {teamRating === null ? NOT_RATED : teamRating.toFixed(1)}
        </span>
      </div>

      {raterCount === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">no ratings</p>
      ) : (
        <details className="group mt-1">
          <summary className="min-h-[24px] cursor-pointer list-none text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2">
            {raterCount} {raterCount === 1 ? "rater" : "raters"}
          </summary>
          <div className="absolute right-6 z-10 mt-1 w-44 rounded-md border border-border bg-popover p-2 text-left shadow-lg">
            <ul className="space-y-1">
              {raters.map((r) => (
                <li
                  key={r.officerId}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="truncate text-muted-foreground">
                    {r.displayName}
                  </span>
                  <span className="tnum font-bold text-foreground">
                    {r.value.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
