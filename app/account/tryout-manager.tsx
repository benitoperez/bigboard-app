"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tryoutPeriod, type TryoutWithCount } from "@/lib/tryouts";
import { renameTryout, setActiveTryout } from "./tryout-actions";
import { CreateForm } from "./create-tryout-form";

/**
 * Tryout class picker and creator. Admin only.
 *
 * Switching the active class swaps every other screen onto that year's data.
 * Past classes are never modified or removed, so the switch is reversible and
 * the history stays intact - this is the whole mechanism for running the app
 * season after season.
 */
export function TryoutManager({
  tryouts,
  isAdmin,
}: {
  tryouts: TryoutWithCount[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const active = tryouts.find((t) => t.isActive) ?? null;

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function switchTo(id: string) {
    if (!id || id === active?.id) return;
    setError(null);
    startTransition(async () => {
      const res = await setActiveTryout(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function rename() {
    if (!active) return;
    setError(null);
    startTransition(async () => {
      const res = await renameTryout(active.id, newName);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenaming(false);
      router.refresh();
    });
  }

  return (
    <section className="mt-4 bb-card rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl uppercase">Active Tryout</h2>
        <span className="text-xs text-muted-foreground">
          {tryouts.length} {tryouts.length === 1 ? "class" : "classes"}
        </span>
      </div>

      {!isAdmin ? (
        <>
          <p className="mt-2 text-base font-semibold text-foreground">
            {active ? active.name : "None"}
          </p>
          {active && (
            <p className="mt-1 text-sm text-muted-foreground">
              {[tryoutPeriod(active), `${active.prospectCount} athletes`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            An admin sets which class is active.
          </p>
        </>
      ) : (
        <>
          <label
            htmlFor="active-tryout"
            className="mt-3 block text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase"
          >
            Showing
          </label>
          <select
            id="active-tryout"
            value={active?.id ?? ""}
            disabled={pending}
            onChange={(e) => switchTo(e.target.value)}
            className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                       text-base text-foreground outline-none
                       focus-visible:border-primary focus-visible:ring-2
                       focus-visible:ring-ring/40 disabled:opacity-50"
          >
            {!active && <option value="">No active class</option>}
            {tryouts.map((t) => (
              <option key={t.id} value={t.id}>
                {[t.name, tryoutPeriod(t)].filter(Boolean).join(" — ")} (
                {t.prospectCount})
              </option>
            ))}
          </select>

          <p className="mt-2 text-xs text-muted-foreground">
            Every screen shows the class selected here. Switching does not
            change any past class &mdash; their athletes and ratings stay
            exactly as they were.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
              {error}
            </p>
          )}

          {/* Rename, new in v2. `tryouts` has no DELETE policy on purpose -
              a class is the historical record - so without this a typo in a
              class name was permanent. */}
          {active &&
            (renaming ? (
              <div className="mt-3 flex flex-col gap-2">
                <label htmlFor="rename-tryout" className="text-xs text-muted-foreground">
                  Rename &ldquo;{active.name}&rdquo;
                </label>
                <input
                  id="rename-tryout"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={60}
                  disabled={pending}
                  className="min-h-tap rounded-md border border-border bg-input px-3 text-base
                             text-foreground outline-none focus-visible:border-primary
                             disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={rename}
                    disabled={pending || !newName.trim()}
                    className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold
                               text-primary-foreground disabled:opacity-40"
                  >
                    {pending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(false)}
                    disabled={pending}
                    className="min-h-tap rounded-md border border-border px-4 text-sm
                               font-semibold text-muted-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewName(active.name);
                  setRenaming(true);
                  setError(null);
                }}
                disabled={pending}
                className="min-h-tap mt-2 text-xs font-semibold text-muted-foreground"
              >
                Rename this class
              </button>
            ))}

          {creating ? (
            <CreateForm
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
              disabled={pending}
              className="min-h-tap mt-3 w-full rounded-md border border-border px-4 text-sm
                         font-semibold text-foreground active:bg-secondary disabled:opacity-50"
            >
              + New tryout class
            </button>
          )}
        </>
      )}
    </section>
  );
}
