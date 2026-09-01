"use client";

import { useActionState } from "react";
import { signUp, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

const FIELD =
  "min-h-tap rounded-md border border-border bg-input px-4 text-base " +
  "text-foreground outline-none " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="display_name" className="text-sm font-semibold text-muted-foreground">
          Your name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          maxLength={60}
          autoComplete="name"
          // This is what shows next to every rating you leave, so it is
          // asked for up front rather than defaulted from the email.
          placeholder="How teammates will see you"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold text-muted-foreground">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-semibold text-muted-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={FIELD}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      {state.error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/40 bg-destructive/10
                     px-4 py-3 text-sm text-destructive-foreground"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap-large mt-2 rounded-lg bg-primary px-6 text-base font-bold
                   tracking-wide text-primary-foreground
                   transition-opacity active:opacity-80 disabled:opacity-50"
      >
        {pending ? "Creating account..." : "Create Account"}
      </button>
    </form>
  );
}
