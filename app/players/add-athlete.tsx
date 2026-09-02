"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAthlete } from "./add-actions";
import { setHeadshotPath } from "./[id]/headshot-actions";
import { createClient } from "@/lib/supabase/client";
import { ImportSheet } from "./import/import-sheet";
import type { Template } from "@/lib/template";
import {
  HEADSHOT_MAX_EDGE,
  formatBytes,
  headshotPath,
  prepareHeadshot,
} from "@/lib/images";

/**
 * Add an athlete by hand, for anyone who turns up who was not on the imported
 * sheet. Open to every officer, per the write_prospects policy.
 *
 * A centred sheet rather than an inline form: this opens from a header button
 * on a phone, and a sheet cannot end up half off-screen the way an anchored
 * panel can.
 */
export type PositionOption = { code: string; label: string };

export function AddAthlete({
  tryoutName,
  tryoutId,
  orgId,
  positions,
  template,
  size = "normal",
}: {
  tryoutName: string;
  /** Needed to build the headshot storage path if a photo is attached. */
  tryoutId: string;
  orgId: string;
  /** The org template's positions, in board order. */
  positions: PositionOption[];
  /** Passed through to the bulk import flow inside the sheet. */
  template: Template;
  /**
   * "large" is for an empty roster, where adding someone is the only thing
   * worth doing on the screen. It shrinks back to "normal" once there is at
   * least one athlete and the list itself is the point.
   */
  size?: "normal" | "large";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          size === "large"
            ? "min-h-tap-large w-full rounded-lg bg-primary px-6 text-base font-bold " +
              "tracking-wide text-primary-foreground active:opacity-80"
            : "min-h-tap shrink-0 rounded-md border border-border bg-card px-3 text-sm " +
              "font-semibold text-foreground active:bg-secondary"
        }
      >
        {size === "large" ? "+ Add an athlete" : "+ Add"}
      </button>

      {open && (
        <AddSheet
          tryoutName={tryoutName}
          tryoutId={tryoutId}
          orgId={orgId}
          positions={positions}
          template={template}
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function AddSheet({
  tryoutName,
  tryoutId,
  orgId,
  positions,
  template,
  onClose,
  onAdded,
}: {
  tryoutName: string;
  tryoutId: string;
  orgId: string;
  positions: PositionOption[];
  template: Template;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [primaryPosition, setPrimary] = useState<string>(positions[0]?.code ?? "");
  const [secondary, setSecondary] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The photo is held locally until the athlete exists. The storage path is
  // keyed on the prospect id, which does not exist until the insert
  // succeeds - so this is deliberately a two-step, not one upload.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  function choosePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhoto(file);
    setPhotoPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function clearPhoto() {
    setPhoto(null);
    setPhotoPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (photoInput.current) photoInput.current.value = "";
  }

  // Object URLs are a manual allocation; letting them pile up leaks the
  // whole image per pick.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function toggleSecondary(p: string) {
    setSecondary((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addAthlete({
        firstName,
        lastName,
        jerseyNumber,
        primaryPosition,
        secondaryPositions: secondary,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }

      // The athlete is saved at this point. A photo failure must NOT undo
      // that - a roster entry without a picture is fine, and SPEC.md
      // section 13 is explicit that nothing blocks on a photo existing. So
      // the sheet closes either way and the error is reported after.
      if (photo) {
        try {
          const prepared = await prepareHeadshot(photo, HEADSHOT_MAX_EDGE);
          const path = headshotPath(orgId, tryoutId, res.id);
          const supabase = createClient();
          const { error: upErr } = await supabase.storage
            .from("headshots")
            .upload(path, prepared.blob, {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (upErr) throw new Error(upErr.message);

          const saved = await setHeadshotPath(res.id, path);
          if (!saved.ok) throw new Error(saved.error);
        } catch (err) {
          setError(
            (err instanceof Error ? err.message : "The photo did not upload.") +
              " The athlete was still added - add the photo from their profile.",
          );
          return;
        }
      }

      onAdded();
    });
  }

  const canSubmit =
    firstName.trim() && lastName.trim() && jerseyNumber.trim() && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add an athlete"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/80"
      />

      <form
        onSubmit={submit}
        className="relative max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-lg
                   border border-border bg-popover p-4 shadow-2xl"
      >
        <h2 className="text-xl uppercase">Add athlete</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Added to {tryoutName}.
        </p>

        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <label htmlFor="a-first" className="block text-sm text-muted-foreground">
              First name
            </label>
            <input
              id="a-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoCapitalize="words"
              disabled={pending}
              className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                         text-base text-foreground outline-none focus-visible:border-primary
                         focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="a-last" className="block text-sm text-muted-foreground">
              Last name
            </label>
            <input
              id="a-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoCapitalize="words"
              disabled={pending}
              className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                         text-base text-foreground outline-none focus-visible:border-primary
                         focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </div>
        </div>

        <label htmlFor="a-jersey" className="mt-3 block text-sm text-muted-foreground">
          Jersey number
        </label>
        <input
          id="a-jersey"
          value={jerseyNumber}
          onChange={(e) => setJerseyNumber(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="00"
          disabled={pending}
          className="tnum min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                     text-center text-xl font-bold text-foreground
                     placeholder:text-muted-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2
                     focus-visible:ring-ring/40 disabled:opacity-50"
        />

        <label htmlFor="a-pos" className="mt-3 block text-sm text-muted-foreground">
          Primary position
        </label>
        <select
          id="a-pos"
          value={primaryPosition}
          onChange={(e) => setPrimary(e.target.value)}
          disabled={pending}
          className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                     text-base text-foreground outline-none focus-visible:border-primary
                     disabled:opacity-50"
        >
          {positions.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} — {p.label}
            </option>
          ))}
        </select>

        <p className="mt-3 text-sm text-muted-foreground">
          Also trying out at (optional)
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {positions.filter((p) => p.code !== primaryPosition).map((p) => {
            const on = secondary.includes(p.code);
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => toggleSecondary(p.code)}
                aria-pressed={on}
                disabled={pending}
                className={
                  "min-h-tap rounded-full px-4 text-sm font-bold uppercase disabled:opacity-50 " +
                  (on
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground")
                }
              >
                {p.code}
              </button>
            );
          })}
        </div>

        {/* Photo last, and optional. Adding it here saves walking back to
            the profile for every athlete, but nothing waits on it: the
            athlete is created first and the upload follows. */}
        {/* Adding athletes one at a time is exactly where someone realises
            they have a whole roster. Making them back out to a settings tab
            to act on that is the wrong shape. */}
        <div className="mt-4 border-t border-border pt-3">
          <ImportSheet
            template={template}
            orgId={orgId}
            trigger={
              <span className="bb-card flex min-h-tap-large w-full cursor-pointer flex-col justify-center rounded-lg border border-chip-violet/40 bg-chip-violet/10 px-4 py-2 text-left">
                <span className="text-sm font-bold text-foreground">
                  Import full roster
                </span>
                <span className="text-xs text-muted-foreground">
                  CSV or Excel, a photo of a sheet, or pasted text
                </span>
              </span>
            }
          />
        </div>

        <p className="mt-4 text-sm text-muted-foreground">Photo (optional)</p>
        <div className="mt-1 flex items-center gap-3">
          <label
            className={
              "flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-md " +
              "border border-dashed border-border-strong px-3 text-xs font-semibold " +
              (pending ? "opacity-50" : "text-foreground active:bg-secondary")
            }
          >
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={choosePhoto}
              disabled={pending}
              className="sr-only"
            />
            {photo ? "Change photo" : "Take or choose a photo"}
          </label>

          {photoPreview && (
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt=""
                className="bb-avatar-photo h-11 w-11 rounded-full object-cover"
              />
              <button
                type="button"
                onClick={clearPhoto}
                disabled={pending}
                aria-label="Remove photo"
                className="bb-card absolute -top-1 -right-1 flex h-5 w-5 items-center
                           justify-center rounded-full border border-border bg-card
                           text-[10px] text-muted-foreground disabled:opacity-50"
              >
                &times;
              </button>
            </div>
          )}
        </div>
        {photo && (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(photo.size)} &mdash; resized to about 400px before
            upload.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="min-h-tap flex-1 rounded-md border border-border text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold
                       text-primary-foreground disabled:opacity-40"
          >
            {pending ? "Adding..." : "Add athlete"}
          </button>
        </div>
      </form>
    </div>
  );
}
