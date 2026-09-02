import { createClient } from "@/lib/supabase/server";
import type { Comment } from "@/lib/comments";

export type { Comment };

/**
 * Comments on one prospect - SPEC.md section 10.3.
 *
 * Returned oldest first, because the list reads newest at the bottom like a
 * chat thread. The index is (prospect_id, created_at desc), which serves this
 * ordering equally well - Postgres reads an index backwards without penalty.
 */
export async function getComments(prospectId: string): Promise<Comment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("comments")
    .select("id, officer_id, body, created_at, profiles(display_name)")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((c) => {
    const officer = c.profiles as unknown as { display_name: string } | null;
    return {
      id: c.id,
      officerId: c.officer_id,
      officerName: officer?.display_name ?? "Unknown officer",
      body: c.body,
      createdAt: c.created_at,
    };
  });
}
