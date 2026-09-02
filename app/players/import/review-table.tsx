"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/template";
import { commitImport, type ReviewRow, type RowIssue } from "./actions";

/**
 * The one review table every import source lands in — SPEC-V2 section 10b.5.
 *
 * CSV, photo and pasted text all end up here, and NOTHING reaches the
 * database until Import is pressed. That is the whole safety model for
 * AI-sourced rows: the model reads, this table lets a person decide.
 *
 * Every cell is editable, including ones that parsed cleanly — a value the
 * AI was confident about can still be wrong, and a table that only let you
 * fix the flagged ones would imply otherwise.
 */
export function ReviewTable({
  template,
  initialRows,
  takenJerseys,
  notes,
  onCancel,
}: {
  template: Template;
  initialRows: ReviewRow[];
  /** Jersey numbers already in the active tryout. */
  takenJerseys: number[];
  /** What the AI said it found hard. Empty for the CSV path. */
  notes?: string[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReviewRow[]>(initialRows);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const taken = useMemo(() => new Set(takenJerseys), [takenJerseys]);
  const codes = useMemo(
    () =>
      [...template.positions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => p.code),
    [template],
  );

  function update(i: number, patch: Partial<ReviewRow>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  const collisions = rows.filter(
    (r) => r.mode !== "skip" && isCollision(r, taken),
  ).length;
  const importing = rows.filter((r) => r.mode !== "skip").length;

  function submit() {
    setIssues([]);
    startTransition(async () => {
      const res = await commitImport(rows);
      if (!res.ok) {
        setIssues(res.issues);
        return;
      }
      setDone(
        [
          res.inserted > 0 && `${res.inserted} added`,
          res.overwritten > 0 && `${res.overwritten} updated`,
          res.skipped > 0 && `${res.skipped} skipped`,
          res.results > 0 && `${res.results} drill results`,
          res.selections > 0 && `${res.selections} put on the team list`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="bb-card rounded-lg border border-success/40 bg-success/10 p-4">
        <p className="text-sm font-bold text-foreground">Roster imported</p>
        <p className="mt-1 text-sm text-muted-foreground">{done}</p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap mt-3 w-full rounded-md bg-primary text-sm font-bold text-primary-foreground"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-foreground">
          Review {rows.length} {rows.length === 1 ? "athlete" : "athletes"}
        </p>
        <p className="text-xs text-muted-foreground">Nothing saved yet</p>
      </div>

      {notes && notes.length > 0 && (
        <div className="mt-2 rounded-md border border-chip-violet/40 bg-chip-violet/10 p-2">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            What the AI flagged
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {collisions > 0 && (
        <p className="mt-2 rounded-md border border-chip-amber/40 bg-chip-amber/10 px-3 py-2 text-xs text-foreground">
          <span className="tnum font-bold">{collisions}</span>{" "}
          {collisions === 1 ? "jersey is" : "jerseys are"} already used in this
          class. Choose skip or overwrite on each, or change the number.
        </p>
      )}

      {issues.length > 0 && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-bold text-foreground">
            Nothing was imported. Fix these first:
          </p>
          <ul className="mt-1 space-y-1">
            {issues.slice(0, 25).map((e, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                {e.row > 0 && (
                  <span className="tnum font-semibold text-foreground">
                    Row {e.row}:{" "}
                  </span>
                )}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row, i) => (
          <RowCard
            key={i}
            row={row}
            index={i}
            codes={codes}
            template={template}
            collides={isCollision(row, taken)}
            disabled={pending}
            onChange={(patch) => update(i, patch)}
          />
        ))}
      </ul>

      <div className="bb-card-raised sticky bottom-4 z-20 mt-3 flex items-center gap-3 rounded-lg border border-primary/50 bg-card p-3">
        <p className="min-w-0 flex-1 text-sm text-foreground">
          <span className="tnum font-bold">{importing}</span> of {rows.length}{" "}
          will be imported
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="min-h-tap shrink-0 rounded-md border border-border px-3 text-xs
                     font-semibold text-muted-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || importing === 0}
          className="min-h-tap shrink-0 rounded-md bg-primary px-4 text-sm font-bold
                     text-primary-foreground disabled:opacity-40"
        >
          {pending ? "Importing..." : `Import ${importing}`}
        </button>
      </div>
    </div>
  );
}

function isCollision(row: ReviewRow, taken: Set<number>): boolean {
  const n = Number(row.jerseyNumber.trim());
  return Number.isInteger(n) && taken.has(n);
}

const FIELD =
  "min-h-tap w-full rounded-md border border-border bg-input px-2 text-sm " +
  "text-foreground outline-none focus-visible:border-primary disabled:opacity-50";

/** A field the AI was unsure about, highlighted so it gets looked at. */
const FLAGGED = " border-chip-amber bg-chip-amber/10";

function RowCard({
  row,
  index,
  codes,
  template,
  collides,
  disabled,
  onChange,
}: {
  row: ReviewRow;
  index: number;
  codes: string[];
  template: Template;
  collides: boolean;
  disabled: boolean;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const uncertain = new Set(row.uncertain ?? []);
  const skipped = row.mode === "skip";

  function toggleCode(code: string) {
    const has = row.positions.includes(code);
    onChange({
      positions: has
        ? row.positions.filter((c) => c !== code)
        : [...row.positions, code],
    });
  }

  return (
    <li
      className={
        "bb-card rounded-lg border bg-card p-3 " +
        (skipped
          ? "border-border opacity-45"
          : collides
            ? "border-chip-amber/60"
            : "border-border")
      }
    >
      <div className="flex items-center gap-2">
        <span className="tnum w-6 shrink-0 text-xs text-muted-foreground">
          {index + 1}
        </span>
        <input
          value={row.firstName}
          onChange={(e) => onChange({ firstName: e.target.value })}
          disabled={disabled || skipped}
          placeholder="First"
          aria-label={`Row ${index + 1} first name`}
          className={FIELD + (uncertain.has("first_name") ? FLAGGED : "")}
        />
        <input
          value={row.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
          disabled={disabled || skipped}
          placeholder="Last"
          aria-label={`Row ${index + 1} last name`}
          className={FIELD + (uncertain.has("last_name") ? FLAGGED : "")}
        />
        <input
          value={row.jerseyNumber}
          onChange={(e) => onChange({ jerseyNumber: e.target.value })}
          disabled={disabled || skipped}
          inputMode="numeric"
          placeholder="#"
          aria-label={`Row ${index + 1} jersey number`}
          className={
            "tnum w-16 shrink-0 text-center " +
            FIELD +
            (uncertain.has("jersey_number") ? FLAGGED : "")
          }
        />
      </div>

      {/* Positions as chips: the first one selected is the primary, which the
          caption states rather than leaving to be discovered. */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {codes.map((code) => {
          const on = row.positions.includes(code);
          const primary = row.positions[0] === code;
          return (
            <button
              key={code}
              type="button"
              disabled={disabled || skipped}
              onClick={() => toggleCode(code)}
              className={
                "min-h-tap rounded-full px-2.5 text-xs font-bold uppercase disabled:opacity-50 " +
                (primary
                  ? "bg-primary text-primary-foreground"
                  : on
                    ? "bg-primary/25 text-foreground"
                    : "border border-border text-muted-foreground")
              }
            >
              {code}
            </button>
          );
        })}
      </div>
      {row.positions.length > 0 && !skipped && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Primary: <span className="font-bold text-foreground">{row.positions[0]}</span>
          {row.positions.length > 1 && ` · also ${row.positions.slice(1).join(", ")}`}
        </p>
      )}
      {uncertain.has("positions") && !skipped && (
        <p className="mt-1 text-[11px] text-chip-amber">
          The AI was not sure about the position here — check it.
        </p>
      )}

      {/* Drill values, only for templates that define drills. */}
      {template.drills.length > 0 && !skipped && (
        <div className="mt-2 flex flex-col gap-1">
          {template.drills.map((drill) => (
            <div key={drill.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {drill.label} ({drill.unit})
              </span>
              {Array.from({ length: drill.maxAttempts }, (_, n) => (
                <input
                  key={n}
                  value={row.drills[drill.key]?.[n] ?? ""}
                  onChange={(e) => {
                    const current = row.drills[drill.key] ?? [];
                    const next = [...current];
                    next[n] = e.target.value;
                    onChange({ drills: { ...row.drills, [drill.key]: next } });
                  }}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder="--"
                  aria-label={`Row ${index + 1} ${drill.label} attempt ${n + 1}`}
                  className={"tnum w-16 shrink-0 text-center " + FIELD}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex min-h-tap items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={row.selected}
            onChange={(e) => onChange({ selected: e.target.checked })}
            disabled={disabled || skipped}
            className="h-5 w-5"
          />
          On team list
        </label>

        {/* The collision choice. A whole file is never failed over one
            duplicate jersey — that is right for a spreadsheet you can go fix
            and wrong for a photo where three names overlap last season. */}
        {collides ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-semibold text-chip-amber">
              #{row.jerseyNumber} exists:
            </span>
            <ModeButton
              active={row.mode === "overwrite"}
              disabled={disabled}
              onClick={() => onChange({ mode: "overwrite" })}
            >
              Overwrite
            </ModeButton>
            <ModeButton
              active={row.mode === "skip"}
              disabled={disabled}
              onClick={() => onChange({ mode: "skip" })}
            >
              Skip
            </ModeButton>
          </div>
        ) : (
          <ModeButton
            active={row.mode === "skip"}
            disabled={disabled}
            onClick={() =>
              onChange({ mode: row.mode === "skip" ? "insert" : "skip" })
            }
          >
            {row.mode === "skip" ? "Skipped — include" : "Skip"}
          </ModeButton>
        )}
      </div>
    </li>
  );
}

function ModeButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "min-h-tap rounded-md px-2.5 text-[11px] font-semibold disabled:opacity-50 " +
        (active
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground active:bg-secondary")
      }
    >
      {children}
    </button>
  );
}
