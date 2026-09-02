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
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

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
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Viewers are read-only. The RLS policy is what actually enforces this;
  // refusing here turns a silent policy rejection into a clear message.
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

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

/**
 * Promote a secondary position to primary, demoting the current one.
 *
 * The primary is the only position that cannot be removed — it is what
 * guarantees every athlete keeps at least one — so without this, a primary
 * entered wrong at import could never be corrected. A swap rather than a
 * set: the old primary becomes a secondary instead of being discarded, so
 * fixing the order never silently drops a position they were being rated at.
 *
 * The prospect's ratings are untouched. Attributes are shared across
 * positions, and reordering does not change which ones the union covers.
 */
export async function setPrimaryPosition(
  prospectId: string,
  position: string,
): Promise<{ ok: boolean; error?: string }> {
  const { profile, is_evaluator } = await getOfficer();
  if (!profile) return { ok: false, error: "Not signed in." };

  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const supabase = await createClient();
  const { data: p } = await supabase
    .from("prospects")
    .select("tryout_id, primary_position, secondary_positions")
    .eq("id", prospectId)
    .maybeSingle();

  if (!p) return { ok: false, error: "Prospect not found." };
  if (p.primary_position === position) return { ok: true };

  const template = await getTemplateForTryout(p.tryout_id);
  if (!template || !isPositionCode(template, position)) {
    return { ok: false, error: "Unknown position." };
  }

  const current: string[] = p.secondary_positions ?? [];
  if (!current.includes(position)) {
    return { ok: false, error: "They do not play that position yet." };
  }

  const nextSecondary = [
    p.primary_position,
    ...current.filter((s) => s !== position),
  ];

  const { error } = await supabase
    .from("prospects")
    .update({ primary_position: position, secondary_positions: nextSecondary })
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}
