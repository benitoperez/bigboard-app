"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { validateRoster, type RowError } from "@/lib/csv/roster";
import { getTemplateForTryout } from "@/lib/data/template";

export type ImportResult =
  | {
      ok: true;
      inserted: number;
      importedTimes: number;
      importedSelections: number;
      skippedBlank: number;
    }
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

  const template = await getTemplateForTryout(tryout.id);
  if (!template) {
    return {
      ok: false,
      errors: [{ line: 0, message: "This tryout has no evaluation template." }],
    };
  }

  const result = validateRoster(records, headers, takenJerseys, template);
  if (!result.ok) return { ok: false, errors: result.errors };

  // One statement, so Postgres makes it atomic. The unique constraint on
  // (tryout_id, jersey_number) is the last line of defence if two admins
  // import overlapping files at the same moment - the whole insert fails
  // rather than landing half a roster.
  const { data: inserted, error } = await supabase
    .from("prospects")
    .insert(
      result.rows.map((r) => ({
        tryout_id: tryout.id,
        jersey_number: r.jersey_number,
        first_name: r.first_name,
        last_name: r.last_name,
        primary_position: r.primary_position,
        secondary_positions: r.secondary_positions,
      })),
    )
    .select("id, jersey_number");

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

  // --- optional drill results --------------------------------------------
  // Prospects and drill_results cannot share one statement, so the two
  // inserts cannot be one transaction from here. If the times fail, the
  // prospects just inserted are removed again, which restores the state the
  // admin started from. Without that, a failure here would leave a roster
  // imported but silently missing the times the file carried - exactly the
  // half-done outcome section 12 exists to prevent.
  const idByJersey = new Map((inserted ?? []).map((p) => [p.jersey_number, p.id]));
  const drillRows = result.rows.flatMap((r) => {
    const prospectId = idByJersey.get(r.jersey_number);
    if (!prospectId) return [];
    return Object.entries(r.drills).flatMap(([drillKey, attempts]) =>
      attempts.flatMap((value, i) =>
        value === null
          ? []
          : [
              {
                prospect_id: prospectId,
                drill_key: drillKey,
                attempt_number: i + 1,
                value,
                recorded_by: officer.id,
              },
            ],
      ),
    );
  });

  const selectionRows = result.rows.flatMap((r) => {
    const prospectId = idByJersey.get(r.jersey_number);
    if (!r.selected || !prospectId) return [];
    return [
      {
        tryout_id: tryout.id,
        prospect_id: prospectId,
        selected_by: officer.id,
      },
    ];
  });

  /**
   * Undo the prospects just inserted. drill_results and selections both
   * cascade from prospects, so this one delete unwinds the whole import and
   * restores the state the admin started from.
   */
  async function rollback(reason: string): Promise<ImportResult> {
    await supabase
      .from("prospects")
      .delete()
      .in("id", (inserted ?? []).map((p) => p.id));
    return {
      ok: false,
      errors: [
        {
          line: 0,
          message: `${reason} The whole import was rolled back and nothing was saved.`,
        },
      ],
    };
  }

  let importedTimes = 0;
  if (drillRows.length > 0) {
    const { error: drillErr } = await supabase
      .from("drill_results")
      .insert(drillRows);
    if (drillErr) {
      return rollback(`The 40 times failed to save (${drillErr.message}).`);
    }
    importedTimes = drillRows.length;
  }

  let importedSelections = 0;
  if (selectionRows.length > 0) {
    const { error: selErr } = await supabase
      .from("selections")
      .insert(selectionRows);
    if (selErr) {
      return rollback(`The team list failed to save (${selErr.message}).`);
    }
    importedSelections = selectionRows.length;
  }

  revalidatePath("/players");
  revalidatePath("/selected");
  revalidatePath("/");
  return {
    ok: true,
    inserted: result.rows.length,
    importedTimes,
    importedSelections,
    skippedBlank: result.skippedBlank,
  };
}

export type DeleteAllResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

/**
 * Delete every prospect in the active tryout.
 *
 * ADMIN ONLY, enforced here and by the delete_prospects RLS policy. This is
 * the most destructive action in the app: it cascades through every rating,
 * 40 time, selection, and comment in the tryout. It exists because clearing
 * a test roster one prospect at a time is not workable, but it is guarded by
 * a typed confirmation rather than a single tap.
 */
export async function deleteAllProspects(
  confirmation: string,
): Promise<DeleteAllResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };
  if (!officer.is_admin) {
    return { ok: false, error: "Only an admin can clear the roster." };
  }
  // Checked on the server too, so the guard is not just a client convenience.
  if (confirmation.trim().toUpperCase() !== "DELETE") {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }

  const supabase = await createClient();

  const { data: tryout } = await supabase
    .from("tryouts")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!tryout) return { ok: false, error: "No active tryout." };

  // Storage sits outside the database cascade, so headshots are removed
  // explicitly or they are orphaned in the bucket forever.
  const { data: withPhotos } = await supabase
    .from("prospects")
    .select("headshot_url")
    .eq("tryout_id", tryout.id)
    .not("headshot_url", "is", null);

  const paths = (withPhotos ?? [])
    .map((p) => p.headshot_url)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await supabase.storage.from("headshots").remove(paths);
  }

  const { data: deleted, error } = await supabase
    .from("prospects")
    .delete()
    .eq("tryout_id", tryout.id)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/players");
  revalidatePath("/selected");
  revalidatePath("/");
  revalidatePath("/account");
  return { ok: true, deleted: deleted?.length ?? 0 };
}
