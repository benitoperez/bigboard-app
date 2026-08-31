"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BOARD_ORDER, POSITIONS, type PositionKey } from "@/lib/config/positions";
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
}: {
  prospectId: string;
  taken: PositionKey[];
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

  const available = BOARD_ORDER.filter((p) => !taken.includes(p));
  if (available.length === 0) return null;

  function add(position: PositionKey) {
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Add a position"
        disabled={pending}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed
                   border-border-strong text-xl leading-none text-muted-foreground
                   active:bg-secondary disabled:opacity-50"
      >
        +
      </button>

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
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    disabled={pending}
                    className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-left
                               active:bg-secondary disabled:opacity-50"
                  >
                    <span className="tnum w-9 shrink-0 text-base font-bold text-primary">
                      {p}
                    </span>
                    <span className="truncate text-sm text-foreground">
                      {POSITIONS[p].label}
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
