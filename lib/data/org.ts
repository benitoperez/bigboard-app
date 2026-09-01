import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/org";

/**
 * Org membership and invite code reads — SPEC-V2.md sections 2 and 5.
 *
 * SERVER ONLY (Supabase server client → next/headers). Client components
 * take the types from lib/org.ts.
 *
 * Everything here is RLS-scoped: `memberships` is readable by members of the
 * org, `invite_codes` only by admin and owner. A viewer calling
 * getInviteCodes gets an empty list from the database, not a filtered one
 * from this file — the policy is the enforcement, not the caller.
 */

export type Member = {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
};

export type InviteCode = {
  role: Extract<Role, "evaluator" | "viewer">;
  code: string;
  rotatedAt: string;
};

/** Everyone in the org, owner first, then admins, then by name. */
export async function getMembers(orgId: string): Promise<Member[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("memberships")
    .select("user_id, role, created_at, profiles(display_name)")
    .eq("org_id", orgId);

  const members: Member[] = (data ?? []).flatMap((m) => {
    if (!isRole(m.role)) return [];
    const p = m.profiles as unknown as { display_name: string } | null;
    return [
      {
        userId: m.user_id,
        displayName: p?.display_name ?? "Unknown",
        role: m.role,
        joinedAt: m.created_at,
      },
    ];
  });

  const RANK: Record<Role, number> = { owner: 0, admin: 1, evaluator: 2, viewer: 3 };
  members.sort(
    (a, b) =>
      RANK[a.role] - RANK[b.role] || a.displayName.localeCompare(b.displayName),
  );
  return members;
}

/**
 * The org's live invite codes, one per joinable role.
 *
 * Returns empty for anyone below admin, because the RLS policy on
 * invite_codes restricts SELECT to admin and owner. That is deliberate: a
 * viewer who could read the evaluator code could promote himself by
 * re-joining.
 */
export async function getInviteCodes(orgId: string): Promise<InviteCode[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("invite_codes")
    .select("role, code, rotated_at")
    .eq("org_id", orgId);

  return (data ?? []).flatMap((c) =>
    c.role === "evaluator" || c.role === "viewer"
      ? [{ role: c.role, code: c.code, rotatedAt: c.rotated_at }]
      : [],
  );
}
