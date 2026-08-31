"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";

export type ToggleResult =
  | { ok: true; selected: boolean }
  | { ok: false; error: string };

/**
 * Add or remove a prospect from the shared team list - SPEC.md section 10.4.
 *
 * `selections` is unique on (tryout_id, prospect_id), so this is one list for
 * the whole staff rather than a list per officer. That uniqueness is also the
 * concurrency story: if two officers tap add at the same instant, one insert
 * wins and the other comes back 23505. That is not an error worth showing -
 * the prospect is on the list, which is what the officer wanted. It is
 * reported as success.
 */
export async function toggleSelection(
  prospectId: string,
  wantSelected: boolean,
): Promise<ToggleResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: tryout } = await supabase
    .from("tryouts")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!tryout) return { ok: false, error: "No active tryout." };

  if (wantSelected) {
    const { error } = await supabase.from("selections").insert({
      tryout_id: tryout.id,
      prospect_id: prospectId,
      selected_by: officer.id,
    });

    // 23505: someone else added him a moment ago. Same end state, not a
    // failure the officer needs to see.
    if (error && error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  } else {
    // Anyone can remove, per the selections_delete policy. Removing something
    // already removed is likewise not an error.
    const { error } = await supabase
      .from("selections")
      .delete()
      .eq("tryout_id", tryout.id)
      .eq("prospect_id", prospectId);

    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/selected");
  revalidatePath("/players");
  revalidatePath(`/players/${prospectId}`);
  return { ok: true, selected: wantSelected };
}
