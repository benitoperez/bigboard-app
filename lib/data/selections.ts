import { createClient } from "@/lib/supabase/server";

export type Selection = {
  prospectId: string;
  selectedBy: string;
  selectedByName: string;
  createdAt: string;
};

/**
 * The shared team list - SPEC.md section 10.4.
 *
 * One row per prospect, not per officer: `selections` is unique on
 * (tryout_id, prospect_id). One officer adding a prospect adds him for
 * everyone. selected_by is attribution only, never ownership.
 */
export async function getSelections(tryoutId: string): Promise<Selection[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("selections")
    .select("prospect_id, selected_by, created_at, profiles(display_name)")
    .eq("tryout_id", tryoutId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((s) => {
    const officer = s.profiles as unknown as { display_name: string } | null;
    return {
      prospectId: s.prospect_id,
      selectedBy: s.selected_by,
      selectedByName: officer?.display_name ?? "Unknown officer",
      createdAt: s.created_at,
    };
  });
}

export async function getSelectedIds(tryoutId: string): Promise<Set<string>> {
  const rows = await getSelections(tryoutId);
  return new Set(rows.map((r) => r.prospectId));
}
