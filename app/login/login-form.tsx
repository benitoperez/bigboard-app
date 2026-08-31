"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <label
          htmlFor="email"
          className="text-sm font-semibold text-muted-foreground"
        >
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
          className="min-h-tap rounded-md border border-border bg-input px-4 text-base
                     text-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="password"
          className="text-sm font-semibold text-muted-foreground"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="min-h-tap rounded-md border border-border bg-input px-4 text-base
                     text-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
        />
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
        {pending ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
