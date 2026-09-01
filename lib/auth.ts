import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_ORG_COOKIE,
  canAdmin,
  canEvaluate,
  isRole,
  type Membership,
  type Role,
} from "@/lib/org";

export type { Membership, Role };

export type Profile = {
  id: string;
  display_name: string;
};

/**
 * Why a caller cannot use the app yet. Each fails differently and each
 * deserves a different screen (SPEC-V2.md section 4).
 */
export type Gate =
  | "ok"
  | "signed-out"      // no session at all
  | "unconfirmed"     // signed up, has not clicked the email link
  | "no-profile"      // auth user exists, profiles row does not
  | "no-org";         // confirmed, but belongs to no org yet

export type Actor = {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  /** Every org this user belongs to, for the switcher. */
  memberships: Membership[];
  /** The org every screen is scoped to. Null when they belong to none. */
  activeOrg: Membership | null;
  /** Role in the ACTIVE org. Null outside one. */
  role: Role | null;
  /**
   * Manages members, codes, templates, tryouts, imports, deletions.
   * True for owner as well as admin — owner is a superset (SPEC-V2 §2.2).
   */
  is_admin: boolean;
  /** Rates, times, selects, comments, adds athletes. False for viewers. */
  is_evaluator: boolean;
  gate: Gate;
};

const SIGNED_OUT: Actor = {
  userId: null,
  email: null,
  profile: null,
  memberships: [],
  activeOrg: null,
  role: null,
  is_admin: false,
  is_evaluator: false,
  gate: "signed-out",
};

/**
 * The signed-in user, their org memberships, and their role in the active
 * org — SPEC-V2.md sections 2 and 4.
 *
 * Four things have to be true, and they fail differently, which is why the
 * gate is reported rather than collapsed into null:
 *
 *   1. A valid Supabase session exists.
 *   2. The email is confirmed. Unconfirmed accounts reach nothing.
 *   3. A `profiles` row exists (normally created by the signup trigger).
 *   4. The user belongs to at least one org.
 *
 * Miss the last and the user authenticates fine but every read comes back
 * empty and every write fails an RLS policy, which reads like a broken app
 * rather than a missing membership. Distinguishing the cases here makes that
 * five seconds to diagnose instead of an hour.
 *
 * v1 note: this replaces the `officers` + `is_admin` model. `is_admin` is
 * kept as a derived field so existing call sites keep reading naturally, but
 * it now means "admin or owner IN THE ACTIVE ORG", not a global flag.
 */
export async function getOfficer(): Promise<Actor> {
  const supabase = await createClient();

  // getClaims() validates the JWT signature; getSession() does not.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = (claims?.sub as string | undefined) ?? null;
  if (!userId) return SIGNED_OUT;

  const email = (claims?.email as string | undefined) ?? null;

  const [{ data: profile }, { data: membershipRows }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", userId).maybeSingle(),
    // RLS restricts this to the caller's own rows, so no filter is needed
    // for correctness — it is here to keep the payload small and the intent
    // obvious to the next reader.
    supabase
      .from("memberships")
      .select("org_id, role, orgs(name)")
      .eq("user_id", userId),
  ]);

  const memberships: Membership[] = (membershipRows ?? []).flatMap((m) => {
    if (!isRole(m.role)) return [];
    const org = m.orgs as unknown as { name: string } | null;
    return [{ orgId: m.org_id, orgName: org?.name ?? "Unnamed org", role: m.role }];
  });
  memberships.sort((a, b) => a.orgName.localeCompare(b.orgName));

  // The remembered org, falling back to the first. A stale cookie — an org
  // the user was removed from, or one that was deleted — must not strand
  // them on a blank app, so it is validated against the live list rather
  // than trusted.
  const cookieStore = await cookies();
  const remembered = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const activeOrg =
    memberships.find((m) => m.orgId === remembered) ?? memberships[0] ?? null;

  const role = activeOrg?.role ?? null;

  let gate: Gate = "ok";
  if (!(await emailIsConfirmed(supabase, claims))) gate = "unconfirmed";
  else if (!profile) gate = "no-profile";
  else if (!activeOrg) gate = "no-org";

  return {
    userId,
    email,
    profile: profile ?? null,
    memberships,
    activeOrg,
    role,
    is_admin: canAdmin(role),
    is_evaluator: canEvaluate(role),
    gate,
  };
}

/**
 * Whether the account's email is confirmed.
 *
 * Supabase does not put a confirmation flag in the JWT reliably across
 * versions, so a claim is used when one is present and getUser() answers
 * otherwise. getUser() is a round trip to the auth server, which is why it
 * is not the first choice — but guessing "confirmed" from a missing claim
 * would let unconfirmed accounts through the one gate that exists to stop
 * them.
 */
async function emailIsConfirmed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claims: Record<string, unknown> | undefined,
): Promise<boolean> {
  const claimed =
    claims?.email_verified ??
    (claims?.user_metadata as Record<string, unknown> | undefined)?.email_verified;
  if (typeof claimed === "boolean") return claimed;

  const { data } = await supabase.auth.getUser();
  return data.user?.email_confirmed_at != null;
}

/**
 * Guard for a page that requires a usable session in an org.
 *
 * Redirects to the screen that matches the failure rather than bouncing
 * everything to /login, so a user who has signed up but not confirmed sees
 * "check your inbox" instead of a login form they will just fill in again.
 *
 * Route protection lives in proxy.ts for the signed-out case; this covers
 * the states the proxy cannot see without a database read on every request.
 */
export async function requireOrg(): Promise<Actor> {
  const actor = await getOfficer();

  switch (actor.gate) {
    case "signed-out":
      redirect("/login");
    case "unconfirmed":
      redirect("/confirm-email");
    case "no-profile":
    case "no-org":
      redirect("/onboarding");
    default:
      return actor;
  }
}
