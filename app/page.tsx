import { getOfficer } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

/**
 * Placeholder home. The real position boards are build order step 10
 * (SPEC.md section 10.1) - this exists so step 3 is verifiable on its own.
 */
export default async function HomePage() {
  const { userId, officer } = await getOfficer();

  // Authenticated, but no officers row. Every write would fail an
  // `officer_id = auth.uid()` policy from here, so say so plainly instead of
  // letting it surface later as a mystery permissions error.
  if (userId && !officer) {
    return (
      <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6">
        <div className="mx-auto w-full max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h1 className="text-2xl text-foreground">Account not finished</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You are signed in, but there is no officer record for this account
            yet. An admin needs to add a row to <code>officers</code> with your
            user id.
          </p>
          <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
            {userId}
          </p>
          <form action={signOut} className="mt-6">
            <button
              type="submit"
              className="min-h-tap w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground"
            >
              Sign Out
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col px-6 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Signed in
        </p>
        <h1 className="mt-1 text-4xl tracking-tight text-foreground uppercase">
          {officer?.display_name}
        </h1>
        {officer?.is_admin && (
          <span className="mt-2 inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
            Admin
          </span>
        )}
      </header>

      <p className="mt-8 text-sm text-muted-foreground">
        Auth and route protection are wired up. Position boards land in build
        order step 10.
      </p>

      <form action={signOut} className="mt-auto pt-8">
        <button
          type="submit"
          className="min-h-tap w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground"
        >
          Sign Out
        </button>
      </form>
    </main>
  );
}
