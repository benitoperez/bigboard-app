"use client";

import { useState, useTransition } from "react";
import { deleteProspect } from "./delete-actions";

/**
 * Delete this prospect. Admin only.
 *
 * Two steps on purpose. The button does not delete - it reveals a panel that
 * names the prospect and spells out what goes with him. Destructive controls
 * that fire on first tap are how a roster loses a player at a tryout, and
 * this one sits directly under a comment box people are already tapping in.
 */
export function DeleteProspect({
  prospectId,
  prospectName,
  jerseyNumber,
}: {
  prospectId: string;
  prospectName: string;
  jerseyNumber: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setError(null);
    startTransition(async () => {
      // Only returns on failure; success redirects to /players.
      const res = await deleteProspect(prospectId);
      if (res && !res.ok) setError(res.error);
    });
  }

  if (!confirming) {
    return (
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-tap w-full rounded-md border border-destructive/40 px-4
                     text-sm font-semibold text-destructive active:bg-destructive/10"
        >
          Delete this prospect
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <p className="text-sm font-bold text-foreground">
        Delete #{jerseyNumber} {prospectName}?
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        This also deletes every rating, 40 time, comment, selection, and the
        headshot for this prospect. It cannot be undone.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="min-h-tap flex-1 rounded-md border border-border px-4 text-sm
                     font-semibold text-foreground disabled:opacity-50"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={doDelete}
          disabled={pending}
          className="min-h-tap flex-1 rounded-md bg-destructive px-4 text-sm font-bold
                     text-destructive-foreground disabled:opacity-50"
        >
          {pending ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
