import { createClient } from "@/lib/supabase/server";

/** An hour is plenty for a server-rendered page and keeps links short-lived. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Mint signed URLs for private headshot objects.
 *
 * The bucket is private, so an <img src> needs a signature. Signing happens
 * at render time rather than at upload because a stored signed URL would
 * expire and leave dead links in the database.
 *
 * Signed in one batch: a roster of 120 prospects would otherwise be 120 round
 * trips to build a single list screen.
 *
 * A failure here is deliberately soft. Headshots are optional (SPEC.md
 * section 13) and nothing blocks on one existing, so an unsigned prospect
 * falls back to the jersey-number circle rather than breaking the page.
 */
export async function signHeadshots(
  paths: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("headshots")
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return signed;

  for (const row of data) {
    if (row.signedUrl && row.path) signed.set(row.path, row.signedUrl);
  }
  return signed;
}
