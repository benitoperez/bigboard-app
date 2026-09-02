"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSecondaryPosition } from "./actions";

/**
 * SPEC.md section 10.3: a plus button at the end of the secondary dial row.
 * Adding a position immediately reveals its attributes on the rating form.
 *
 * The picker is a CENTERED OVERLAY rather than a dropdown anchored to the
 * button. The button sits at the end of a wrapping row, so its position moves
 * with the number of secondary positions - anchoring the panel to it put the
 * panel off the left edge of a phone screen. A centred sheet cannot be
 * off-frame no matter where the button ends up, and it gets
 * tap-outside-to-dismiss for free.
 */
export function AddPosition({
  prospectId,
  taken,
  positions,
}: {
  prospectId: string;
  taken: string[];
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

  const available = positions.filter((p) => !taken.includes(p.code));
  if (available.length === 0) return null;

  function add(position: string) {
    setError(null);
    startTransition(async () => {
      const res = await addSecondaryPosition(prospectId, position);
      if (!res.ok) {
        setError(res.error ?? "Could not add that position.");
        return;
      }
      setOpen(false);
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
          aria-label="Add a position"
          disabled={pending}
          title="Add a position"
          className="flex h-14 w-14 items-center justify-center rounded-full border
                     border-dashed border-border-strong text-muted-foreground
                     active:bg-secondary disabled:opacity-50"
        >
          <PersonPlusIcon />
        </button>
        <p className="mt-1 text-[11px] text-muted-foreground">Add</p>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Add a position"
        >
          {/* Backdrop: tap anywhere outside to dismiss. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/80"
          />

          <div className="relative w-full max-w-xs rounded-lg border border-border bg-popover p-3 shadow-2xl">
            <p className="px-1 pb-2 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
              Add position
            </p>

            <ul className="space-y-1">
              {available.map((p) => (
                <li key={p.code}>
                  <button
                    type="button"
                    onClick={() => add(p.code)}
                    disabled={pending}
                    className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-left
                               active:bg-secondary disabled:opacity-50"
                  >
                    <span className="tnum w-9 shrink-0 text-base font-bold text-primary">
                      {p.code}
                    </span>
                    <span className="truncate text-sm text-foreground">
                      {p.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {error && (
              <p role="alert" className="px-1 pt-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="mt-2 min-h-tap w-full rounded-md border border-border text-sm
                         font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A person with a plus, matching the athlete iconography elsewhere.
 *
 * Sized and stacked to match a PositionScore so the control sits IN the row
 * of dials rather than beside it - a bare "+" square at a different height
 * read as an unrelated button.
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
