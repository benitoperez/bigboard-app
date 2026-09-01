"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";

export type HeadshotResult = { ok: true } | { ok: false; error: string };

/**
 * Record the storage path of an uploaded headshot on the prospect.
 *
 * The file itself is uploaded straight from the browser to Supabase Storage,
 * so the bytes never pass through the server. This only writes the pointer.
 *
 * A PATH is stored, not a URL. The bucket is private, so a URL would need a
 * signature that expires - storing one would leave dead links in the database
 * within the hour. The signed URL is minted at render time instead.
 */
export async function setHeadshotPath(
  prospectId: string,
  path: string,
): Promise<HeadshotResult> {
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({ headshot_url: path })
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  revalidatePath("/selected");
  return { ok: true };
}

/** Remove a headshot: delete the object, then clear the pointer. */
export async function removeHeadshot(
  prospectId: string,
  path: string,
): Promise<HeadshotResult> {
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const supabase = await createClient();

  // Clear the pointer even if the object delete fails. A prospect showing the
  // default jersey circle is a much smaller problem than one whose row points
  // at a file that is no longer there.
  await supabase.storage.from("headshots").remove([path]);

  const { error } = await supabase
    .from("prospects")
    .update({ headshot_url: null })
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  revalidatePath("/selected");
  return { ok: true };
}
