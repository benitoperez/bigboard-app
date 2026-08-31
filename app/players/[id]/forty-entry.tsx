"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_FORTY_ATTEMPTS, MIN_TIMED_FOR_PERCENTILE } from "@/lib/config/positions";
import { saveFortyAttempt, deleteFortyAttempt } from "./forty-actions";

type Attempt = { attemptNumber: number; value: number };

/**
 * 40 yard dash entry - SPEC.md sections 8 and 10.3.
 *
 * Two attempt fields, editable by anyone. Committed on blur or Enter, not on
 * every keystroke: a partially typed "4." is not a time, and firing a write
 * per character would put nonsense in the database between keys.
 */
export function FortyEntry({
  prospectId,
  attempts,
  bestForty,
  avgForty,
  speedPercentile,
  percentileIsValid,
  timedCount,
}: {
  prospectId: string;
  attempts: Attempt[];
  bestForty: number | null;
  avgForty: number | null;
  speedPercentile: number | null;
  percentileIsValid: boolean;
  timedCount: number;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        40 Yard Dash
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Any officer can record, correct, or clear either attempt. The best time feeds
        the rating.
      </p>

      <div className="mt-2 rounded-lg border border-border bg-card p-4">
        <div className="flex gap-3">
          {Array.from({ length: MAX_FORTY_ATTEMPTS }, (_, i) => {
            const n = i + 1;
            const existing = attempts.find((a) => a.attemptNumber === n);
            return (
              <AttemptField
                key={n}
                prospectId={prospectId}
                attemptNumber={n}
                initial={existing ? existing.value.toFixed(2) : ""}
                isBest={
                  existing != null &&
                  bestForty != null &&
                  existing.value === bestForty
                }
              />
            );
          })}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          {bestForty === null ? (
            <p className="text-sm text-muted-foreground">
              No time recorded yet.
            </p>
          ) : (
            <p className="tnum text-base font-bold text-foreground">
              {bestForty.toFixed(2)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                best
              </span>
              {avgForty !== null && (
                <>
                  {" / "}
                  {avgForty.toFixed(2)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    avg
                  </span>
                </>
              )}
            </p>
          )}

          {/* SPEC.md section 8: the percentile is against THIS tryout class
              only. A 4.9 at a club flag football tryout and a 4.9 at a
              combine are not the same fact. */}
          {bestForty !== null &&
            (percentileIsValid && speedPercentile !== null ? (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="tnum font-bold text-foreground">
                  {ordinal(speedPercentile)}
                </span>{" "}
                percentile of the {timedCount} timed in this tryout
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Percentile hidden until {MIN_TIMED_FOR_PERCENTILE} prospects
                are timed &mdash; {timedCount} so far. Speed counts as missing
                until then, so ratings stay gated.
              </p>
            ))}
        </div>
      </div>
    </section>
  );
}

function AttemptField({
  prospectId,
  attemptNumber,
  initial,
  isBest,
}: {
  prospectId: string;
  attemptNumber: number;
  initial: string;
  isBest: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const committedRef = useRef(initial);

  function commit() {
    const trimmed = value.trim();
    if (trimmed === committedRef.current) return;

    setError(null);

    // Emptying a field that held a time clears the attempt. Emptying one that
    // was already empty is a no-op, not a delete of nothing.
    if (trimmed === "") {
      if (committedRef.current === "") return;
      startTransition(async () => {
        const res = await deleteFortyAttempt(prospectId, attemptNumber);
        if (!res.ok) {
          setError(res.error);
          setValue(committedRef.current); // put the time back
          return;
        }
        committedRef.current = "";
        router.refresh();
      });
      return;
    }

    startTransition(async () => {
      const res = await saveFortyAttempt(prospectId, attemptNumber, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      committedRef.current = Number(trimmed).toFixed(2);
      setValue(committedRef.current);
      router.refresh();
    });
  }

  return (
    <div className="flex-1">
      <label
        htmlFor={`forty-${attemptNumber}`}
        className="flex items-center gap-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Attempt {attemptNumber}
        {isBest && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
            BEST
          </span>
        )}
      </label>
      <input
        id={`forty-${attemptNumber}`}
        type="text"
        inputMode="decimal"
        placeholder="--.--"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-invalid={error !== null}
        className="tnum mt-1 min-h-tap-large w-full rounded-md border border-border bg-input
                   px-3 text-center text-2xl font-bold text-foreground
                   placeholder:text-muted-foreground outline-none
                   focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40
                   disabled:opacity-50"
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
