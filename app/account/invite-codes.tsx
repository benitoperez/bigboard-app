"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/org";
import type { InviteCode } from "@/lib/data/org";
import { rotateInviteCode } from "./org-actions";

/**
 * Invite codes — SPEC-V2.md section 2.3.
 *
 * Two codes, one per joinable role, shown big because they get read aloud
 * across a field. There is no admin code: `invite_codes.role` is CHECKed to
 * evaluator or viewer, so admin is reachable only by promotion.
 */
export function InviteCodes({ codes }: { codes: InviteCode[] }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="mt-4">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Invite Codes
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The code decides the role of whoever uses it. Admins are promoted from
        the members list, never invited by code.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {codes.map((c) => (
          <CodeRow key={c.role} code={c} onError={setError} />
        ))}
      </div>
    </section>
  );
}

function CodeRow({
  code,
  onError,
}: {
  code: InviteCode;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is refused in some mobile contexts. The code is
      // already on screen and selectable, so this is not worth an error.
    }
  }

  function rotate() {
    onError(null);
    startTransition(async () => {
      const res = await rotateInviteCode(code.role);
      if (!res.ok) onError(res.error);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="bb-card rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            {ROLE_LABELS[code.role]}
          </p>
          <p className="tnum mt-1 text-2xl font-bold tracking-[0.15em] text-foreground">
            {code.code}
          </p>
        </div>

        <button
          type="button"
          onClick={copy}
          className="min-h-tap shrink-0 rounded-md border border-border px-3 text-xs
                     font-semibold text-muted-foreground active:bg-secondary"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {confirming ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-foreground">
            Rotate this code? The old one stops working immediately. Everyone
            who already joined stays a member.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={rotate}
              disabled={pending}
              className="min-h-tap rounded-md border border-destructive/40 px-3 text-xs
                         font-semibold text-destructive active:bg-destructive/10 disabled:opacity-50"
            >
              {pending ? "Rotating..." : "Rotate"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-tap rounded-md border border-border px-3 text-xs
                         font-semibold text-muted-foreground active:bg-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 min-h-tap text-xs font-semibold text-muted-foreground"
        >
          Rotate code
        </button>
      )}
    </div>
  );
}
