"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { isSemester } from "@/lib/tryouts";

export type TryoutResult = { ok: true; id: string } | { ok: false; error: string };
export type SwitchResult = { ok: true } | { ok: false; error: string };

const NAME_MAX = 80;

/**
 * Create a tryout class and make it the active one.
 *
 * ADMIN ONLY, enforced here and by the create_tryouts RLS policy.
 *
 * The new class starts active because that is invariably why it is being
 * created - a season is starting. Every screen reads the active class, so
 * this is the switch that moves the whole app onto the new year. The previous
 * class is untouched and stays selectable, which is what keeps history.
 */
export async function createTryout(
  name: string,
  year: number | null,
  semester: string,
): Promise<TryoutResult> {
  const { profile, is_admin, activeOrg } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!is_admin) {
    return { ok: false, error: "Only an admin can create a tryout class." };
  }
  if (!activeOrg) return { ok: false, error: "No active organization." };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the class a name." };
  if (trimmed.length > NAME_MAX) {
    return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  }
  if (!isSemester(semester)) {
    return { ok: false, error: "Pick a semester." };
  }
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    return { ok: false, error: "That year does not look right." };
  }

  const supabase = await createClient();

  // A tryout is the ROOT of the org tree - there is no parent row to derive
  // org_id from, so unlike prospects and ratings it has no BEFORE INSERT
  // trigger and must carry both ids itself. Omitting org_id leaves it null,
  // app.is_admin(null) is not true, and the insert fails the RLS policy
  // rather than the NOT NULL constraint - which reads as a permissions bug.
  const { data: template } = await supabase
    .from("templates")
    .select("id")
    .eq("org_id", activeOrg.orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!template) {
    return {
      ok: false,
      error: "This organization has no evaluation template to attach.",
    };
  }

  // Stand the new class down first, so there is never a moment with two
  // active classes for a screen to pick between.
  const { error: deactivateErr } = await supabase
    .from("tryouts")
    .update({ is_active: false })
    .eq("org_id", activeOrg.orgId)
    .eq("is_active", true);
  if (deactivateErr) return { ok: false, error: deactivateErr.message };

  const { data, error } = await supabase
    .from("tryouts")
    .insert({
      org_id: activeOrg.orgId,
      template_id: template.id,
      name: trimmed,
      season_year: year,
      semester,
      tryout_date: null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateEverything();
  return { ok: true, id: data.id };
}

/**
 * Switch which class the app is showing.
 *
 * Two statements rather than one, so for an instant no class is active. That
 * ordering is deliberate: a brief "no active tryout" is a harmless empty
 * screen, whereas two active classes would leave every read picking one
 * arbitrarily.
 */
export async function setActiveTryout(tryoutId: string): Promise<SwitchResult> {
  const { profile, is_admin, activeOrg } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!is_admin) {
    return { ok: false, error: "Only an admin can switch the active class." };
  }
  if (!activeOrg) return { ok: false, error: "No active organization." };

  const supabase = await createClient();

  // Scoped to THIS org. Without the filter, an admin of two orgs would
  // stand down the other org's active class as a side effect of switching
  // this one - RLS permits the write, so nothing would object.
  const { error: offErr } = await supabase
    .from("tryouts")
    .update({ is_active: false })
    .eq("org_id", activeOrg.orgId)
    .eq("is_active", true);
  if (offErr) return { ok: false, error: offErr.message };

  const { data, error } = await supabase
    .from("tryouts")
    .update({ is_active: true })
    .eq("id", tryoutId)
    .eq("org_id", activeOrg.orgId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    // RLS returns zero rows rather than an error when the policy blocks.
    return {
      ok: false,
      error: "Nothing changed. Your account may not have admin rights.",
    };
  }

  revalidateEverything();
  return { ok: true };
}

/** Every screen reads the active class, so all of them go stale on a switch. */
function revalidateEverything() {
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/selected");
  revalidatePath("/account");
}

/**
 * Rename a tryout class — new in v2 (SPEC-V2.md sections 2.5 and 5).
 *
 * v1 had no rename UI, and `tryouts` deliberately has no DELETE policy
 * because a class is the historical record — so a class created with a typo
 * was permanent. The admin UPDATE policy always allowed this; only the UI
 * was missing.
 *
 * Renaming touches nothing but the label. Every athlete, rating, drill
 * result, selection and comment hangs off tryout_id and is unaffected.
 */
export async function renameTryout(
  tryoutId: string,
  name: string,
): Promise<SwitchResult> {
  const { profile, is_admin } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!is_admin) {
    return { ok: false, error: "Only an admin can rename a tryout class." };
  }

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the class a name." };
  if (trimmed.length > NAME_MAX) {
    return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tryouts")
    .update({ name: trimmed })
    .eq("id", tryoutId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
