"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Membership, type Role } from "@/lib/org";
import { switchOrg } from "@/app/onboarding/actions";
import { deleteOrg, leaveOrg, renameOrg } from "./org-actions";

/**
 * Org identity, switching, and the leave/rename controls — SPEC-V2.md §5.
 *
 * Everyone sees the org name, the switcher (when they belong to more than
 * one), and Leave. Rename is admin+. Delete is owner-only and lives in the
 * owner section below.
 */
export function OrgPanel({
  activeOrg,
  memberships,
  role,
  isAdmin,
}: {
  activeOrg: Membership;
  memberships: Membership[];
  role: Role;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(activeOrg.orgName);
  const [leaving, setLeaving] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That did not work.");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return (
    <section className="mt-4 bb-card rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Organization
      </h2>

      {renaming ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={pending}
            aria-label="Organization name"
            className="min-h-tap rounded-md border border-border bg-input px-3 text-base
                       text-foreground outline-none focus-visible:border-primary
                       disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => renameOrg(name), () => setRenaming(false))}
              className="min-h-tap rounded-md bg-primary px-4 text-sm font-bold
                         text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setName(activeOrg.orgName);
                setRenaming(false);
              }}
              className="min-h-tap rounded-md border border-border px-4 text-sm
                         font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-lg font-semibold text-foreground">
            {activeOrg.orgName}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="min-h-tap shrink-0 text-xs font-semibold text-muted-foreground"
            >
              Rename
            </button>
          )}
        </div>
      )}

      {/* Only worth showing to someone who actually belongs to several. */}
      {memberships.length > 1 && (
        <div className="mt-3">
          <label
            htmlFor="org-switch"
            className="text-xs font-semibold text-muted-foreground"
          >
            Switch organization
          </label>
          <select
            id="org-switch"
            value={activeOrg.orgId}
            disabled={pending}
            onChange={(e) => run(() => switchOrg(e.target.value))}
            className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                       text-base text-foreground outline-none focus-visible:border-primary
                       disabled:opacity-50"
          >
            {memberships.map((m) => (
              <option key={m.orgId} value={m.orgId}>
                {m.orgName} — {ROLE_LABELS[m.role]}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {error}
        </p>
      )}

      {/* The owner cannot leave. Saying why beats a disabled button. */}
      <div className="mt-3 border-t border-border pt-3">
        {role === "owner" ? (
          <p className="text-xs text-muted-foreground">
            As owner you cannot leave. Transfer ownership to someone else
            first.
          </p>
        ) : leaving ? (
          <div>
            <p className="text-xs text-foreground">
              Leave {activeOrg.orgName}? Your ratings and comments stay with
              the club. You would need a new invite code to come back.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => leaveOrg())}
                className="min-h-tap rounded-md border border-destructive/40 px-3 text-xs
                           font-semibold text-destructive active:bg-destructive/10 disabled:opacity-50"
              >
                {pending ? "Leaving..." : "Leave"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setLeaving(false)}
                className="min-h-tap rounded-md border border-border px-3 text-xs
                           font-semibold text-muted-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLeaving(true)}
            className="min-h-tap text-xs font-semibold text-muted-foreground"
          >
            Leave this organization
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Owner-only destruction — SPEC-V2.md section 5.
 *
 * Deleting an org cascades away every tryout, prospect, rating, drill
 * result, selection, comment and headshot it ever held. Typing the name is
 * the gate, and the RPC re-checks ownership regardless.
 */
export function DeleteOrgPanel({ orgName }: { orgName: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim() === orgName;

  return (
    <section className="bb-card mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-destructive uppercase">
        Danger Zone
      </h2>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-tap mt-2 text-sm font-semibold text-destructive"
        >
          Delete this organization
        </button>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-foreground">
            This deletes <strong>{orgName}</strong> and everything in it:
            every tryout class, athlete, rating, drill result, selection,
            comment and headshot. It cannot be undone.
          </p>
          <label htmlFor="del-confirm" className="mt-3 block text-xs text-muted-foreground">
            Type the organization name to confirm
          </label>
          <input
            id="del-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={pending}
            placeholder={orgName}
            className="min-h-tap mt-1 w-full rounded-md border border-border bg-input px-3
                       text-base text-foreground outline-none focus-visible:border-destructive
                       disabled:opacity-50"
          />

          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!matches || pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await deleteOrg(typed);
                  // Success redirects; only a failure returns here.
                  if (!res.ok) setError(res.error);
                });
              }}
              className="min-h-tap rounded-md bg-destructive px-4 text-sm font-bold
                         text-destructive-foreground disabled:opacity-40"
            >
              {pending ? "Deleting..." : "Delete forever"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              className="min-h-tap rounded-md border border-border px-4 text-sm
                         font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
