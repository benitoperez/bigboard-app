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
  const { profile, is_admin } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!is_admin) {
    return { ok: false, error: "Only an admin can create a tryout class." };
  }

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

  // Stand the new class down first, so there is never a moment with two
  // active classes for a screen to pick between.
  const { error: deactivateErr } = await supabase
    .from("tryouts")
    .update({ is_active: false })
    .eq("is_active", true);
  if (deactivateErr) return { ok: false, error: deactivateErr.message };

  const { data, error } = await supabase
    .from("tryouts")
    .insert({
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
  const { profile, is_admin } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!is_admin) {
    return { ok: false, error: "Only an admin can switch the active class." };
  }

  const supabase = await createClient();

  const { error: offErr } = await supabase
    .from("tryouts")
    .update({ is_active: false })
    .eq("is_active", true);
  if (offErr) return { ok: false, error: offErr.message };

  const { data, error } = await supabase
    .from("tryouts")
    .update({ is_active: true })
    .eq("id", tryoutId)
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
