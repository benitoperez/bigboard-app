"use client";

import { useEffect, useState } from "react";
import type { Template } from "@/lib/template";
import { ImportFlow } from "./import-flow";

/**
 * The import flow in a sheet, opened from either entry point — SPEC-V2
 * section 10b.2.
 *
 * A centred overlay rather than an inline panel: the review table can run to
 * dozens of rows, and unfolding that inside the Account tab or the Add
 * Athlete sheet would bury whatever the person was already doing.
 */
export function ImportSheet({
  template,
  orgId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  template: Template;
  orgId: string;
  /** Omitted when the parent supplies its own button. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;

  const setOpen = (next: boolean) => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger !== undefined && (
        <button type="button" onClick={() => setOpen(true)} className="contents">
          {trigger}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Import a roster"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-background/85"
          />

          <div className="bb-card-raised relative my-8 w-full max-w-md rounded-lg border border-border bg-popover p-4">
            <h2 className="text-xl text-foreground uppercase">Import roster</h2>
            <div className="mt-3">
              <ImportFlow
                template={template}
                orgId={orgId}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
