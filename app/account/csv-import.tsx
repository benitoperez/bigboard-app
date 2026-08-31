"use client";

import { useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import { REQUIRED_COLUMNS, validateRoster, type RowError } from "@/lib/csv/roster";
import { importRoster, type ImportResult } from "./actions";

type Phase =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "errors"; errors: RowError[]; fileName: string }
  | { kind: "ready"; records: Record<string, unknown>[]; headers: string[]; count: number; skippedBlank: number; fileName: string }
  | { kind: "done"; inserted: number; importedTimes: number; skippedBlank: number };

export function CsvImport({ takenJerseys }: { takenJerseys: number[] }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase({ kind: "idle" });
    if (fileInput.current) fileInput.current.value = "";
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase({ kind: "parsing" });

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: false, // blank rows are counted, not silently dropped
      complete: (parsed) => {
        const headers = parsed.meta.fields ?? [];
        const result = validateRoster(
          parsed.data,
          headers,
          new Set(takenJerseys),
        );
        if (!result.ok) {
          setPhase({ kind: "errors", errors: result.errors, fileName: file.name });
          return;
        }
        setPhase({
          kind: "ready",
          records: parsed.data,
          headers,
          count: result.rows.length,
          skippedBlank: result.skippedBlank,
          fileName: file.name,
        });
      },
      error: (err) =>
        setPhase({
          kind: "errors",
          errors: [{ line: 0, message: `Could not read the file: ${err.message}` }],
          fileName: file.name,
        }),
    });
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
          importedTimes: res.importedTimes,
          skippedBlank: res.skippedBlank,
        });
        if (fileInput.current) fileInput.current.value = "";
      } else {
        setPhase({ kind: "errors", errors: res.errors, fileName: "" });
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-xl uppercase">Import Roster</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Required columns:{" "}
        <code className="text-foreground">{REQUIRED_COLUMNS.join(", ")}</code>.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional: <code className="text-foreground">forty_1</code> and{" "}
        <code className="text-foreground">forty_2</code> for the two 40 times
        (<code className="text-foreground">40_1</code> /{" "}
        <code className="text-foreground">40_2</code> also work). Blank cells
        just mean not timed. The whole file is checked before anything is
        saved.
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
        </div>
      )}

      {phase.kind === "done" && (
        <div className="mt-4 rounded-md border border-success/40 bg-success/10 p-3">
          <p className="text-sm font-semibold text-foreground">
            Imported <span className="tnum">{phase.inserted}</span> prospects
            {phase.importedTimes > 0 && (
              <>
                {" "}
                and <span className="tnum">{phase.importedTimes}</span> 40
                time{phase.importedTimes === 1 ? "" : "s"}
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
