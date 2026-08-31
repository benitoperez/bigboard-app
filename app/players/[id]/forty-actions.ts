"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { MAX_FORTY_ATTEMPTS } from "@/lib/config/positions";

export type FortyResult = { ok: true } | { ok: false; error: string };

/**
 * Record or correct one 40 attempt - SPEC.md section 8.
 *
 * ANY officer may write or fix ANY attempt. That is deliberate, and the
 * schema says so: drill_results is unique on (prospect_id, drill_key,
 * attempt_number) and NOT on the officer. A fat-fingered 5.9 sitting in the
 * system all day is a worse outcome than a small trust risk among fifteen
 * people who know each other.
 *
 * recorded_by is stamped with the caller, which the RLS policy also enforces
 * with check (recorded_by = auth.uid()) - attribution survives even though
 * anyone can overwrite.
 */
export async function saveFortyAttempt(
  prospectId: string,
  attemptNumber: number,
  raw: string,
): Promise<FortyResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > MAX_FORTY_ATTEMPTS) {
    return { ok: false, error: `Attempt must be 1 to ${MAX_FORTY_ATTEMPTS}.` };
  }

  const trimmed = raw.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter a time like 4.61." };
  }

  const value = Number(trimmed);
  // Mirrors the CHECK constraint: value > 0 and value < 20.
  if (!(value > 0 && value < 20)) {
    return { ok: false, error: "Time must be between 0 and 20 seconds." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("drill_results").upsert(
    {
      prospect_id: prospectId,
      drill_key: "forty",
      attempt_number: attemptNumber,
      value,
      recorded_by: officer.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "prospect_id,drill_key,attempt_number" },
  );

  if (error) return { ok: false, error: error.message };

  // The 40 feeds every positional rating through the speed percentile, and it
  // shifts the percentile of everyone else in the tryout, so the boards and
  // the directory both go stale on a write here.
  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Clear a recorded attempt outright.
 *
 * Permitted by the drills_delete policy, which is `using (true)` for the same
 * reason insert and update are open: a wrong time left in the system is worse
 * than a small trust risk. Note this differs from ratings, where delete is
 * restricted to the officer's own rows - a rating is one person's opinion and
 * therefore his alone to withdraw, while a 40 time is a measurement anyone
 * present can see is wrong.
 */
export async function deleteFortyAttempt(
  prospectId: string,
  attemptNumber: number,
): Promise<FortyResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("drill_results")
    .delete()
    .eq("prospect_id", prospectId)
    .eq("drill_key", "forty")
    .eq("attempt_number", attemptNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}
