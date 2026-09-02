"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  PositionComponent,
  Template,
  TemplatePosition,
} from "@/lib/template";
import { resetPositionWeights, savePositionWeights } from "./actions";

/**
 * Weights for one position — SPEC-V2.md section 3.1.
 *
 * The sum-to-100 rule is the guardrail the whole template rests on, so it is
 * shown continuously rather than reported on save: the running total is
 * always visible, and Save stays disabled until it reads exactly 100.
 *
 * A position's judged attributes are DERIVED from these rows. Adding a
 * component here is what makes a slider appear on the profile; removing one
 * is what takes it away. There is no separate attribute list to keep in
 * step.
 */
export function WeightsEditor({
  template,
  position,
}: {
  template: Template;
  position: TemplatePosition;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [draft, setDraft] = useState<PositionComponent[]>(position.components);

  // After a reset or a save, the server hands back new weights. Re-seeding
  // the draft from them is what makes the panel show the restored numbers
  // instead of the ones the user was editing.
  const [syncedTo, setSyncedTo] = useState(position.components);
  if (syncedTo !== position.components) {
    setSyncedTo(position.components);
    setDraft(position.components);
  }

  const total = useMemo(
    () => draft.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0),
    [draft],
  );

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(position.components),
    [draft, position.components],
  );

  const used = new Set(draft.map((c) => `${c.kind}:${c.key}`));
  const available = [
    ...template.attributes
      .filter((a) => !used.has(`attribute:${a.key}`))
      .map((a) => ({ kind: "attribute" as const, key: a.key, label: a.label })),
    ...template.drills
      .filter((d) => !used.has(`drill:${d.key}`))
      .map((d) => ({ kind: "drill" as const, key: d.key, label: d.label })),
  ];

  function labelFor(c: PositionComponent): string {
    const found =
      c.kind === "attribute"
        ? template.attributes.find((a) => a.key === c.key)
        : template.drills.find((d) => d.key === c.key);
    return found?.label ?? c.key;
  }

  function setWeight(i: number, value: number) {
    setSaved(false);
    setDraft((d) => d.map((c, j) => (j === i ? { ...c, weight: value } : c)));
  }

  function remove(i: number) {
    setSaved(false);
    setDraft((d) => d.filter((_, j) => j !== i));
  }

  function add(kind: "attribute" | "drill", key: string) {
    if (!key) return;
    setSaved(false);
    setDraft((d) => [...d, { kind, key, weight: 0 } as PositionComponent]);
  }

  function reset() {
    setError(null);
    startTransition(async () => {
      const res = await resetPositionWeights(template.id, position.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Bring the draft back in step with what was just written, so the
      // panel does not still look dirty against the old values.
      setSaved(true);
      setResetting(false);
      router.refresh();
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePositionWeights(template.id, position.id, draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <ul className="flex flex-col gap-2">
        {draft.map((c, i) => (
          <li key={`${c.kind}:${c.key}`} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{labelFor(c)}</p>
              <p className="text-[11px] text-muted-foreground">
                {c.kind === "drill" ? "measured drill" : "judged attribute"}
              </p>
            </div>

            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={Number.isFinite(c.weight) ? c.weight : ""}
              disabled={pending}
              aria-label={`Weight for ${labelFor(c)}`}
              onChange={(e) => setWeight(i, parseInt(e.target.value, 10))}
              className="tnum min-h-tap w-20 shrink-0 rounded-md border border-border bg-input
                         px-2 text-center text-base font-bold text-foreground outline-none
                         focus-visible:border-primary disabled:opacity-50"
            />

            <button
              type="button"
              onClick={() => remove(i)}
              disabled={pending}
              aria-label={`Remove ${labelFor(c)}`}
              className="min-h-tap shrink-0 rounded-md border border-border px-2 text-xs
                         font-semibold text-muted-foreground active:bg-secondary disabled:opacity-50"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No inputs yet. A position needs at least one before it can be rated.
        </p>
      )}

      {available.length > 0 && (
        <select
          value=""
          disabled={pending}
          aria-label={`Add an input to ${position.code}`}
          onChange={(e) => {
            const [kind, key] = e.target.value.split(":");
            if (kind === "attribute" || kind === "drill") add(kind, key);
          }}
          className="min-h-tap mt-2 w-full rounded-md border border-border bg-input px-3
                     text-sm text-foreground outline-none focus-visible:border-primary
                     disabled:opacity-50"
        >
          <option value="">+ Add an input...</option>
          {available.map((a) => (
            <option key={`${a.kind}:${a.key}`} value={`${a.kind}:${a.key}`}>
              {a.label} ({a.kind === "drill" ? "drill" : "attribute"})
            </option>
          ))}
        </select>
      )}

      {/* The running total is the whole point of this panel. */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Total</p>
        <p
          className={
            "tnum text-lg font-bold " +
            (total === 100 ? "text-primary" : "text-destructive")
          }
        >
          {total} / 100
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {saved && !dirty && (
        <p role="status" className="mt-2 text-xs text-primary">
          Saved. Boards update immediately.
        </p>
      )}

      {resetting ? (
        <div className="mt-2 rounded-md border border-border bg-secondary p-2">
          <p className="text-xs text-foreground">
            Put {position.code} back to the built-in defaults? Your current
            weights for this position are replaced.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="min-h-tap rounded-md border border-border px-3 text-xs
                         font-semibold text-foreground active:bg-card disabled:opacity-50"
            >
              {pending ? "Restoring..." : "Restore defaults"}
            </button>
            <button
              type="button"
              onClick={() => setResetting(false)}
              disabled={pending}
              className="min-h-tap rounded-md border border-border px-3 text-xs
                         font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setResetting(true)}
          disabled={pending}
          className="min-h-tap mt-2 w-full rounded-md border border-border text-xs
                     font-semibold text-muted-foreground active:bg-secondary disabled:opacity-50"
        >
          Reset {position.code} to defaults
        </button>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || total !== 100 || !dirty || draft.length === 0}
        className="min-h-tap mt-2 w-full rounded-md bg-primary text-sm font-bold
                   text-primary-foreground disabled:opacity-40"
      >
        {pending
          ? "Saving..."
          : total === 100
            ? "Save weights"
            : `Must total 100 (currently ${total})`}
      </button>
    </div>
  );
}
