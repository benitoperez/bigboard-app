"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getTemplateForTryout } from "@/lib/data/template";
import { isPositionCode } from "@/lib/template";

/**
 * SPEC.md section 10.3: the plus button adds a position, and adding one
 * immediately reveals that position's attributes on the rating form.
 *
 * Ratings already recorded are untouched - attributes are shared across
 * positions, so a prospect who picks up DB keeps the quickness rating he
 * already had as a WR.
 */
export async function addSecondaryPosition(
  prospectId: string,
  position: string,
): Promise<{ ok: boolean; error?: string }> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: p } = await supabase
    .from("prospects")
    .select("tryout_id, primary_position, secondary_positions")
    .eq("id", prospectId)
    .maybeSingle();

  if (!p) return { ok: false, error: "Prospect not found." };

  // Checked against this tryout's own template. A code the template does not
  // define would leave the prospect rated on attributes that do not exist.
  const template = await getTemplateForTryout(p.tryout_id);
  if (!template || !isPositionCode(template, position)) {
    return { ok: false, error: "Unknown position." };
  }
  const pos = position;
  if (p.primary_position === pos) {
    return { ok: false, error: "Already their primary position." };
  }

  const current: string[] = p.secondary_positions ?? [];
  if (current.includes(pos)) return { ok: true };

  const { error } = await supabase
    .from("prospects")
    .update({ secondary_positions: [...current, pos] })
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  return { ok: true };
}

export async function removeSecondaryPosition(
  prospectId: string,
  position: string,
): Promise<{ ok: boolean; error?: string }> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data: p } = await supabase
    .from("prospects")
    .select("secondary_positions")
    .eq("id", prospectId)
    .maybeSingle();

  if (!p) return { ok: false, error: "Prospect not found." };

  const next = (p.secondary_positions ?? []).filter(
    (s: string) => s !== position,
  );

  const { error } = await supabase
    .from("prospects")
    .update({ secondary_positions: next })
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  return { ok: true };
}
