"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  prepareHeadshot,
  headshotPath,
  formatBytes,
  HEADSHOT_MAX_EDGE,
} from "@/lib/images";
import { setHeadshotPath, removeHeadshot } from "./headshot-actions";

/**
 * Headshot capture - SPEC.md section 13.
 *
 * capture="environment" opens the rear camera directly on a phone, which is
 * the only workable flow standing on a field. The file is resized in the
 * browser BEFORE upload, so a 4MB iPhone photo becomes tens of kilobytes and
 * field wifi is not asked to carry the original.
 *
 * Optional throughout: nothing blocks on a photo existing, and the default
 * jersey-number circle stands in wherever one is missing.
 */
export function HeadshotUpload({
  prospectId,
  tryoutId,
  hasHeadshot,
  currentPath,
}: {
  prospectId: string;
  tryoutId: string;
  hasHeadshot: boolean;
  currentPath: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setBusy(true);
    setStatus("Resizing...");

    try {
      const prepared = await prepareHeadshot(file, HEADSHOT_MAX_EDGE);

      setStatus(
        `Uploading ${formatBytes(prepared.blob.size)} (was ${formatBytes(prepared.originalBytes)})...`,
      );

      const path = headshotPath(tryoutId, prospectId);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("headshots")
        .upload(path, prepared.blob, {
          contentType: "image/jpeg",
          upsert: true, // replacing a headshot overwrites the same object
        });

      if (upErr) throw new Error(upErr.message);

      const res = await setHeadshotPath(prospectId, path);
      if (!res.ok) throw new Error(res.error);

      setStatus(
        `Saved. ${formatBytes(prepared.originalBytes)} to ${formatBytes(prepared.blob.size)}.`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onRemove() {
    if (!currentPath) return;
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await removeHeadshot(prospectId, currentPath);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStatus(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <label
          className={
            "flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-md " +
            "border border-dashed border-border-strong px-3 text-xs font-semibold " +
            (busy ? "opacity-50" : "text-foreground active:bg-secondary")
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            disabled={busy}
            className="sr-only"
          />
          {hasHeadshot ? "Replace photo" : "Add photo"}
        </label>

        {hasHeadshot && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="min-h-tap rounded-md border border-border px-3 text-xs font-semibold
                       text-muted-foreground disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {status && (
        <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
