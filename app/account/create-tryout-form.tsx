"use client";

import { useState, useTransition } from "react";
import {
  SEMESTERS,
  tryoutPeriod,
  yearOptions,
} from "@/lib/tryouts";
import { createTryout } from "./tryout-actions";

/**
 * Create a tryout class.
 *
 * Lives in its own module because it is needed in two very different
 * places: the Account tab's class manager, and the empty state every screen
 * shows when an org has no classes yet. A new club's first job is creating
 * one, and sending them to a settings tab to do it was the long way round.
 */
export function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const years = yearOptions();
  const thisYear = new Date().getFullYear();

  const [name, setName] = useState("");
  const [year, setYear] = useState<string>(String(thisYear));
  const [semester, setSemester] = useState<string>("fall");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const period =
    tryoutPeriod({
      seasonYear: year ? Number(year) : null,
      semester: semester as never,
    }) || "no period";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTryout(name, year ? Number(year) : null, semester);
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      onCreated();
    });
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-secondary p-3">
      <p className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        New tryout class
      </p>

      <label htmlFor="t-name" className="mt-3 block text-sm text-muted-foreground">
        Name
      </label>
      <input
        id="t-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        placeholder="Fall Tryouts"
        disabled={pending || confirming}
        className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                   text-base text-foreground placeholder:text-muted-foreground outline-none
                   focus-visible:border-primary focus-visible:ring-2
                   focus-visible:ring-ring/40 disabled:opacity-50"
      />

      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <label htmlFor="t-year" className="block text-sm text-muted-foreground">
            Year
          </label>
          <select
            id="t-year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={pending || confirming}
            className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                       text-base text-foreground outline-none
                       focus-visible:border-primary disabled:opacity-50"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label htmlFor="t-sem" className="block text-sm text-muted-foreground">
            Semester
          </label>
          <select
            id="t-sem"
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            disabled={pending || confirming}
            className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                       text-base text-foreground outline-none
                       focus-visible:border-primary disabled:opacity-50"
          >
            {SEMESTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Athletes are counted automatically as they are added or imported.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      {/* Save step: creating a class also switches the whole app onto it, so
          it gets a confirmation rather than firing on first tap. */}
      {confirming ? (
        <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 p-3">
          <p className="text-sm text-foreground">
            Create <strong>{name.trim() || "(unnamed)"}</strong> ({period}) and
            make it the active class?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every screen will switch to it. The current class keeps all of its
            athletes and ratings.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-tap flex-1 rounded-md border border-border text-sm font-semibold disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold
                         text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Creating..." : "Save class"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-tap flex-1 rounded-md border border-border text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending || name.trim().length === 0}
            className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold
                       text-primary-foreground disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
