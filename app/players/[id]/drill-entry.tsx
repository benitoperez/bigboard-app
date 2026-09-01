"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DrillDetail } from "@/lib/data/prospect-detail";
import { formatDrillValue } from "@/lib/template";
import { saveDrillAttempt, deleteDrillAttempt } from "./drill-actions";

/**
 * Measured drill entry - SPEC.md sections 8 and 10.3, generalized by
 * SPEC-V2.md section 3.2.
 *
 * v1 had one hardcoded 40 section. A template may now define several drills,
 * so this renders one section per drill the prospect's positions weight,
 * with the attempt count, units, decimals and value range all coming from
 * the drill rather than from constants.
 *
 * Committed on blur or Enter, not on every keystroke: a partially typed "4."
 * is not a measurement, and firing a write per character would put nonsense
 * in the database between keys.
 */
export function DrillEntry({
  prospectId,
  drills,
}: {
  prospectId: string;
  drills: DrillDetail[];
}) {
  if (drills.length === 0) return null;

  return (
    <>
      {drills.map((d) => (
        <DrillSection key={d.drill.key} prospectId={prospectId} detail={d} />
      ))}
    </>
  );
}

function DrillSection({
  prospectId,
  detail,
}: {
  prospectId: string;
  detail: DrillDetail;
}) {
  const { drill, best, avg, percentile, percentileIsValid, measuredCount, attempts } =
    detail;

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        {drill.label}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Anyone can record, correct, or clear an attempt. The{" "}
        {drill.direction === "lower_is_better" ? "fastest" : "best"} result
        feeds the rating.
      </p>

      <div className="mt-2 rounded-lg border border-border bg-card p-4">
        <div className="flex gap-3">
          {Array.from({ length: drill.maxAttempts }, (_, i) => {
            const n = i + 1;
            const existing = attempts.find((a) => a.attemptNumber === n);
            return (
              <AttemptField
                key={n}
                prospectId={prospectId}
                drillKey={drill.key}
                decimals={drill.decimals}
                attemptNumber={n}
                initial={existing ? existing.value.toFixed(drill.decimals) : ""}
                isBest={
                  existing != null && best != null && existing.value === best
                }
              />
            );
          })}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          {best === null ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet.
            </p>
          ) : (
            <p className="tnum text-base font-bold text-foreground">
              {formatDrillValue(drill, best)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                best
              </span>
              {avg !== null && (
                <>
                  {" / "}
                  {formatDrillValue(drill, avg)}{" "}
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
          {best !== null &&
            (percentileIsValid && percentile !== null ? (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="tnum font-bold text-foreground">
                  {ordinal(percentile)}
                </span>{" "}
                percentile of the {measuredCount} measured in this tryout
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Percentile hidden until {drill.minTimedForPercentile} prospects
                are measured &mdash; {measuredCount} so far. This drill counts
                as missing until then, so ratings stay gated.
              </p>
            ))}
        </div>
      </div>
    </section>
  );
}

function AttemptField({
  prospectId,
  drillKey,
  decimals,
  attemptNumber,
  initial,
  isBest,
}: {
  prospectId: string;
  drillKey: string;
  decimals: number;
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

    // Emptying a field that held a value clears the attempt. Emptying one
    // that was already empty is a no-op, not a delete of nothing.
    if (trimmed === "") {
      if (committedRef.current === "") return;
      startTransition(async () => {
        const res = await deleteDrillAttempt(prospectId, drillKey, attemptNumber);
        if (!res.ok) {
          setError(res.error);
          setValue(committedRef.current); // put the value back
          return;
        }
        committedRef.current = "";
        router.refresh();
      });
      return;
    }

    startTransition(async () => {
      const res = await saveDrillAttempt(
        prospectId,
        drillKey,
        attemptNumber,
        trimmed,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      committedRef.current = Number(trimmed).toFixed(decimals);
      setValue(committedRef.current);
      router.refresh();
    });
  }

  const fieldId = `${drillKey}-${attemptNumber}`;

  return (
    <div className="flex-1">
      <label
        htmlFor={fieldId}
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
        id={fieldId}
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
