"use server";

import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getProspects } from "@/lib/data/prospects";
import { getSelectedIds } from "@/lib/data/selections";
import {
  buildCsv,
  exportFilename,
  type ExportProspect,
} from "@/lib/csv/export";

export type ExportResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

/**
 * Wide-format CSV of the active tryout — SPEC-V2.md section 10c.
 *
 * ADMIN+, unlike import. A full export is every rating every officer has
 * given, in a file that leaves the app — a different kind of disclosure from
 * adding athletes, which is why the two features sit on opposite sides of
 * the admin line.
 *
 * The CSV is built on the server and returned as a string for the browser to
 * save. It could be a route handler instead; an action keeps the auth check
 * in the same shape as every other write in the app, and a tryout roster is
 * far too small for streaming to matter.
 *
 * @param scope "all" for the whole class, "selected" for the shared team
 *   list only.
 */
export async function exportRoster(
  scope: "all" | "selected",
): Promise<ExportResult> {
  const { is_admin, activeOrg } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_admin) {
    return { ok: false, error: "Only admins can export." };
  }

  const tryout = await getActiveTryout();
  if (!tryout) return { ok: false, error: "There is no active tryout class." };

  const [{ template, prospects }, selectedIds] = await Promise.all([
    getProspects(tryout.id),
    getSelectedIds(tryout.id),
  ]);

  if (!template) {
    return { ok: false, error: "This tryout has no evaluation template." };
  }

  const included =
    scope === "selected"
      ? prospects.filter((p) => selectedIds.has(p.id))
      : prospects;

  if (included.length === 0) {
    return {
      ok: false,
      error:
        scope === "selected"
          ? "Nobody is on the team list yet."
          : "This class has no athletes yet.",
    };
  }

  // Individual attempts, which ProspectRow does not carry - every screen
  // shows best and average, but an export has to round-trip through an
  // import, and that reads attempts.
  const supabase = await createClient();
  const { data: attemptRows } = await supabase
    .from("drill_results")
    .select("prospect_id, drill_key, attempt_number, value")
    .in(
      "prospect_id",
      included.map((p) => p.id),
    );

  const attemptsByProspect = new Map<string, Record<string, (number | null)[]>>();
  for (const row of attemptRows ?? []) {
    const forProspect = attemptsByProspect.get(row.prospect_id) ?? {};
    const list = forProspect[row.drill_key] ?? [];
    // attempt_number is 1-based; the array is positional, so a recorded
    // attempt 2 with no attempt 1 leaves a hole rather than shifting up.
    list[row.attempt_number - 1] = Number(row.value);
    forProspect[row.drill_key] = list;
    attemptsByProspect.set(row.prospect_id, forProspect);
  }

  const rows: ExportProspect[] = included.map((p) => ({
    ...p,
    attempts: attemptsByProspect.get(p.id) ?? {},
  }));

  return {
    ok: true,
    filename: exportFilename(
      activeOrg.orgName,
      tryout.name,
      scope === "selected" ? "selected" : undefined,
    ),
    csv: buildCsv(template, rows, selectedIds),
    rows: rows.length,
  };
}
