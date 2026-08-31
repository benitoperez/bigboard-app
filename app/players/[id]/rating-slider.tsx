"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AttributeDetail } from "@/lib/data/prospect-detail";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEFAULT_VALUE = 5.0;

/**
 * One attribute slider - SPEC.md section 8.
 *
 * THE SAVE RULE: the network is touched on pointer/key RELEASE only, never
 * during drag. Firing a request per drag event lets an older response resolve
 * after a newer one and overwrite the correct value with a stale one. That
 * bug is silent - the officer sees their number, walks away, and the database
 * holds something else.
 *
 * Three things guard it:
 *   1. onChange updates local state only. It never calls save.
 *   2. commit() compares against the last PERSISTED value, so releasing
 *      without moving sends nothing. "Debounce on the value rather than the
 *      event", per the spec.
 *   3. Every save takes a sequence number. A response whose number is no
 *      longer current is discarded, so even overlapping saves cannot regress
 *      the UI.
 *
 * No framer-motion anywhere near the drag path (CLAUDE.md rule 4). The handle
 * follows the finger through the native input only - added latency between
 * finger and handle is unusable with gloves in the sun.
 */
export function RatingSlider({
  attribute,
  prospectId,
  officerId,
}: {
  attribute: AttributeDetail;
  prospectId: string;
  officerId: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<number>(attribute.myValue ?? DEFAULT_VALUE);
  const [hasRated, setHasRated] = useState(attribute.myValue !== null);
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Last value actually persisted. A ref, not state - comparing against it
  // must not depend on a re-render having happened.
  const persistedRef = useRef<number | null>(attribute.myValue);
  const seqRef = useRef(0);

  const commit = useCallback(async () => {
    // Debounce on the VALUE: releasing without having moved sends nothing.
    if (persistedRef.current === value) return;

    const seq = ++seqRef.current;
    const attempted = value;
    setStatus("saving");

    const supabase = createClient();
    const { error } = await supabase.from("ratings").upsert(
      {
        prospect_id: prospectId,
        officer_id: officerId,
        attribute_key: attribute.key,
        value: attempted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "prospect_id,officer_id,attribute_key" },
    );

    // A response from a superseded save. Drop it - acting on it would show
    // stale state for a value the user has already moved past.
    if (seq !== seqRef.current) return;

    if (error) {
      setStatus("error");
      return;
    }

    persistedRef.current = attempted;
    setHasRated(true);
    setStatus("saved");
    // Pull the recomputed team median and position rating. The slider is
    // already correct locally; this is not blocking anything.
    router.refresh();
  }, [value, prospectId, officerId, attribute.key, router]);

  const percent = (value / 10) * 100;

  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-foreground">
              {attribute.label}
            </span>
            {!hasRated && (
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Not rated
              </span>
            )}
            <SaveIndicator status={status} onRetry={commit} />
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
        // Drag updates local state ONLY. Never saves.
        onChange={(e) => {
          setValue(Number(e.target.value));
          if (status !== "idle") setStatus("idle");
        }}
        // Release commits.
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
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
    </div>
  );
}

/**
 * SPEC.md section 8: show the team rating with its rater count, or a hyphen
 * if nobody has rated it. An 8.4 from one officer and an 8.4 from nine are
 * not the same fact.
 *
 * The circle is uncolored here - the rating color function arrives with the
 * dial in build order step 7.
 */
function TeamRating({ attribute }: { attribute: AttributeDetail }) {
  const { teamRating, raterCount, raters } = attribute;

  return (
    <div className="shrink-0 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-border bg-secondary">
        <span className="tnum text-base font-bold text-foreground">
          {teamRating === null ? "--" : teamRating.toFixed(1)}
        </span>
      </div>

      {raterCount === 0 ? (
        <p className="mt-1 text-[10px] text-muted-foreground">no ratings</p>
      ) : (
        <details className="group mt-1">
          <summary className="min-h-[24px] cursor-pointer list-none text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
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

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "saving")
    return <span className="text-[11px] text-muted-foreground">Saving...</span>;
  if (status === "saved")
    return <span className="text-[11px] text-success">Saved</span>;
  if (status === "error")
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-[11px] font-semibold text-destructive underline"
      >
        Failed - retry
      </button>
    );
  return null;
}
