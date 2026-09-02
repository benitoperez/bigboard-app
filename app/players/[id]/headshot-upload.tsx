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
 * NO `capture` attribute, deliberately. v1 set capture="environment" to open
 * the rear camera straight away, which is the fastest path standing on a
 * field - but it also SKIPS the photo library entirely, so a headshot taken
 * earlier in the day, or shot on someone else's phone and sent over, could
 * not be used at all. Without it the OS offers both, at the cost of one
 * extra tap on the camera path.
 *
 * The file is resized in the browser BEFORE upload, so a 4MB iPhone photo
 * becomes tens of kilobytes and field wifi is not asked to carry the
 * original. That matters more for a library photo than a fresh capture,
 * since an old one may be full resolution.
 *
 * Optional throughout: nothing blocks on a photo existing, and the default
 * jersey-number circle stands in wherever one is missing.
 */
export function HeadshotUpload({
  prospectId,
  tryoutId,
  hasHeadshot,
  currentPath,
  orgId,
}: {
  prospectId: string;
  tryoutId: string;
  hasHeadshot: boolean;
  currentPath: string | null;
  /** First path segment. Storage policies authorize on it. */
  orgId: string;
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

      const path = headshotPath(orgId, tryoutId, prospectId);
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
    <>
      {/*
        A pencil badge on the corner of the photo, not a bar under it.
        Editing a headshot is a rare, obvious action and it belongs ON the
        thing it edits - the full-width "Replace photo" bar was spending a
        row of a phone header on it.
      */}
      <label
        aria-label={
          hasHeadshot
            ? "Replace photo — take one or choose from your library"
            : "Add photo — take one or choose from your library"
        }
        title={hasHeadshot ? "Replace photo" : "Add photo"}
        className={
          "bb-card absolute -right-1 -bottom-1 flex h-8 w-8 cursor-pointer items-center " +
          "justify-center rounded-full border border-border bg-card text-foreground " +
          (busy ? "opacity-50" : "active:bg-secondary")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          disabled={busy}
          className="sr-only"
        />
        <PencilIcon />
      </label>

      {/* Removal is destructive and rare, so it stays out of the badge and
          only appears once there is something to remove. */}
      {hasHeadshot && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label="Remove photo"
          title="Remove photo"
          className="bb-card absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center
                     rounded-full border border-border bg-card text-xs text-muted-foreground
                     disabled:opacity-50"
        >
          &times;
        </button>
      )}

      {(status || error) && (
        <p
          role={error ? "alert" : undefined}
          className={
            "absolute top-full left-0 mt-1 w-40 text-[11px] " +
            (error ? "text-destructive" : "text-muted-foreground")
          }
        >
          {error ?? status}
        </p>
      )}
    </>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
