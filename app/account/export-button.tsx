"use client";

import { useState, useTransition } from "react";
import { exportRoster } from "./export-actions";

/**
 * Download the roster as CSV — SPEC-V2.md section 10c.
 *
 * The file is built on the server and saved from a Blob here. A plain link
 * to a route would be simpler, but the server action keeps the admin check
 * in the same shape as every other privileged call in the app, and the
 * object URL is revoked immediately so the blob does not sit in memory for
 * the life of the page.
 */
export function ExportButton({
  scope,
  label,
  hint,
}: {
  scope: "all" | "selected";
  label: string;
  hint?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await exportRoster(scope);
      if (!res.ok) {
        setError(res.error);
        return;
      }

      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDone(`${res.rows} ${res.rows === 1 ? "athlete" : "athletes"} exported.`);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="min-h-tap w-full rounded-md border border-border bg-card px-4 text-sm
                   font-semibold text-foreground active:bg-secondary disabled:opacity-50"
      >
        {pending ? "Building..." : label}
      </button>

      {hint && !error && !done && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
      {done && <p className="mt-1 text-xs text-success">{done}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
