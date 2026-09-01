"use client";

import { useActionState } from "react";
import { resendConfirmation, type SignupState } from "@/app/signup/actions";

const initialState: SignupState = { error: null };

export function ResendForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState,
  );

  // A null error after a submit means it went out. useActionState hands back
  // the initial state before the first submit, so `pending` having been true
  // is what separates "sent" from "not tried yet" — tracked by the action
  // returning the same shape either way.
  const sent = state === initialState ? false : state.error === null;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <label htmlFor="resend-email" className="text-sm font-semibold text-muted-foreground">
        Send it again
      </label>
      <input
        id="resend-email"
        name="email"
        type="email"
        required
        defaultValue={email ?? ""}
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="email"
        placeholder="you@example.com"
        className="min-h-tap rounded-md border border-border bg-input px-4 text-base
                   text-foreground outline-none
                   focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
      />

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10
                     px-4 py-3 text-sm text-destructive-foreground"
        >
          {state.error}
        </p>
      )}

      {sent && (
        <p role="status" className="text-sm text-primary">
          Sent. Check your inbox again.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-md border border-border px-4 text-sm font-semibold
                   text-foreground active:bg-secondary disabled:opacity-50"
      >
        {pending ? "Sending..." : "Resend confirmation email"}
      </button>
    </form>
  );
}
