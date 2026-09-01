"use client";

import { useState } from "react";

/**
 * AI CSV cleanup with a diff preview — SPEC-V2.md section 6.3.
 *
 * The AI never imports anything. It proposes a normalized version of the
 * sheet, this shows exactly which cells changed, and accepting simply feeds
 * the result into the ordinary validator — the same one an untouched file
 * goes through. A hallucinated position fails validation like any typo.
 *
 * Every changed cell is listed. A summary count would hide the one wrong
 * change among fifty right ones, which is the failure worth designing
 * against here.
 */

export type CleanedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  notes: string[];
};

type CellChange = {
  line: number;
  column: string;
  before: string;
  after: string;
};

export function CsvCleanup({
  csvText,
  originalHeaders,
  originalRows,
  orgId,
  onAccept,
  disabled,
}: {
  csvText: string;
  originalHeaders: string[];
  originalRows: Record<string, unknown>[];
  orgId: string;
  onAccept: (sheet: CleanedSheet) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CleanedSheet | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/csv-cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: csvText, orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "That did not work.");
        return;
      }
      setProposal(data as CleanedSheet);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  if (!proposal) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={run}
          disabled={pending || disabled}
          className="min-h-tap w-full rounded-md border border-chip-violet/40 bg-chip-violet/10
                     px-4 text-sm font-semibold text-foreground active:opacity-80 disabled:opacity-50"
        >
          {pending ? "Cleaning up..." : "Clean up with AI"}
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Fixes header names, position spellings and stray
          formatting, then shows you every change before anything is
          imported.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  const headerChanges = diffHeaders(originalHeaders, proposal.headers);
  const cellChanges = diffCells(originalHeaders, originalRows, proposal);
  const rowDelta = proposal.rows.length - originalRows.length;

  return (
    <div className="mt-3 rounded-lg border border-chip-violet/40 bg-chip-violet/10 p-3">
      <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        AI proposal &middot; nothing imported yet
      </p>

      {proposal.notes.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          {proposal.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Headers" value={headerChanges.length} />
        <Stat label="Cells" value={cellChanges.length} />
        <Stat
          label="Rows"
          value={rowDelta === 0 ? "same" : rowDelta > 0 ? `+${rowDelta}` : String(rowDelta)}
        />
      </dl>

      {headerChanges.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-foreground">Header changes</p>
          <ul className="mt-1 space-y-1">
            {headerChanges.map((h, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                <Was>{h.before}</Was> &rarr; <Now>{h.after}</Now>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cellChanges.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-foreground">
            Cell changes ({cellChanges.length})
          </p>
          <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto">
            {cellChanges.map((c, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                <span className="tnum font-semibold text-foreground">
                  Line {c.line}
                </span>{" "}
                <span className="text-foreground">{c.column}</span>:{" "}
                <Was>{c.before || "(blank)"}</Was> &rarr;{" "}
                <Now>{c.after || "(blank)"}</Now>
              </li>
            ))}
          </ul>
        </div>
      )}

      {headerChanges.length === 0 && cellChanges.length === 0 && rowDelta === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing needed changing. Import the file as it is.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onAccept(proposal)}
          disabled={disabled}
          className="min-h-tap flex-1 rounded-md bg-primary px-4 text-sm font-bold
                     text-primary-foreground disabled:opacity-50"
        >
          Use these changes
        </button>
        <button
          type="button"
          onClick={() => setProposal(null)}
          disabled={disabled}
          className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold
                     text-muted-foreground disabled:opacity-50"
        >
          Discard
        </button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Accepting still runs the full validation. Anything the AI got wrong
        will be rejected with a row number, exactly like a typo.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="tnum text-base font-bold text-foreground">{value}</dd>
    </div>
  );
}

function Was({ children }: { children: React.ReactNode }) {
  return <span className="text-destructive line-through">{children}</span>;
}

function Now({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-primary">{children}</span>;
}

function diffHeaders(before: string[], after: string[]) {
  const changes: { before: string; after: string }[] = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i] ?? "(none)";
    const a = after[i] ?? "(removed)";
    if (b !== a) changes.push({ before: b, after: a });
  }
  return changes;
}

/**
 * Compare row by row, position by position.
 *
 * Rows are matched by index because the prompt forbids reordering or
 * dropping athletes — and if the model did either anyway, the row count
 * shown above changes and the cell diff turns noisy, which is exactly the
 * signal the admin needs to discard the proposal.
 */
function diffCells(
  originalHeaders: string[],
  originalRows: Record<string, unknown>[],
  proposal: CleanedSheet,
): CellChange[] {
  const changes: CellChange[] = [];

  proposal.rows.forEach((row, i) => {
    const original = originalRows[i];
    if (!original) return;

    proposal.headers.forEach((header, colIndex) => {
      const after = String(row[header] ?? "").trim();

      // Match the original cell by header name where the name survived, and
      // by column position where it was renamed.
      const originalKey = originalHeaders.includes(header)
        ? header
        : originalHeaders[colIndex];
      const before = String(original[originalKey] ?? "").trim();

      if (before !== after) {
        changes.push({ line: i + 2, column: header, before, after });
      }
    });
  });

  return changes;
}
