"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";

export type DeleteResult = { ok: false; error: string };

/**
 * Delete one prospect.
 *
 * ADMIN ONLY, enforced both here and by the delete_prospects RLS policy.
 * This cascades: every rating, 40 time, selection, and comment about the
 * prospect goes with him, and the headshot object is removed too. That is
 * not a collaborative edit, it is destruction, so it does not sit one
 * mis-tap away for fifteen people.
 *
 * On success this redirects rather than returning - the page the caller is
 * standing on no longer exists.
 */
export async function deleteProspect(
  prospectId: string,
): Promise<DeleteResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };
  if (!officer.is_admin) {
    return { ok: false, error: "Only an admin can delete a prospect." };
  }

  const supabase = await createClient();

  // Storage is not covered by the database cascade, so the object has to go
  // separately or it is orphaned in the bucket forever.
  const { data: p } = await supabase
    .from("prospects")
    .select("headshot_url")
    .eq("id", prospectId)
    .maybeSingle();

  if (p?.headshot_url) {
    await supabase.storage.from("headshots").remove([p.headshot_url]);
  }

  const { data: deleted, error } = await supabase
    .from("prospects")
    .delete()
    .eq("id", prospectId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!deleted || deleted.length === 0) {
    // RLS returns zero rows rather than an error when the policy blocks it.
    return {
      ok: false,
      error: "Nothing was deleted. Your account may not have admin rights.",
    };
  }

  revalidatePath("/players");
  revalidatePath("/selected");
  revalidatePath("/");
  redirect("/players");
}
