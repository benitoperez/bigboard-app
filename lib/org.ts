/**
 * Client-safe org and role types — SPEC-V2.md section 2.
 *
 * Kept apart from lib/auth.ts and lib/data/*, which import the Supabase
 * server client and therefore next/headers. A client component importing a
 * VALUE from those drags server-only code into the browser bundle; types
 * alone are erased, constants and functions are not. This split is the same
 * one lib/tryouts.ts and lib/comments.ts exist for, and verify:imports
 * enforces it.
 */

export const ROLES = ["owner", "admin", "evaluator", "viewer"] as const;

export type Role = (typeof ROLES)[number];

/** Ascending capability. Higher index can do everything below it. */
const RANK: Record<Role, number> = {
  viewer: 0,
  evaluator: 1,
  admin: 2,
  owner: 3,
};

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Read boards and profiles. Every member can do this. */
export function canView(role: Role | null): boolean {
  return role !== null;
}

/**
 * Rate, time, select, comment, and add or edit athletes.
 *
 * Viewers are excluded. Note this is UI convenience only — the RLS policies
 * are what actually enforce it, and hiding a control the database would
 * refuse is a courtesy, never the protection.
 */
export function canEvaluate(role: Role | null): boolean {
  return role !== null && RANK[role] >= RANK.evaluator;
}

/** Manage members and codes, edit the template, import, delete data. */
export function canAdmin(role: Role | null): boolean {
  return role !== null && RANK[role] >= RANK.admin;
}

/** Promote/demote admins, transfer ownership, delete the org. */
export function isOwner(role: Role | null): boolean {
  return role === "owner";
}

/** Can `actor` change or remove a member currently at `target`? */
export function canManageMember(actor: Role | null, target: Role): boolean {
  if (!canAdmin(actor)) return false;
  // Nobody touches the owner, and an admin may not touch another admin —
  // admin is granted and revoked by the owner alone (SPEC-V2 §2.2).
  if (target === "owner") return false;
  if (target === "admin") return isOwner(actor);
  return true;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  evaluator: "Evaluator",
  viewer: "Viewer",
};

export const ROLE_BLURBS: Record<Role, string> = {
  owner: "Full control, including ownership and deleting the org.",
  admin: "Manages members, codes, templates, tryouts and imports.",
  evaluator: "Rates athletes, records drill results, selects and comments.",
  viewer: "Read-only access to boards and profiles.",
};

export type Membership = {
  orgId: string;
  orgName: string;
  role: Role;
};

/** The cookie remembering which org the user is looking at. */
export const ACTIVE_ORG_COOKIE = "bb_active_org";

/**
 * Invite codes are shouted across a field and typed with gloves on, so they
 * are normalized generously before lookup: case, spacing and a missing
 * hyphen all still resolve. The dash is inserted rather than demanded.
 */
export function normalizeInviteCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = cleaned.match(/^(EVAL|VIEW)(.{1,8})$/);
  return match ? `${match[1]}-${match[2]}` : raw.trim().toUpperCase();
}
