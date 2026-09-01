import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOfficer } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { OnboardingChoice } from "./onboarding-choice";

export const metadata: Metadata = { title: "Get Started - Big Board" };

/**
 * Where a confirmed account with no org lands — SPEC-V2.md section 4.
 *
 * Two paths, create or join. A user who already belongs to an org has no
 * business here and is sent home; a user who has not confirmed cannot get
 * this far.
 */
export default async function OnboardingPage() {
  const { gate, profile, memberships } = await getOfficer();

  if (gate === "signed-out") redirect("/login");
  if (gate === "unconfirmed") redirect("/confirm-email");
  if (memberships.length > 0) redirect("/");

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <header>
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            {profile?.display_name ? `Welcome, ${profile.display_name}` : "Welcome"}
          </p>
          <h1 className="mt-1 text-4xl tracking-tight text-foreground uppercase">
            Get started
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Big Board is organized around clubs. Start one, or join the one
            you were invited to.
          </p>
        </header>

        {/* A profile row should already exist — the signup trigger creates
            it. Saying so plainly beats a screen that silently does nothing. */}
        {gate === "no-profile" && (
          <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            Your profile record is missing. Sign out and back in; if it
            persists, an admin needs to look at it.
          </p>
        )}

        <OnboardingChoice />

        <form action={signOut} className="mt-10">
          <button
            type="submit"
            className="min-h-tap w-full text-sm text-muted-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
