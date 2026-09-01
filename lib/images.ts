/**
 * Client-side headshot preparation - SPEC.md section 13.
 *
 * Two things this exists to solve, both called out in the spec:
 *
 *   1. SIZE. "A raw iPhone photo is several megabytes and will wreck load
 *      times on field wifi." Resized to 400px on the long edge, a headshot
 *      lands around 20-40KB. A hundred prospects is then a couple of
 *      megabytes for the whole roster rather than per photo.
 *
 *   2. ROTATION. "iPhones will hand you sideways images if you do not."
 *      A photo taken in portrait is often stored landscape with an EXIF
 *      orientation flag saying "rotate me". Drawing it to a canvas naively
 *      ignores that flag and bakes in the wrong orientation.
 *
 *      createImageBitmap(file, { imageOrientation: "from-image" }) applies
 *      the flag during decode, which is why there is no EXIF parser here.
 *      Hand-rolling one is a classic way to get six of the eight
 *      orientation cases subtly wrong.
 *
 * HEIC: Safari decodes it natively, so this works on the iPhones that
 * actually produce it. Chrome and Firefox cannot, and there is no honest way
 * to fake it client-side - those get a clear error rather than a broken
 * upload. iOS hands over JPEG when the camera is opened through a file input
 * anyway, which is the path officers will use on the field.
 */

export const HEADSHOT_MAX_EDGE = 400;
export const HEADSHOT_QUALITY = 0.82;

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  /** Bytes before resizing, for the "3.8MB -> 31KB" line in the UI. */
  originalBytes: number;
};

export async function prepareHeadshot(
  file: File,
  maxEdge = HEADSHOT_MAX_EDGE,
): Promise<PreparedImage> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error("That file is not an image.");
  }

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the EXIF orientation flag during decode.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || file.type.includes("hei");
    throw new Error(
      heic
        ? "This browser cannot read HEIC photos. Use Safari on the iPhone, or set the camera to Most Compatible."
        : "Could not read that image.",
    );
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not process the image on this device.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", HEADSHOT_QUALITY),
  );
  if (!blob) throw new Error("Could not encode the resized image.");

  return { blob, width, height, originalBytes: file.size };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deterministic path, so replacing a headshot overwrites rather than piles up. */
export function headshotPath(
  orgId: string,
  tryoutId: string,
  prospectId: string,
): string {
  // The ORG id must be the first segment: the storage policies authorize by
  // parsing it out of the path (SPEC-V2 section 2.4). Putting anything else
  // first leaves the object unreadable, and because a tryout id is also a
  // valid uuid it fails silently rather than erroring.
  return `${orgId}/${tryoutId}/${prospectId}.jpg`;
}
