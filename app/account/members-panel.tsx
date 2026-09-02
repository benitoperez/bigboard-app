"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ROLE_LABELS,
  canManageMember,
  isOwner,
  type Role,
} from "@/lib/org";
import type { Member } from "@/lib/data/org";
import {
  removeMember,
  setMemberRole,
  transferOwnership,
} from "./org-actions";

/**
 * The members list — SPEC-V2.md section 5.
 *
 * Everyone can see who is in the org and at what role; only admin and up get
 * the controls. What each control offers is decided by canManageMember, so
 * the UI cannot present an action the RPC would refuse: an admin sees no
 * controls at all beside another admin or the owner.
 */
export function MembersPanel({
  members,
  myRole,
  myUserId,
}: {
  members: Member[];
  myRole: Role;
  myUserId: string;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          Members
        </h2>
        <span className="tnum text-xs text-muted-foreground">
          {members.length}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {error}
        </p>
      )}

      <ul className="mt-2 divide-y divide-border overflow-hidden bb-card rounded-lg border border-border bg-card">
        {members.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            myRole={myRole}
            isSelf={m.userId === myUserId}
            onError={setError}
          />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  member,
  myRole,
  isSelf,
  onError,
}: {
  member: Member;
  myRole: Role;
  isSelf: boolean;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<null | "remove" | "transfer">(null);

  // Nobody edits their own role, and the matrix in lib/org.ts decides the
  // rest. Owner rows and fellow-admin rows are read-only to an admin.
  const manageable = !isSelf && canManageMember(myRole, member.role);
  const canTransferTo = isOwner(myRole) && !isSelf && member.role !== "owner";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) onError(res.error ?? "That did not work.");
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">
            {member.displayName}
            {isSelf && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                you
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {ROLE_LABELS[member.role]}
          </p>
        </div>

        {manageable && (
          <select
            aria-label={`Role for ${member.displayName}`}
            value={member.role}
            disabled={pending}
            onChange={(e) => run(() => setMemberRole(member.userId, e.target.value))}
            className="min-h-tap shrink-0 rounded-md border border-border bg-input px-2
                       text-sm text-foreground outline-none focus-visible:border-primary
                       disabled:opacity-50"
          >
            <option value="viewer">Viewer</option>
            <option value="evaluator">Evaluator</option>
            {/* Only the owner may grant admin. An admin never sees this. */}
            {isOwner(myRole) && <option value="admin">Admin</option>}
          </select>
        )}
      </div>

      {(manageable || canTransferTo) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {manageable &&
            (confirming === "remove" ? (
              <ConfirmPair
                label={`Remove ${member.displayName}?`}
                pending={pending}
                onCancel={() => setConfirming(null)}
                onConfirm={() => run(() => removeMember(member.userId))}
              />
            ) : (
              <SmallButton onClick={() => setConfirming("remove")} disabled={pending}>
                Remove
              </SmallButton>
            ))}

          {canTransferTo &&
            (confirming === "transfer" ? (
              <ConfirmPair
                label={`Make ${member.displayName} the owner? You become an admin.`}
                pending={pending}
                onCancel={() => setConfirming(null)}
                onConfirm={() => run(() => transferOwnership(member.userId))}
              />
            ) : (
              <SmallButton onClick={() => setConfirming("transfer")} disabled={pending}>
                Make owner
              </SmallButton>
            ))}
        </div>
      )}
    </li>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "min-h-tap rounded-md border px-3 text-xs font-semibold disabled:opacity-50 " +
        (destructive
          ? "border-destructive/40 text-destructive active:bg-destructive/10"
          : "border-border text-muted-foreground active:bg-secondary")
      }
    >
      {children}
    </button>
  );
}

function ConfirmPair({
  label,
  pending,
  onCancel,
  onConfirm,
}: {
  label: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-foreground">{label}</p>
      <div className="flex gap-2">
        <SmallButton onClick={onConfirm} disabled={pending} destructive>
          {pending ? "Working..." : "Yes, do it"}
        </SmallButton>
        <SmallButton onClick={onCancel} disabled={pending}>
          Cancel
        </SmallButton>
      </div>
    </div>
  );
}
