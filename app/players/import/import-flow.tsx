"use client";

import { useEffect, useState, useTransition } from "react";
import Papa from "papaparse";
import type { Template } from "@/lib/template";
import { validateRoster } from "@/lib/csv/roster";
import { prepareImport, type ReviewRow } from "./actions";
import { ReviewTable } from "./review-table";

/**
 * Bulk roster import — SPEC-V2.md section 10b.
 *
 * Three sources, ONE review table. The CSV path never calls the AI: a file
 * that already parses does not need a model, and routing it through one
 * would spend quota and add a failure mode for nothing.
 */

type Stage =
  | { kind: "picker" }
  | { kind: "working"; message: string }
  | { kind: "paste" }
  | { kind: "photo" }
  | { kind: "error"; message: string }
  | { kind: "review"; rows: ReviewRow[]; notes: string[] };

/** Long edge for an uploaded roster photo. Text has to stay legible. */
const PHOTO_MAX_EDGE = 1600;
const MAX_IMAGES = 6;

export function ImportFlow({
  template,
  orgId,
  onClose,
}: {
  template: Template;
  orgId: string;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "picker" });
  const [takenJerseys, setTakenJerseys] = useState<number[]>([]);
  const [tryoutName, setTryoutName] = useState("");
  const [pendingPrepare, startPrepare] = useTransition();

  // Collisions cannot be flagged without knowing what is already in the
  // class, so this is fetched up front rather than at review time.
  useEffect(() => {
    startPrepare(async () => {
      const res = await prepareImport();
      if (!res.ok) {
        setStage({ kind: "error", message: res.error });
        return;
      }
      setTakenJerseys(res.takenJerseys);
      setTryoutName(res.tryoutName);
    });
  }, []);

  function fail(message: string) {
    setStage({ kind: "error", message });
  }

  // ---------------------------------------------------------------- CSV

  function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage({ kind: "working", message: `Reading ${file.name}...` });

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: false,
      complete: (parsed) => {
        const headers = parsed.meta.fields ?? [];
        // Validated with an EMPTY taken-set: collisions are a per-row choice
        // in the review table now, not a whole-file rejection. Everything
        // else - bad positions, unparseable times - still fails here, where
        // the message can name the line.
        const result = validateRoster(
          parsed.data,
          headers,
          new Set<number>(),
          template,
        );

        if (!result.ok) {
          fail(
            result.errors
              .slice(0, 12)
              .map((x) => (x.line > 0 ? `Line ${x.line}: ${x.message}` : x.message))
              .join("\n"),
          );
          return;
        }

        setStage({
          kind: "review",
          notes: [],
          rows: result.rows.map((r) => ({
            firstName: r.first_name,
            lastName: r.last_name,
            jerseyNumber: String(r.jersey_number),
            positions: [r.primary_position, ...r.secondary_positions],
            drills: Object.fromEntries(
              Object.entries(r.drills).map(([k, v]) => [
                k,
                v.map((n) => (n === null ? "" : String(n))),
              ]),
            ),
            selected: r.selected,
            mode: takenJerseys.includes(r.jersey_number) ? "skip" : "insert",
          })),
        });
      },
      error: (err: Error) => fail(`Could not read the file: ${err.message}`),
    });
  }

  // ------------------------------------------------------------- AI paths

  async function extract(payload: { text?: string; images?: string[] }) {
    setStage({ kind: "working", message: "Reading the roster..." });
    try {
      const res = await fetch("/api/ai/roster-extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data?.error ?? "That did not work.");
        return;
      }

      type Extracted = {
        first_name: string;
        last_name: string;
        jersey_number: string;
        positions: string[];
        drills: Record<string, string[]>;
        uncertain: string[];
      };

      const rows: ReviewRow[] = (data.rows as Extracted[]).map((r) => {
        const jersey = r.jersey_number;
        const n = Number(jersey);
        const collides = Number.isInteger(n) && takenJerseys.includes(n);
        return {
          firstName: r.first_name,
          lastName: r.last_name,
          jerseyNumber: jersey,
          positions: r.positions.map((p) => p.toUpperCase()),
          drills: r.drills ?? {},
          selected: false,
          // A collision defaults to SKIP, never overwrite. Overwriting is
          // destructive and this data came from a model reading a photo -
          // the safe default has to be the one that changes nothing.
          mode: collides ? "skip" : "insert",
          uncertain: r.uncertain ?? [],
        };
      });

      if (rows.length === 0) {
        fail("No athletes were found in that. Try a clearer photo, or paste the text.");
        return;
      }

      setStage({ kind: "review", rows, notes: data.notes ?? [] });
    } catch {
      fail("Could not reach the server.");
    }
  }

  // ------------------------------------------------------------- rendering

  if (stage.kind === "error") {
    return (
      <div>
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-bold text-foreground">That did not work</p>
          <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
            {stage.message}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setStage({ kind: "picker" })}
            className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            Try another way
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "working") {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {stage.message}
      </p>
    );
  }

  if (stage.kind === "review") {
    return (
      <ReviewTable
        template={template}
        initialRows={stage.rows}
        takenJerseys={takenJerseys}
        notes={stage.notes}
        onCancel={onClose}
      />
    );
  }

  if (stage.kind === "paste") {
    return <PasteStep onBack={() => setStage({ kind: "picker" })} onSubmit={(text) => extract({ text })} />;
  }

  if (stage.kind === "photo") {
    return (
      <PhotoStep
        onBack={() => setStage({ kind: "picker" })}
        onSubmit={(images) => extract({ images })}
        onError={fail}
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {pendingPrepare
          ? "Checking the class..."
          : `Importing into ${tryoutName}. Nothing is saved until you review it.`}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <label className="bb-card flex min-h-tap-large cursor-pointer flex-col justify-center rounded-lg border border-border bg-card px-4 py-3 active:bg-secondary">
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            onChange={onCsv}
            className="sr-only"
          />
          <span className="text-sm font-bold text-foreground">
            Upload CSV or Excel file
          </span>
          <span className="text-xs text-muted-foreground">
            Read directly. No AI, no waiting.
          </span>
        </label>

        <button
          type="button"
          onClick={() => setStage({ kind: "photo" })}
          className="bb-card flex min-h-tap-large flex-col justify-center rounded-lg border border-chip-violet/40 bg-chip-violet/10 px-4 py-3 text-left active:opacity-80"
        >
          <span className="text-sm font-bold text-foreground">
            Upload a photo or screenshot
          </span>
          <span className="text-xs text-muted-foreground">
            AI reads it. Camera or library, JPG, PNG or HEIC, several pages
            at once.
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStage({ kind: "paste" })}
          className="bb-card flex min-h-tap-large flex-col justify-center rounded-lg border border-chip-violet/40 bg-chip-violet/10 px-4 py-3 text-left active:opacity-80"
        >
          <span className="text-sm font-bold text-foreground">
            Paste text or a table
          </span>
          <span className="text-xs text-muted-foreground">
            AI reads it. From an email, a message, or a spreadsheet.
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="min-h-tap mt-3 w-full rounded-md border border-border text-sm font-semibold text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function PasteStep({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div>
      <label htmlFor="paste-roster" className="text-sm font-semibold text-foreground">
        Paste the roster
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        A list, a table, an email — whatever shape it is in. The AI will not
        guess: anything it cannot read is left blank and flagged for you.
      </p>
      <textarea
        id="paste-roster"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={"17 Marcus Reid QB\n21 DeShawn Carter WR, DB\n..."}
        className="mt-2 w-full rounded-md border border-border bg-input p-3 text-sm
                   text-foreground outline-none focus-visible:border-primary"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onSubmit(text)}
          disabled={text.trim().length === 0}
          className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          Read this
        </button>
      </div>
    </div>
  );
}

