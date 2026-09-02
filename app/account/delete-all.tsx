"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAllProspects } from "./actions";

/**
 * Clear the whole roster. Admin only.
 *
 * Guarded by a TYPED confirmation, not a tap. This wipes every prospect in
 * the tryout and cascades through all their ratings, times, selections, and
 * comments - typing the word is a deliberate speed bump between a curious tap
 * and losing an evening of evaluations.
 */
export function DeleteAllProspects({ prospectCount }: { prospectCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAllProspects(typed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.deleted);
      setOpen(false);
      setTyped("");
      router.refresh();
    });
  }

  if (done !== null) {
    return (
      <section className="mt-4 bb-card rounded-lg border border-border bg-card p-4">
        <h2 className="text-xl uppercase">Roster cleared</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted <span className="tnum font-bold">{done}</span> prospects and
          everything attached to them.
        </p>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="min-h-tap mt-3 w-full rounded-md border border-border text-sm font-semibold"
        >
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="bb-card mt-4 rounded-lg border border-destructive/30 bg-card p-4">
      <h2 className="text-xl uppercase">Danger zone</h2>

      {!open ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Delete every prospect in this tryout, along with all their ratings,
            40 times, selections, and comments.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={prospectCount === 0}
            className="min-h-tap mt-3 w-full rounded-md border border-destructive/40 px-4
                       text-sm font-semibold text-destructive
                       active:bg-destructive/10 disabled:opacity-40"
          >
            {prospectCount === 0
              ? "No prospects to delete"
              : `Delete all ${prospectCount} prospects`}
          </button>
        </>
      ) : (
        <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-bold text-foreground">
            This deletes {prospectCount} prospects and cannot be undone.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Every rating, 40 time, selection, comment, and headshot in this
            tryout goes with them. Type <strong className="text-foreground">DELETE</strong> to confirm.
          </p>

          <label htmlFor="confirm-delete" className="sr-only">
            Type DELETE to confirm
          </label>
          <input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="DELETE"
            disabled={pending}
            className="min-h-tap mt-3 w-full rounded-md border border-border bg-input px-3
                       text-center text-base font-bold tracking-widest text-foreground
                       placeholder:text-muted-foreground outline-none
                       focus-visible:border-destructive focus-visible:ring-2
                       focus-visible:ring-destructive/40 disabled:opacity-50"
          />

          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
              {error}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              disabled={pending}
              className="min-h-tap flex-1 rounded-md border border-border px-4 text-sm
                         font-semibold text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={pending || typed.trim().toUpperCase() !== "DELETE"}
              className="min-h-tap flex-1 rounded-md bg-destructive px-4 text-sm font-bold
                         text-destructive-foreground disabled:opacity-40"
            >
              {pending ? "Deleting..." : "Delete everything"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
