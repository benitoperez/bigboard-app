"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { ACTIVE_ORG_COOKIE, isRole } from "@/lib/org";

export type OrgResult = { ok: true } | { ok: false; error: string };

/**
 * Org and membership management — SPEC-V2.md sections 2.6 and 5.
 *
 * Every one of these calls a security definer RPC rather than writing to
 * `memberships` directly. The invariants involved are cross-row rules that
 * RLS cannot express cleanly: exactly one owner, admins may not touch other
 * admins, nobody edits their own role, the owner cannot leave. Putting them
 * in the database means they hold no matter which client calls.
 *
 * The role checks here are a courtesy that produces a readable message. The
 * RPC re-checks everything and trusts nothing from this layer.
 */

/** Rotate one invite code. The old string stops working immediately. */
export async function rotateInviteCode(role: string): Promise<OrgResult> {
  const { activeOrg, is_admin } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_admin) return { ok: false, error: "Only admins can rotate invite codes." };
  if (role !== "evaluator" && role !== "viewer") {
    return { ok: false, error: "Unknown code type." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("rotate_invite_code", {
    p_org: activeOrg.orgId,
    p_role: role,
  });

  if (error) return { ok: false, error: error.message };

  // Rotating stops NEW joins and never removes existing members - membership
  // is a separate table, so nobody is disturbed by this.
  revalidatePath("/account");
  return { ok: true };
}

/**
 * Promote or demote a member.
 *
 * Admin may move people between evaluator and viewer. Granting or revoking
 * ADMIN is owner-only, which is the rule that keeps "admin by promotion
 * only, never by invite code" true from both directions.
 */
export async function setMemberRole(
  memberId: string,
  newRole: string,
): Promise<OrgResult> {
  const { activeOrg, is_admin } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_admin) return { ok: false, error: "Only admins can change roles." };
  if (!isRole(newRole) || newRole === "owner") {
    return { ok: false, error: "Ownership is transferred, not assigned." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_org: activeOrg.orgId,
    p_member: memberId,
    p_new_role: newRole,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/account");
  return { ok: true };
}

/** Remove someone from the org. Their ratings and comments stay. */
export async function removeMember(memberId: string): Promise<OrgResult> {
  const { activeOrg, is_admin } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_admin) return { ok: false, error: "Only admins can remove members." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_org: activeOrg.orgId,
    p_member: memberId,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/account");
  return { ok: true };
}

/**
 * Hand the org to someone else.
 *
 * One transaction, ordered so the one-owner-per-org index never trips: the
 * current owner is demoted to admin before the new one is promoted. The
 * caller ends up an admin of an org they no longer own, which is the point -
 * this is not a way to leave quietly.
 */
export async function transferOwnership(memberId: string): Promise<OrgResult> {
  const { activeOrg, role } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (role !== "owner") {
    return { ok: false, error: "Only the owner can transfer ownership." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    p_org: activeOrg.orgId,
    p_new_owner: memberId,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Leave the org yourself.
 *
 * Refused for the owner: an org with no owner cannot be repaired through the
 * app, because every owner-only path requires an owner to exist. They
 * transfer first.
 */
export async function leaveOrg(): Promise<OrgResult> {
  const { userId, activeOrg, role } = await getOfficer();
  if (!userId || !activeOrg) return { ok: false, error: "No active organization." };
  if (role === "owner") {
    return {
      ok: false,
      error: "Transfer ownership to someone else before leaving.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_org: activeOrg.orgId,
    p_member: userId,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  // The remembered org is gone; clear it so the next read falls through to
  // whatever else they belong to, or to onboarding.
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Rename the org. Admin and up. */
export async function renameOrg(name: string): Promise<OrgResult> {
  const { activeOrg, is_admin } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_admin) return { ok: false, error: "Only admins can rename the organization." };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "The name cannot be empty." };
  if (trimmed.length > 80) return { ok: false, error: "That name is too long." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("orgs")
    .update({ name: trimmed })
    .eq("id", activeOrg.orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Delete the org and everything in it. Owner only.
 *
 * This cascades away every tryout, prospect, rating, drill result,
 * selection, comment and headshot the club ever recorded — years of it. The
 * UI demands the org name typed exactly, and the RPC re-checks ownership.
 */
export async function deleteOrg(confirmation: string): Promise<OrgResult> {
  const { activeOrg, role } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (role !== "owner") {
    return { ok: false, error: "Only the owner can delete the organization." };
  }
  if (confirmation.trim() !== activeOrg.orgName) {
    return { ok: false, error: "The name did not match. Nothing was deleted." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_org", { p_org: activeOrg.orgId });

  if (error) return { ok: false, error: friendly(error.message) };

  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  revalidatePath("/", "layout");
  redirect("/onboarding");
}

/**
 * The RPCs raise plain Postgres exceptions. Their text is already written
 * for a person, so it is passed through where it is useful and softened
 * where the raw message would read as a database error.
 */
function friendly(message: string): string {
  if (/only the owner may/i.test(message)) return message;
  if (/cannot change your own role/i.test(message)) {
    return "You cannot change your own role.";
  }
  if (/owner cannot be removed|must transfer ownership/i.test(message)) {
    return "The owner cannot be removed. Transfer ownership first.";
  }
  if (/not a member/i.test(message)) {
    return "That person is no longer a member.";
  }
  if (/not authorized/i.test(message)) {
    return "You do not have permission to do that.";
  }
  return message;
}
