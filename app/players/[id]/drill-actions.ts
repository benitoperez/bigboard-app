"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getTemplateForTryout } from "@/lib/data/template";
import { getDrill, type TemplateDrill } from "@/lib/template";

export type DrillResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve a drill against the tryout the prospect actually belongs to.
 *
 * The drill key arrives from the client, so it is never trusted: a key that
 * is not in this tryout's template would write a drill_results row nothing
 * can score, and the value bounds come from the template rather than from
 * anything the browser sent.
 */
async function resolveDrill(
  prospectId: string,
  drillKey: string,
): Promise<{ drill: TemplateDrill } | { error: string }> {
  const supabase = await createClient();
  const { data: prospect } = await supabase
    .from("prospects")
    .select("tryout_id")
    .eq("id", prospectId)
    .maybeSingle();

  if (!prospect) return { error: "Athlete not found." };

  const template = await getTemplateForTryout(prospect.tryout_id);
  if (!template) return { error: "This tryout has no evaluation template." };

  const drill = getDrill(template, drillKey);
  if (!drill) return { error: "That drill is not part of this tryout." };

  return { drill };
}

/**
 * Record or correct one drill attempt - SPEC.md section 8, generalized by
 * SPEC-V2.md section 3.2.
 *
 * Any EVALUATOR and up may write or fix ANY attempt, including one somebody
 * else recorded. That is deliberate, and the schema says so: drill_results
 * is unique on (prospect_id, drill_key, attempt_number) and NOT on the
 * officer. A fat-fingered 5.9 sitting in the system all day is a worse
 * outcome than a small trust risk among people who know each other.
 *
 * recorded_by is stamped with the caller, which the RLS policy also enforces
 * with check (recorded_by = auth.uid()) - attribution survives even though
 * anyone in the org can overwrite. Viewers are refused by the policy.
 */
export async function saveDrillAttempt(
  prospectId: string,
  drillKey: string,
  attemptNumber: number,
  raw: string,
): Promise<DrillResult> {
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const resolved = await resolveDrill(prospectId, drillKey);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { drill } = resolved;

  if (
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber > drill.maxAttempts
  ) {
    return { ok: false, error: `Attempt must be 1 to ${drill.maxAttempts}.` };
  }

  const trimmed = raw.trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(trimmed)) {
    return { ok: false, error: `Enter a ${drill.label.toLowerCase()} value.` };
  }

  const value = Number(trimmed);
  // The range is the drill's own, not a hardcoded 40-time window: a 40 runs
  // 0-20 seconds and an exit velocity runs 0-130 mph.
  if (!(value > drill.valueMin && value <= drill.valueMax)) {
    return {
      ok: false,
      error: `${drill.label} must be between ${drill.valueMin} and ${drill.valueMax} ${drill.unit}.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("drill_results").upsert(
    {
      prospect_id: prospectId,
      drill_key: drill.key,
      attempt_number: attemptNumber,
      value,
      recorded_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "prospect_id,drill_key,attempt_number" },
  );

  if (error) return { ok: false, error: error.message };

  // A drill result feeds every positional rating that weights it, through
  // the percentile, and it shifts the percentile of everyone else in the
  // class - so the boards and the directory both go stale on a write here.
  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Clear a recorded attempt outright.
 *
 * Permitted by the drills_delete policy, which is open to evaluator+ for the
 * same reason insert and update are: a wrong measurement left in the system
 * is worse than a small trust risk. Note this differs from ratings, where
 * delete is restricted to the officer's own rows - a rating is one person's
 * opinion and therefore his alone to withdraw, while a drill result is a
 * measurement anyone present can see is wrong.
 */
export async function deleteDrillAttempt(
  prospectId: string,
  drillKey: string,
  attemptNumber: number,
): Promise<DrillResult> {
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const resolved = await resolveDrill(prospectId, drillKey);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("drill_results")
    .delete()
    .eq("prospect_id", prospectId)
    .eq("drill_key", resolved.drill.key)
    .eq("attempt_number", attemptNumber);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}
