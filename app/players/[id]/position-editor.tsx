"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSecondaryPosition,
  removeSecondaryPosition,
  setPrimaryPosition,
} from "./actions";

/**
 * Add, remove and reorder the positions an athlete is trying out at.
 *
 * The picker is a CENTERED OVERLAY rather than a dropdown anchored to the
 * button. The button sits at the end of a wrapping row, so its position moves
 * with the number of secondary positions — anchoring the panel to it put the
 * panel off the left edge of a phone screen. A centred sheet cannot be
 * off-frame no matter where the button ends up, and it gets
 * tap-outside-to-dismiss for free.
 *
 * EVERY ATHLETE KEEPS AT LEAST ONE POSITION. That is enforced structurally
 * rather than by a check: only secondaries can be removed, so the primary is
 * always there. Promoting a secondary is how a primary entered wrong at
 * import gets fixed — it swaps rather than replaces, so correcting the order
 * never quietly drops a position they were being rated at.
 */
export function PositionEditor({
  prospectId,
  primary,
  secondary,
  positions,
}: {
  prospectId: string;
  primary: string;
  secondary: string[];
  /** The org template's positions, in board order. */
  positions: { code: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Escape closes, and the page behind must not scroll under the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const taken = [primary, ...secondary];
  const available = positions.filter((p) => !taken.includes(p.code));
  const labelFor = (code: string) =>
    positions.find((p) => p.code === code)?.label ?? code;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That did not work.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {/* Mirrors a PositionScore exactly - a 56px tile with an 11px caption
          under it - so this sits IN the row of secondary dials instead of
          floating beside them at a different height. */}
      <div className="shrink-0 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Add or remove positions"
          disabled={pending}
          title="Add or remove positions"
          className="flex h-14 w-14 items-center justify-center rounded-full border
                     border-dashed border-border-strong text-muted-foreground
                     active:bg-secondary disabled:opacity-50"
        >
          <PersonPlusIcon />
        </button>
        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
          Add /<br />
          Remove
        </p>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Positions"
        >
          {/* Backdrop: tap anywhere outside to dismiss. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/80"
          />

          <div className="bb-card-raised relative max-h-[80vh] w-full max-w-xs overflow-y-auto rounded-lg border border-border bg-popover p-3">
            <p className="px-1 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
              Trying out at
            </p>

            <ul className="mt-2">
              <li className="flex items-center gap-2 rounded-md px-1 py-2">
                <span className="tnum w-9 shrink-0 text-base font-bold text-primary">
                  {primary}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {labelFor(primary)}
                </span>
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">
                  Primary
                </span>
              </li>

              {secondary.map((code) => (
                <li key={code} className="rounded-md px-1 py-2">
                  <div className="flex items-center gap-2">
                    <span className="tnum w-9 shrink-0 text-base font-bold text-primary">
                      {code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {labelFor(code)}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-2 pl-11">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setPrimaryPosition(prospectId, code))}
                      className="min-h-tap rounded-md border border-border px-2 text-[11px]
                                 font-semibold text-muted-foreground active:bg-secondary
                                 disabled:opacity-50"
                    >
                      Make primary
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() => removeSecondaryPosition(prospectId, code))
                      }
                      className="min-h-tap rounded-md border border-destructive/40 px-2
                                 text-[11px] font-semibold text-destructive
                                 active:bg-destructive/10 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Said plainly, because the absence of a Remove button beside
                the primary is otherwise just a thing that looks broken. */}
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">
              The primary cannot be removed — every athlete keeps at least one
              position. Promote another first if it is wrong.
            </p>

            {available.length > 0 && (
              <>
                <p className="mt-4 px-1 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                  Also try them at
                </p>
                <ul className="mt-1">
                  {available.map((p) => (
                    <li key={p.code}>
                      <button
                        type="button"
                        onClick={() => run(() => addSecondaryPosition(prospectId, p.code))}
                        disabled={pending}
                        className="flex min-h-tap w-full items-center gap-3 rounded-md px-1
                                   text-left active:bg-secondary disabled:opacity-50"
                      >
                        <span className="tnum w-9 shrink-0 text-base font-bold text-primary">
                          {p.code}
                        </span>
                        <span className="truncate text-sm text-foreground">
                          {p.label}
                        </span>
                        <span className="ml-auto shrink-0 text-lg text-muted-foreground">
                          +
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {error && (
              <p role="alert" className="px-1 pt-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-tap mt-3 w-full rounded-md border border-border text-sm
                         font-semibold text-foreground"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A person with a plus, matching the athlete iconography elsewhere.
 */
function PersonPlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="7" r="4" />
      <path d="M18 8v6M21 11h-6" />
    </svg>
  );
}
