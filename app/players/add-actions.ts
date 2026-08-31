"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { POSITIONS, type PositionKey } from "@/lib/config/positions";

export type AddAthleteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Add one athlete by hand.
 *
 * Open to ANY officer, not just admins - this matches the write_prospects
 * policy, which is `with check (true)` because roster management is
 * collaborative (SPEC.md section 5). Someone walks up mid-tryout and is not
 * on the imported sheet; whoever is holding a phone should be able to add
 * him. Deleting stays admin-only, because that is the destructive direction.
 */
export async function addAthlete(input: {
  firstName: string;
  lastName: string;
  jerseyNumber: string;
  primaryPosition: string;
  secondaryPositions: string[];
}): Promise<AddAthleteResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const first = input.firstName.trim();
  const last = input.lastName.trim();
  const jerseyRaw = input.jerseyNumber.trim();

  if (!first) return { ok: false, error: "First name is required." };
  if (!last) return { ok: false, error: "Last name is required." };
  if (!/^\d+$/.test(jerseyRaw)) {
    return { ok: false, error: "Jersey number must be a whole number." };
  }
  const jersey = Number(jerseyRaw);
  if (jersey < 0 || jersey > 999) {
    return { ok: false, error: "Jersey number is out of range." };
  }

  // Positions are checked against POSITIONS, never a list written out here.
  if (!(input.primaryPosition in POSITIONS)) {
    return { ok: false, error: "Pick a primary position." };
  }
  const primary = input.primaryPosition as PositionKey;

  const secondary = [...new Set(input.secondaryPositions)].filter(
    (p): p is PositionKey => p in POSITIONS && p !== primary,
  );

  const supabase = await createClient();

  const { data: tryout } = await supabase
    .from("tryouts")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!tryout) {
    return { ok: false, error: "There is no active tryout to add to." };
  }

  const { data, error } = await supabase
    .from("prospects")
    .insert({
      tryout_id: tryout.id,
      jersey_number: jersey,
      first_name: first,
      last_name: last,
      primary_position: primary,
      secondary_positions: secondary,
    })
    .select("id")
    .single();

  if (error) {
    // The unique constraint on (tryout_id, jersey_number) is the real check.
    // Reading first then inserting would still race two officers adding the
    // same number at once; the constraint cannot be raced.
    if (error.code === "23505") {
      return {
        ok: false,
        error: `Jersey number ${jersey} is already taken in this tryout.`,
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true, id: data.id };
}
