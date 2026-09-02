"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/template";
import { boardOrder } from "@/lib/template";
import { WeightsEditor } from "./weights-editor";
import {
  addAttribute,
  addDrill,
  addPosition,
  componentUsage,
  deleteAttribute,
  deleteDrill,
  deletePosition,
  setMinRatings,
} from "./actions";

const FIELD =
  "min-h-tap w-full rounded-md border border-border bg-input px-3 text-base " +
  "text-foreground outline-none focus-visible:border-primary disabled:opacity-50";

type Result = { ok: boolean; error?: string };

export function TemplateEditor({ template }: { template: Template }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
        >
          {error}
        </p>
      )}

      <PositionsSection template={template} onError={setError} />
      <AttributesSection template={template} onError={setError} />
      <DrillsSection template={template} onError={setError} />
      <GatingSection template={template} onError={setError} />
    </div>
  );
}

function useAction(onError: (e: string | null) => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<Result>, after?: () => void) {
    onError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        onError(res.error ?? "That did not work.");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return { pending, run };
}

// ---------------------------------------------------------------- positions

function PositionsSection({
  template,
  onError,
}: {
  template: Template;
  onError: (e: string | null) => void;
}) {
  const { pending, run } = useAction(onError);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  return (
    <section>
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Positions
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Each position is scored by its own weighted inputs, which must total
        100. The order here is the order boards appear on the dashboard.
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {boardOrder(template).map((p) => {
          const total = p.components.reduce((s, c) => s + c.weight, 0);
          const balanced = total === 100;
          return (
            <li key={p.id} className="bb-card rounded-lg border border-border bg-card p-3">
              <button
                type="button"
                onClick={() => setOpen(open === p.id ? null : p.id)}
                className="flex min-h-tap w-full items-center gap-3 text-left"
              >
                <span className="tnum w-10 shrink-0 text-base font-bold text-primary">
                  {p.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {p.label}
                </span>
                <span
                  className={
                    "tnum shrink-0 text-xs font-bold " +
                    (balanced ? "text-muted-foreground" : "text-destructive")
                  }
                >
                  {p.components.length} · {total}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {open === p.id ? "▾" : "▸"}
                </span>
              </button>

              {open === p.id && (
                <>
                  <WeightsEditor template={template} position={p} />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !confirmDelete(
                          `Delete the ${p.code} position? Athletes listed at ${p.code} keep the code but stop appearing on its board. Ratings are not deleted.`,
                        )
                      )
                        return;
                      run(() => deletePosition(template.id, p.id), () => setOpen(null));
                    }}
                    className="min-h-tap mt-3 text-xs font-semibold text-destructive disabled:opacity-50"
                  >
                    Delete {p.code}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="mt-2 bb-card rounded-lg border border-border bg-card p-3">
          <label htmlFor="new-pos-code" className="text-xs text-muted-foreground">
            Code (1-4 characters, e.g. WR)
          </label>
          <input
            id="new-pos-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            disabled={pending}
            className={FIELD + " mt-1 tnum uppercase"}
          />
          <label htmlFor="new-pos-label" className="mt-2 block text-xs text-muted-foreground">
            Full name
          </label>
          <input
            id="new-pos-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
            className={FIELD + " mt-1"}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending || !code.trim() || !label.trim()}
              onClick={() =>
                run(() => addPosition(template.id, code, label), () => {
                  setAdding(false);
                  setCode("");
                  setLabel("");
                })
              }
              className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {pending ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAdding(false)}
              className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A new position starts with no inputs. Open it and add weights
            totalling 100 before anyone can be rated there.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-tap mt-2 w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground active:bg-secondary"
        >
          + Add position
        </button>
      )}
    </section>
  );
}

// --------------------------------------------------------------- attributes

function AttributesSection({
  template,
  onError,
}: {
  template: Template;
  onError: (e: string | null) => void;
}) {
  const { pending, run } = useAction(onError);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [short, setShort] = useState("");

  async function removeAttribute(id: string, k: string, name: string) {
    const blockers = weightedBy(template, "attribute", k);
    if (blockers.length > 0) {
      onError(
        `${name} is still weighted by ${blockers.join(", ")}. Remove it from ` +
          `${blockers.length === 1 ? "that position" : "those positions"} first, ` +
          `rebalancing each back to 100.`,
      );
      return;
    }

    const usage = await componentUsage(template.id, k);
    const warning =
      usage.ratings > 0
        ? `Delete ${name}? This also deletes ${usage.ratings} rating${usage.ratings === 1 ? "" : "s"} already recorded against it, from every officer. This cannot be undone.`
        : `Delete ${name}? Nothing has been rated on it yet.`;
    if (!confirmDelete(warning)) return;
    run(() => deleteAttribute(template.id, id));
  }

  return (
    <section>
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Judged Attributes
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Rated 0-10 on a slider. An attribute only appears on a profile if some
        position the athlete plays gives it a weight.
      </p>

      <ul className="mt-2 divide-y divide-border overflow-hidden bb-card rounded-lg border border-border bg-card">
        {template.attributes.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2">
            <span className="tnum w-10 shrink-0 text-xs font-bold text-primary">
              {a.short}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {a.label}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {weightedBy(template, "attribute", a.key).join(", ") || "unweighted"}
              </span>
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => removeAttribute(a.id, a.key, a.label)}
              className="min-h-tap shrink-0 text-xs font-semibold text-destructive disabled:opacity-50"
            >
              Delete
            </button>
          </li>
        ))}
        {template.attributes.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            No attributes yet.
          </li>
        )}
      </ul>

      {adding ? (
        <div className="mt-2 bb-card rounded-lg border border-border bg-card p-3">
          <label htmlFor="attr-label" className="text-xs text-muted-foreground">
            Name
          </label>
          <input
            id="attr-label"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              // The key is derived, because it is what ratings rows join on
              // and a hand-typed one is a chance to get it wrong.
              if (!key || key === slug(label)) setKey(slug(e.target.value));
            }}
            disabled={pending}
            className={FIELD + " mt-1"}
          />

          <label htmlFor="attr-short" className="mt-2 block text-xs text-muted-foreground">
            Short code (1-4 characters)
          </label>
          <input
            id="attr-short"
            value={short}
            onChange={(e) => setShort(e.target.value.toUpperCase())}
            maxLength={4}
            disabled={pending}
            className={FIELD + " mt-1 tnum uppercase"}
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Key: <code className="text-foreground">{key || "..."}</code>
          </p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending || !label.trim() || !short.trim()}
              onClick={() =>
                run(() => addAttribute(template.id, key, label, short), () => {
                  setAdding(false);
                  setKey("");
                  setLabel("");
                  setShort("");
                })
              }
              className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {pending ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAdding(false)}
              className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-tap mt-2 w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground active:bg-secondary"
        >
          + Add attribute
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- drills