function PhotoStep({
  onBack,
  onSubmit,
  onError,
}: {
  onBack: () => void;
  onSubmit: (images: string[]) => void;
  onError: (message: string) => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function add(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (images.length + files.length > MAX_IMAGES) {
      onError(`Up to ${MAX_IMAGES} images at a time.`);
      return;
    }

    setBusy(true);
    try {
      const prepared = await Promise.all(files.map(toResizedDataUrl));
      setImages((cur) => [...cur, ...prepared]);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "One of those images could not be read.",
      );
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-foreground">Roster photos</p>
      <p className="mt-1 text-xs text-muted-foreground">
        A printed sheet, a whiteboard, a screenshot. Take them now or pick
        them from your library, one image per page. Anything the AI cannot
        read confidently is left blank and flagged, not guessed.
      </p>

      {images.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <li key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Page ${i + 1}`}
                className="bb-card h-20 w-20 rounded-md object-cover"
              />
              <button
                type="button"
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                aria-label={`Remove page ${i + 1}`}
                className="bb-card absolute -top-1 -right-1 flex h-6 w-6 items-center
                           justify-center rounded-full border border-border bg-card
                           text-xs text-muted-foreground"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <label
        className={
          "mt-2 flex min-h-tap-large cursor-pointer items-center justify-center rounded-md " +
          "border border-dashed border-border-strong px-4 text-sm font-semibold " +
          (busy ? "opacity-50" : "text-foreground active:bg-secondary")
        }
      >
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={add}
          disabled={busy}
          className="sr-only"
        />
        {busy ? "Preparing..." : images.length ? "Add another page" : "Choose photos"}
      </label>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onSubmit(images)}
          disabled={images.length === 0 || busy}
          className="min-h-tap flex-1 rounded-md bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          Read {images.length || ""} {images.length === 1 ? "page" : "pages"}
        </button>
      </div>
    </div>
  );
}

/**
 * Resize an image and return it as a data URL.
 *
 * Resized in the BROWSER, before upload, for the same reason headshots are
 * (SPEC.md section 13): a raw phone photo is several megabytes and field
 * wifi should not be asked to carry it. The long edge stays generous here
 * though — a headshot only has to look like a person, and this has to stay
 * legible enough to read handwriting out of.
 *
 * createImageBitmap with imageOrientation handles EXIF rotation, so a
 * sideways phone photo is not sent sideways to the model.
 */
async function toResizedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // 0.85 rather than the headshot's 0.82: JPEG artefacts around small text
  // are what turn a readable jersey number into a guess.
  const url = canvas.toDataURL("image/jpeg", 0.85);

  const bytes = Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);
  if (bytes > 5 * 1024 * 1024) {
    throw new Error("That image is still over 5MB after resizing.");
  }
  return url;
}
