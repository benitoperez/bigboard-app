import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOfficer, type Actor } from "@/lib/auth";

/**
 * The gate every AI route runs before touching Gemini — SPEC-V2.md §6.2.
 *
 * In order, and the order matters:
 *
 *   1. Authenticated and email-confirmed.
 *   2. A member of the org the request names, at a sufficient role.
 *   3. Under both daily caps.
 *
 * Only then does a request leave for Google. Checking the caps last means a
 * stranger cannot burn the global quota, and checking membership before the
 * call means one org can never spend budget describing another org's data.
 */

/**
 * Per-user and global daily caps, in UTC days.
 *
 * Deliberately code constants rather than org-editable settings: they exist
 * to protect the API bill from a runaway loop or a single tenant, and an org
 * that could raise its own cap would not be a cap.
 */
export const PER_USER_DAILY_CAP = 25;
export const GLOBAL_DAILY_CAP = 500;

/** What the user sees when either cap is hit. Both give the same message. */
export const LIMIT_MESSAGE = "AI limit reached — resets tomorrow.";

export type GuardOk = { ok: true; actor: Actor; orgId: string };
export type GuardFail = { ok: false; status: number; error: string };

export async function guardAiRequest(
  orgId: string | undefined,
  need: "evaluator" | "admin",
): Promise<GuardOk | GuardFail> {
  const actor = await getOfficer();

  if (!actor.userId) {
    return { ok: false, status: 401, error: "Sign in first." };
  }
  if (actor.gate === "unconfirmed") {
    return { ok: false, status: 403, error: "Confirm your email address first." };
  }
  if (!actor.activeOrg) {
    return { ok: false, status: 403, error: "You do not belong to an organization." };
  }

  // The request names an org; it must be one the caller is actually in, and
  // it must be the one they are working in. Trusting the body here would let
  // a member of org A spend quota on org B's identity.
  const targetOrg = orgId ?? actor.activeOrg.orgId;
  const membership = actor.memberships.find((m) => m.orgId === targetOrg);
  if (!membership) {
    return { ok: false, status: 403, error: "You are not a member of that organization." };
  }

  const allowed =
    need === "admin"
      ? membership.role === "admin" || membership.role === "owner"
      : membership.role !== "viewer";

  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error:
        need === "admin"
          ? "Only admins can use this."
          : "Your role in this organization is read-only.",
    };
  }

  // Counted through a security definer RPC, not a table read. ai_usage
  // SELECT is admin-only, so an evaluator counting their own calls through
  // RLS would always see zero and the per-user cap would never fire at all;
  // the global figure spans orgs and is unreadable by anyone through RLS.
  const supabase = await createClient();
  const { data } = await supabase.rpc("ai_usage_today");
  const row = (data as { mine: number; total: number }[] | null)?.[0];

  const mine = Number(row?.mine ?? 0);
  const total = Number(row?.total ?? 0);

  // Both caps give the SAME message: which one was hit is not the user's
  // business, and distinguishing them would leak system-wide activity.
  if (mine >= PER_USER_DAILY_CAP || total >= GLOBAL_DAILY_CAP) {
    return { ok: false, status: 429, error: LIMIT_MESSAGE };
  }

  return { ok: true, actor, orgId: targetOrg };
}

/**
 * Record one successful call. Failures do not consume quota — a timeout the
 * user did not get an answer from should not cost them one of 25.
 */
export async function recordAiUsage(
  orgId: string,
  userId: string,
  route: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("ai_usage").insert({
    org_id: orgId,
    user_id: userId,
    route,
  });
}
