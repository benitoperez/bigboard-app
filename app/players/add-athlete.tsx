"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAthlete } from "./add-actions";

/**
 * Add an athlete by hand, for anyone who turns up who was not on the imported
 * sheet. Open to every officer, per the write_prospects policy.
 *
 * A centred sheet rather than an inline form: this opens from a header button
 * on a phone, and a sheet cannot end up half off-screen the way an anchored
 * panel can.
 */
export type PositionOption = { code: string; label: string };

export function AddAthlete({
  tryoutName,
  positions,
  size = "normal",
}: {
  tryoutName: string;
  /** The org template's positions, in board order. */
  positions: PositionOption[];
  /**
   * "large" is for an empty roster, where adding someone is the only thing
   * worth doing on the screen. It shrinks back to "normal" once there is at
   * least one athlete and the list itself is the point.
   */
  size?: "normal" | "large";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          size === "large"
            ? "min-h-tap-large w-full rounded-lg bg-primary px-6 text-base font-bold " +
              "tracking-wide text-primary-foreground active:opacity-80"
            : "min-h-tap shrink-0 rounded-md border border-border bg-card px-3 text-sm " +
              "font-semibold text-foreground active:bg-secondary"
        }
      >
        {size === "large" ? "+ Add an athlete" : "+ Add"}
      </button>

      {open && (
        <AddSheet
          tryoutName={tryoutName}
          positions={positions}
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function AddSheet({
  tryoutName,
  positions,
  onClose,
  onAdded,
}: {
  tryoutName: string;
  positions: PositionOption[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [primaryPosition, setPrimary] = useState<string>(positions[0]?.code ?? "");
  const [secondary, setSecondary] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function toggleSecondary(p: string) {
    setSecondary((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addAthlete({
        firstName,
        lastName,
        jerseyNumber,
        primaryPosition,
        secondaryPositions: secondary,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onAdded();
    });
  }

  const canSubmit =
    firstName.trim() && lastName.trim() && jerseyNumber.trim() && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add an athlete"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/80"
      />

      <form
        onSubmit={submit}
        className="relative max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-lg
                   border border-border bg-popover p-4 shadow-2xl"
      >
        <h2 className="text-xl uppercase">Add athlete</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Added to {tryoutName}.
        </p>

        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <label htmlFor="a-first" className="block text-sm text-muted-foreground">
              First name
            </label>
            <input
              id="a-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoCapitalize="words"
              disabled={pending}
              className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                         text-base text-foreground outline-none focus-visible:border-primary
                         focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="a-last" className="block text-sm text-muted-foreground">
              Last name
            </label>
            <input
              id="a-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoCapitalize="words"
              disabled={pending}
              className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                         text-base text-foreground outline-none focus-visible:border-primary
                         focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </div>
        </div>

        <label htmlFor="a-jersey" className="mt-3 block text-sm text-muted-foreground">
          Jersey number
        </label>
        <input
          id="a-jersey"
          value={jerseyNumber}
          onChange={(e) => setJerseyNumber(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="00"
          disabled={pending}
          className="tnum min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                     text-center text-xl font-bold text-foreground
                     placeholder:text-muted-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2
                     focus-visible:ring-ring/40 disabled:opacity-50"
        />

        <label htmlFor="a-pos" className="mt-3 block text-sm text-muted-foreground">
          Primary position
        </label>
        <select
          id="a-pos"
          value={primaryPosition}
          onChange={(e) => setPrimary(e.target.value)}
          disabled={pending}
          className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                     text-base text-foreground outline-none focus-visible:border-primary
                     disabled:opacity-50"
        >
          {positions.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} — {p.label}
            </option>
          ))}
        </select>

        <p className="mt-3 text-sm text-muted-foreground">
          Also trying out at (optional)
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {positions.filter((p) => p.code !== primaryPosition).map((p) => {
            const on = secondary.includes(p.code);
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => toggleSecondary(p.code)}
                aria-pressed={on}
                disabled={pending}
                className={
                  "min-h-tap rounded-full px-4 text-sm font-bold uppercase disabled:opacity-50 " +
                  (on
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground")
                }
              >
                {p.code}
              </button>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="min-h-tap flex-1 rounded-md border border-border text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold
                       text-primary-foreground disabled:opacity-40"
          >
            {pending ? "Adding..." : "Add athlete"}
          </button>
        </div>
      </form>
    </div>
  );
}
