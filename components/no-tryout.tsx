"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateForm } from "@/app/account/create-tryout-form";

/**
 * What Home, Players and Selected show when the org has no tryout class.
 *
 * The same panel on all three, deliberately. A brand-new club lands on an
 * empty app and every tab said something different and equally useless
 * ("No active tryout", "No prospects yet"), none of which told them the one
 * thing they needed to do first. Now every tab asks the same question and
 * offers the form right there.
 *
 * Admins get the form. Everyone else gets told who can create one — an
 * evaluator staring at a button that would fail the RLS policy is worse
 * than an evaluator who knows to go ask.
 */
export function NoTryout({
  isAdmin,
  orgName,
}: {
  isAdmin: boolean;
  orgName: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <section className="bb-card mt-8 rounded-lg border border-border bg-card p-5">
      <h2 className="text-xl text-foreground uppercase">
        Start your first class
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {orgName} has no tryout class yet. A class is one cycle — a name, a
        year and a semester. Every athlete, rating and drill result hangs off
        it, which is how past seasons stay intact when you start the next one.
      </p>

      {!isAdmin ? (
        <p className="mt-4 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
          An admin or the owner needs to create it. Once one exists, this
          screen fills in on its own.
        </p>
      ) : creating ? (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-tap-large mt-4 w-full rounded-lg bg-primary px-6 text-base
                     font-bold tracking-wide text-primary-foreground active:opacity-80"
        >
          + Create a tryout class
        </button>
      )}
    </section>
  );
}
