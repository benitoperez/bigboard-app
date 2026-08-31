"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleSelection } from "@/app/selected/actions";

/**
 * The add control - SPEC.md section 10.4.
 *
 * A plus inside a rounded square, appearing in two places: each row in the
 * Players directory and the player profile header.
 *
 *   not selected - outlined square, plus sign
 *   selected     - filled green square, checkmark
 *
 * Optimistic: the square flips immediately and syncs after. On a field with
 * bad wifi the officer must not be left wondering whether the tap registered.
 * If the write fails it flips back and says so.
 */
export function SelectToggle({
  prospectId,
  prospectName,
  initialSelected,
  size = "md",
}: {
  prospectId: string;
  prospectName: string;
  initialSelected: boolean;
  size?: "md" | "lg";
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(initialSelected);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const box = size === "lg" ? "h-12 w-12 text-2xl" : "h-11 w-11 text-xl";

  function onClick(e: React.MouseEvent) {
    // Rows are wrapped in a link to the profile; tapping the square must not
    // navigate.
    e.preventDefault();
    e.stopPropagation();

    const next = !selected;
    setSelected(next); // optimistic
    setFailed(false);

    startTransition(async () => {
      const res = await toggleSelection(prospectId, next);
      if (!res.ok) {
        setSelected(!next); // roll back
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={
        selected
          ? `Remove ${prospectName} from the team list`
          : `Add ${prospectName} to the team list`
      }
      title={failed ? "Could not save - tap to retry" : undefined}
      className={
        `${box} flex shrink-0 items-center justify-center rounded-md border-2 font-bold leading-none transition-colors ` +
        (selected
          ? "border-success bg-success text-background"
          : failed
            ? "border-destructive text-destructive"
            : "border-border-strong text-muted-foreground active:bg-secondary")
      }
    >
      {selected ? <CheckIcon /> : "+"}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
