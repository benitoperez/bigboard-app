"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { ACTIVE_ORG_COOKIE, normalizeInviteCode } from "@/lib/org";

export type OnboardingState = { error: string | null };

/** Seed templates a new org may start from. Basketball is not one yet. */
const TEMPLATE_SLUGS = ["flag_football", "baseball", "scratch"] as const;
type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];

function isTemplateSlug(v: string): v is TemplateSlug {
  return (TEMPLATE_SLUGS as readonly string[]).includes(v);
}

/** Remember the org the user just landed in, so every screen scopes to it. */
async function setActiveOrg(orgId: string) {
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Create an org and become its owner — SPEC-V2.md sections 2.6 and 4.
 *
 * Everything happens inside the `create_org` RPC: the org, a copy of the
 * chosen seed template, the owner membership, and both invite codes, in one
 * transaction. Doing it in steps from here would leave an org with no owner
 * if the second call failed, and an org with no owner cannot be repaired
 * through the app — the one-owner index and the owner-only RPCs both assume
 * it exists.
 */
export async function createOrg(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const { userId, gate } = await getOfficer();
  if (!userId) return { error: "Sign in first." };
  if (gate === "unconfirmed") {
    return { error: "Confirm your email address before creating an org." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("template") ?? "");

  if (!name) return { error: "Give the organization a name." };
  if (name.length > 80) return { error: "That name is too long." };
  if (!isTemplateSlug(slug)) {
    return { error: "Pick a template to start from." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_org", {
    p_name: name,
    p_template_slug: slug,
  });

  if (error) return { error: error.message };
  if (typeof data !== "string") {
    return { error: "The organization was not created. Try again." };
  }

  await setActiveOrg(data);
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Join an existing org with an invite code — SPEC-V2.md section 2.3.
 *
 * The code carries the role: an EVAL- code lands at evaluator, a VIEW- code
 * at viewer. There is no code that grants admin, and the schema cannot
 * express one — `invite_codes.role` is CHECKed to evaluator or viewer, so
 * admin is reachable only by promotion from the owner.
 *
 * The code is never SELECTed from the client; `join_org` looks it up inside
 * a security definer function, so a stranger cannot enumerate codes.
 */
export async function joinOrg(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const { userId, gate } = await getOfficer();
  if (!userId) return { error: "Sign in first." };
  if (gate === "unconfirmed") {
    return { error: "Confirm your email address before joining an org." };
  }

  const raw = String(formData.get("code") ?? "");
  if (!raw.trim()) return { error: "Enter an invite code." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_org", {
    p_code: normalizeInviteCode(raw),
  });

  if (error) {
    // Both of these are honest and useful, and neither leaks anything: a
    // rotated code is indistinguishable from a wrong one by design.
    if (/already a member/i.test(error.message)) {
      return { error: "You are already a member of that organization." };
    }
    if (/invalid invite code/i.test(error.message)) {
      return {
        error: "That code was not recognized. It may have been rotated — ask for a new one.",
      };
    }
    return { error: error.message };
  }

  if (typeof data !== "string") {
    return { error: "Could not join with that code. Try again." };
  }

  await setActiveOrg(data);
  revalidatePath("/", "layout");
  redirect("/");
}

/** Switch which org the app is scoped to. Used by the Account tab. */
export async function switchOrg(orgId: string): Promise<{ ok: boolean; error?: string }> {
  const { memberships } = await getOfficer();
  // Validated against real memberships, never trusted from the client — the
  // cookie decides what every screen reads.
  if (!memberships.some((m) => m.orgId === orgId)) {
    return { ok: false, error: "You are not a member of that organization." };
  }

  await setActiveOrg(orgId);
  revalidatePath("/", "layout");
  return { ok: true };
}
