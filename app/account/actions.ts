"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { validateRoster, type RowError } from "@/lib/csv/roster";

export type ImportResult =
  | { ok: true; inserted: number; skippedBlank: number }
  | { ok: false; errors: RowError[] };

/**
 * SPEC.md section 12. Admin only, all-or-nothing.
 *
 * The client already validated with papaparse; this validates again. Client
 * validation is there to give a fast, readable error, not to be trusted -
 * a server action is a public endpoint.
 *
 * Note the admin check lives here rather than in RLS. The prospects policies
 * deliberately let any officer insert, because roster management is
 * collaborative (SPEC.md section 5). It is the bulk CSV path specifically
 * that is admin-only, so that restriction belongs at this layer.
 */
export async function importRoster(
  records: Record<string, unknown>[],
  headers: string[],
): Promise<ImportResult> {
  const { officer } = await getOfficer();
  if (!officer) {
    return { ok: false, errors: [{ line: 0, message: "Not signed in." }] };
  }
  if (!officer.is_admin) {
    return {
      ok: false,
      errors: [{ line: 0, message: "Only an admin can import a roster." }],
    };
  }

  const supabase = await createClient();

  const { data: tryout } = await supabase
    .from("tryouts")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!tryout) {
    return {
      ok: false,
      errors: [{ line: 0, message: "There is no active tryout to import into." }],
    };
  }

  // Re-read the taken jerseys now rather than trusting what the client saw.
  // Between the user picking the file and submitting, someone else may have
  // added a prospect.
  const { data: existing } = await supabase
    .from("prospects")
    .select("jersey_number")
    .eq("tryout_id", tryout.id);

  const takenJerseys = new Set((existing ?? []).map((p) => p.jersey_number));

  const result = validateRoster(records, headers, takenJerseys);
  if (!result.ok) return { ok: false, errors: result.errors };

  // One statement, so Postgres makes it atomic. The unique constraint on
  // (tryout_id, jersey_number) is the last line of defence if two admins
  // import overlapping files at the same moment - the whole insert fails
  // rather than landing half a roster.
  const { error } = await supabase.from("prospects").insert(
    result.rows.map((r) => ({
      tryout_id: tryout.id,
      jersey_number: r.jersey_number,
      first_name: r.first_name,
      last_name: r.last_name,
      primary_position: r.primary_position,
      secondary_positions: [],
    })),
  );

  if (error) {
    const duplicate = error.code === "23505";
    return {
      ok: false,
      errors: [
        {
          line: 0,
          message: duplicate
            ? "A jersey number in this file was taken while you were importing. Nothing was imported. Re-check the file and try again."
            : `Import failed, nothing was saved: ${error.message}`,
        },
      ],
    };
  }

  revalidatePath("/players");
  revalidatePath("/");
  return {
    ok: true,
    inserted: result.rows.length,
    skippedBlank: result.skippedBlank,
  };
}