function DrillsSection({
  template,
  onError,
}: {
  template: Template;
  onError: (e: string | null) => void;
}) {
  const { pending, run } = useAction(onError);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    label: "",
    key: "",
    unit: "s",
    direction: "lower_is_better",
    maxAttempts: 2,
    minTimedForPercentile: 15,
    valueMin: 0,
    valueMax: 20,
    decimals: 2,
  });

  async function removeDrill(id: string, k: string, name: string) {
    const blockers = weightedBy(template, "drill", k);
    if (blockers.length > 0) {
      onError(
        `${name} is still weighted by ${blockers.join(", ")}. Remove it from ` +
          `${blockers.length === 1 ? "that position" : "those positions"} first, ` +
          `rebalancing each back to 100.`,
      );
      return;
    }

    const usage = await componentUsage(template.id, k);
    const warning =
      usage.results > 0
        ? `Delete ${name}? This also deletes ${usage.results} recorded result${usage.results === 1 ? "" : "s"}. This cannot be undone.`
        : `Delete ${name}? Nothing has been recorded for it yet.`;
    if (!confirmDelete(warning)) return;
    run(() => deleteDrill(template.id, id));
  }

  return (
    <section>
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Measured Drills
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Timed or measured, never rated on a slider. Each is scored as a
        percentile within the tryout class, so direction matters: a 40 time is
        better lower, an exit velocity better higher.
      </p>

      <ul className="mt-2 divide-y divide-border overflow-hidden bb-card rounded-lg border border-border bg-card">
        {template.drills.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{d.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {weightedBy(template, "drill", d.key).join(", ") || "unweighted"} ·{" "}
                {d.unit} ·{" "}
                {d.direction === "lower_is_better" ? "lower is better" : "higher is better"}{" "}
                · percentile at {d.minTimedForPercentile}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => removeDrill(d.id, d.key, d.label)}
              className="min-h-tap shrink-0 text-xs font-semibold text-destructive disabled:opacity-50"
            >
              Delete
            </button>
          </li>
        ))}
        {template.drills.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted-foreground">No drills yet.</li>
        )}
      </ul>

      {adding ? (
        <div className="mt-2 bb-card rounded-lg border border-border bg-card p-3">
          <label htmlFor="drill-label" className="text-xs text-muted-foreground">
            Name
          </label>
          <input
            id="drill-label"
            value={form.label}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                label: e.target.value,
                key: !f.key || f.key === slug(f.label) ? slug(e.target.value) : f.key,
              }))
            }
            disabled={pending}
            className={FIELD + " mt-1"}
          />

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="drill-unit" className="text-xs text-muted-foreground">
                Unit
              </label>
              <input
                id="drill-unit"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                disabled={pending}
                className={FIELD + " mt-1"}
              />
            </div>
            <div>
              <label htmlFor="drill-dir" className="text-xs text-muted-foreground">
                Better is
              </label>
              <select
                id="drill-dir"
                value={form.direction}
                onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                disabled={pending}
                className={FIELD + " mt-1"}
              >
                <option value="lower_is_better">Lower</option>
                <option value="higher_is_better">Higher</option>
              </select>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <NumField
              id="drill-min"
              label="Min"
              value={form.valueMin}
              onChange={(v) => setForm((f) => ({ ...f, valueMin: v }))}
              disabled={pending}
            />
            <NumField
              id="drill-max"
              label="Max"
              value={form.valueMax}
              onChange={(v) => setForm((f) => ({ ...f, valueMax: v }))}
              disabled={pending}
            />
            <NumField
              id="drill-dec"
              label="Decimals"
              value={form.decimals}
              onChange={(v) => setForm((f) => ({ ...f, decimals: v }))}
              disabled={pending}
            />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumField
              id="drill-att"
              label="Attempts"
              value={form.maxAttempts}
              onChange={(v) => setForm((f) => ({ ...f, maxAttempts: v }))}
              disabled={pending}
            />
            <NumField
              id="drill-pct"
              label="Percentile at"
              value={form.minTimedForPercentile}
              onChange={(v) => setForm((f) => ({ ...f, minTimedForPercentile: v }))}
              disabled={pending}
            />
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Key: <code className="text-foreground">{form.key || "..."}</code>.
            Percentiles stay hidden until that many athletes are measured, and
            the drill counts as missing until then.
          </p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending || !form.label.trim()}
              onClick={() =>
                run(() => addDrill(template.id, form), () => {
                  setAdding(false);
                  setForm((f) => ({ ...f, label: "", key: "" }));
                })
              }
              className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {pending ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAdding(false)}
              className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-tap mt-2 w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground active:bg-secondary"
        >
          + Add drill
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ gating

