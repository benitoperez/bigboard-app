"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BOARD_ORDER, POSITIONS, type PositionKey } from "@/lib/config/positions";
import { addSecondaryPosition } from "./actions";

/**
 * SPEC.md section 10.3: a plus button at the end of the secondary dial row.
 * Adding a position immediately reveals its attributes on the rating form.
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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute right-0 z-20 mt-2 w-48 rounded-md border border-border bg-popover p-2 shadow-lg">
          <p className="px-1 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Add position
          </p>
          <ul>
            {available.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  disabled={pending}
                  className="flex min-h-tap w-full items-center gap-2 rounded px-2 text-left
                             text-sm text-foreground active:bg-secondary disabled:opacity-50"
                >
                  <span className="tnum w-8 font-bold text-primary">{p}</span>
                  <span className="truncate text-muted-foreground">
                    {POSITIONS[p].label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="px-1 pt-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
