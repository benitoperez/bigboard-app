"use client";

import { useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import {
  REQUIRED_COLUMNS,
  optionalColumns,
  validateRoster,
  type RowError,
} from "@/lib/csv/roster";
import type { Template } from "@/lib/template";
import { CsvCleanup, type CleanedSheet } from "./csv-cleanup";
import { importRoster, type ImportResult } from "./actions";

type Phase =
  | { kind: "idle" }
  | { kind: "parsing" }
  | {
      kind: "errors";
      errors: RowError[];
      fileName: string;
      /** Kept so AI cleanup can be offered on a file that failed validation. */
      csvText?: string;
      records?: Record<string, unknown>[];
      headers?: string[];
    }
  | {
      kind: "ready";
      records: Record<string, unknown>[];
      headers: string[];
      count: number;
      skippedBlank: number;
      fileName: string;
      csvText: string;
      /** The parse as it came off disk, for the cleanup diff. */
      originalRecords: Record<string, unknown>[];
      originalHeaders: string[];
    }
  | {
      kind: "done";
      inserted: number;
      importedResults: number;
      importedSelections: number;
      skippedBlank: number;
    };

export function CsvImport({
  takenJerseys,
  template,
  orgId,
}: {
  takenJerseys: number[];
  orgId: string;
  /**
   * The tryout's template. Validation runs here in the browser for instant
   * feedback and AGAIN on the server, which re-reads the template rather
   * than trusting this copy.
   */
  template: Template;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase({ kind: "idle" });
    if (fileInput.current) fileInput.current.value = "";
  }

  /**
   * Validate a parsed sheet and move to the matching phase.
   *
   * Shared by the initial file read and by accepting an AI proposal, so an
   * AI-cleaned sheet goes through exactly the same validation an untouched
   * one does. That equivalence is the point: the AI is a pre-processor, not
   * an authority.
   */
  function validateAndSet(
    records: Record<string, unknown>[],
    headers: string[],
    fileName: string,
    csvText: string,
    original: { records: Record<string, unknown>[]; headers: string[] },
  ) {
    const result = validateRoster(records, headers, new Set(takenJerseys), template);

    if (!result.ok) {
      setPhase({
        kind: "errors",
        errors: result.errors,
        fileName,
        csvText,
        records: original.records,
        headers: original.headers,
      });
      return;
    }

    setPhase({
      kind: "ready",
      records,
      headers,
      count: result.rows.length,
      skippedBlank: result.skippedBlank,
      fileName,
      csvText,
      originalRecords: original.records,
      originalHeaders: original.headers,
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase({ kind: "parsing" });

    // The raw text is kept alongside the parse: AI cleanup works on the
    // sheet as written, including the header row papaparse consumed.
    file
      .text()
      .then((csvText) => {
        Papa.parse<Record<string, unknown>>(csvText, {
          header: true,
          skipEmptyLines: false, // blank rows are counted, not silently dropped
          complete: (parsed) => {
            const headers = parsed.meta.fields ?? [];
            validateAndSet(parsed.data, headers, file.name, csvText, {
              records: parsed.data,
              headers,
            });
          },
          error: (err: Error) =>
            setPhase({
              kind: "errors",
              errors: [{ line: 0, message: `Could not read the file: ${err.message}` }],
              fileName: file.name,
            }),
        });
      })
      .catch(() =>
        setPhase({
          kind: "errors",
          errors: [{ line: 0, message: "Could not read that file." }],
          fileName: file.name,
        }),
      );
  }

  function confirmImport() {
    if (phase.kind !== "ready") return;
    const { records, headers } = phase;
    startTransition(async () => {
      const res: ImportResult = await importRoster(records, headers);
      if (res.ok) {
        setPhase({
          kind: "done",
          inserted: res.inserted,
          importedResults: res.importedResults,
          importedSelections: res.importedSelections,
          skippedBlank: res.skippedBlank,
        });
        if (fileInput.current) fileInput.current.value = "";
      } else {
        setPhase({ kind: "errors", errors: res.errors, fileName: "" });
      }
    });
  }

  function acceptCleanup(sheet: CleanedSheet) {
    if (phase.kind !== "ready" && phase.kind !== "errors") return;
    const fileName = phase.fileName;
    const csvText = phase.kind === "ready" ? phase.csvText : (phase.csvText ?? "");
    const original =
      phase.kind === "ready"
        ? { records: phase.originalRecords, headers: phase.originalHeaders }
        : { records: phase.records ?? [], headers: phase.headers ?? [] };

    validateAndSet(sheet.rows, sheet.headers, fileName, csvText, original);
  }

  return (
    <section className="bb-card rounded-lg border border-border bg-card p-4">
      <h2 className="text-xl uppercase">Import Roster</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Required:{" "}
        <code className="text-foreground">{REQUIRED_COLUMNS.join(", ")}</code>.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional:{" "}
        <code className="text-foreground">{optionalColumns(template).join(", ")}</code>.
      </p>
      {/* The drill columns change with the sport, so the header this
          template actually expects is shown rather than described. */}
      <div className="mt-3 overflow-x-auto rounded-md border border-border bg-input p-2">
        <code className="tnum block whitespace-pre text-xs text-muted-foreground">
          {exampleCsv(template)}
        </code>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        <code className="text-foreground">positions</code> is the multi-select
        cell, quoted and comma separated &mdash;{" "}
        <code className="text-foreground">&quot;WR, DB&quot;</code>. The first
        value is their primary position. Labels like{" "}
        <code className="text-foreground">R (Rush)</code> are fine.{" "}
        <code className="text-foreground">selected</code> accepts TRUE / 1 and
        puts them straight on the team list. Drill columns are optional and a
        blank cell means not measured. The whole file is checked before
        anything is saved.
      </p>

      <label
        className="mt-4 flex min-h-tap-large cursor-pointer items-center justify-center
                   rounded-md border border-dashed border-border-strong px-4
                   text-sm font-semibold text-foreground active:bg-secondary"
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="sr-only"
        />
        {phase.kind === "parsing" ? "Reading..." : "Choose CSV file"}
      </label>

      {phase.kind === "errors" && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-bold text-foreground">
            Nothing was imported. Fix these and try again:
          </p>
          <ul className="mt-2 space-y-1">
            {phase.errors.slice(0, 25).map((e, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                {e.line > 0 && (
                  <span className="tnum font-semibold text-foreground">
                    Line {e.line}:{" "}
                  </span>
                )}
                {e.message}
              </li>
            ))}
            {phase.errors.length > 25 && (
              <li className="text-sm text-muted-foreground">
                ...and {phase.errors.length - 25} more.
              </li>
            )}
          </ul>
          {/* A file that failed validation is the case AI cleanup exists
              for, so it is offered right here rather than only up front. */}
          {phase.csvText && (
            <CsvCleanup
              csvText={phase.csvText}
              originalHeaders={phase.headers ?? []}
              originalRows={phase.records ?? []}
              orgId={orgId}
              onAccept={acceptCleanup}
              disabled={pending}
            />
          )}

          <button
            type="button"
            onClick={reset}
            className="min-h-tap mt-3 w-full rounded-md border border-border text-sm font-semibold"
          >
            Start Over
          </button>
        </div>
      )}

      {phase.kind === "ready" && (
        <div className="mt-4 rounded-md border border-border bg-secondary p-3">
          <p className="text-sm text-foreground">
            <span className="tnum font-bold">{phase.count}</span> prospects
            ready to import from{" "}
            <span className="font-semibold">{phase.fileName}</span>.
            {phase.skippedBlank > 0 && (
              <span className="text-muted-foreground">
                {" "}
                {phase.skippedBlank} blank row
                {phase.skippedBlank === 1 ? "" : "s"} ignored.
              </span>
            )}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={pending}
              className="min-h-tap flex-1 rounded-md bg-primary px-4 text-sm font-bold
                         text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Importing..." : `Import ${phase.count}`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>

          <CsvCleanup
            csvText={phase.csvText}
            originalHeaders={phase.originalHeaders}
            originalRows={phase.originalRecords}
            orgId={orgId}
            onAccept={acceptCleanup}
            disabled={pending}
          />
        </div>
      )}

      {phase.kind === "done" && (
        <div className="mt-4 rounded-md border border-success/40 bg-success/10 p-3">
          <p className="text-sm font-semibold text-foreground">
            Imported <span className="tnum">{phase.inserted}</span> prospects
            {phase.importedResults > 0 && (
              <>
                , <span className="tnum">{phase.importedResults}</span> drill
                result{phase.importedResults === 1 ? "" : "s"}
              </>
            )}
            {phase.importedSelections > 0 && (
              <>
                , and <span className="tnum">{phase.importedSelections}</span>{" "}
                onto the team list
              </>
            )}
            .
          </p>
          <button
            type="button"
            onClick={reset}
            className="min-h-tap mt-3 w-full rounded-md border border-border text-sm font-semibold"
          >
            Import Another
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A two-line sample in this template's own shape.
 *
 * Column names are derived, not written out: a baseball template asks for
 * exit_velocity_1 where flag football asks for forty_1, and an admin
 * building a sheet needs to see the one that applies to them.
 */
function exampleCsv(template: Template): string {
  const positions = template.positions
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const primary = positions[0]?.code ?? "POS";
  const secondary = positions[1]?.code;

  // Column names only. Inventing sample measurements would mean inventing
  // what a good one looks like for a sport this code knows nothing about -
  // the midpoint of an allowed range is not a realistic value, and a wrong
  // example is worse than none. The cells are optional anyway: blank means
  // not measured.
  const drillCols: string[] = [];
  for (const d of template.drills) {
    for (let n = 1; n <= d.maxAttempts; n++) drillCols.push(`${d.key}_${n}`);
  }
  const drillVals = drillCols.map(() => "");

  const header = ["first_name", "last_name", "jersey_number", "positions", ...drillCols, "selected"];
  const row = [
    "Jordan",
    "Hayes",
    "23",
    secondary ? `"${primary}, ${secondary}"` : `"${primary}"`,
    ...drillVals,
    "TRUE",
  ];

  return `${header.join(",")}
${row.join(",")}`;
}