function GatingSection({
  template,
  onError,
}: {
  template: Template;
  onError: (e: string | null) => void;
}) {
  const { pending, run } = useAction(onError);
  const [value, setValue] = useState(template.minRatingsForDisplay);

  return (
    <section className="bb-card rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Rating Gate
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        How many officer inputs a position needs before it shows a number.
        Below this, the board shows progress instead — a barely-rated 91 above
        a fully-vetted 84 cuts the wrong athlete.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={50}
          value={value}
          disabled={pending}
          aria-label="Minimum officer inputs"
          onChange={(e) => setValue(parseInt(e.target.value, 10))}
          className="tnum min-h-tap w-24 rounded-md border border-border bg-input px-3
                     text-center text-base font-bold text-foreground outline-none
                     focus-visible:border-primary disabled:opacity-50"
        />
        <button
          type="button"
          disabled={pending || value === template.minRatingsForDisplay || !Number.isFinite(value)}
          onClick={() => run(() => setMinRatings(template.id, value))}
          className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ helpers

function NumField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={FIELD + " mt-1 tnum text-center"}
      />
    </div>
  );
}

/**
 * Which positions currently weight this component.
 *
 * A component cannot be deleted while any position weights it: the delete
 * would cascade its weight rows and leave those positions off 100, which the
 * database refuses. Naming the positions turns that from a rejection into an
 * instruction.
 */
function weightedBy(template: Template, kind: "attribute" | "drill", key: string) {
  return template.positions
    .filter((p) => p.components.some((c) => c.kind === kind && c.key === key))
    .map((p) => p.code);
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Deleting a component takes real evaluation data with it, so it asks first.
 * window.confirm is a browser modal, which the browser-automation guidance
 * warns about, but this is a destructive action a person is performing by
 * hand — the interruption is the feature.
 */
function confirmDelete(message: string): boolean {
  return window.confirm(message);
}
