import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOfficer } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = { title: "Confirm Your Email - Big Board" };

/**
 * The wall an unconfirmed account hits — SPEC-V2.md section 4.
 *
 * "Unconfirmed accounts cannot access anything." This is the only screen
 * they can reach, and it exists so that state reads as a step to finish
 * rather than as a broken app.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const { gate, email } = await getOfficer();

  // Already confirmed and signed in — nothing to do here. Onboarding sorts
  // out whether they still need an org.
  if (gate !== "signed-out" && gate !== "unconfirmed") redirect("/onboarding");

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-4xl tracking-tight text-foreground uppercase">
          Check your inbox
        </h1>

        {error === "invalid" ? (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            That confirmation link has expired or was already used. Send a
            fresh one below.
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {sent
              ? "We sent you a confirmation link. Click it to finish setting up your account."
              : "Your account is not confirmed yet. Click the link in the email we sent you."}
          </p>
        )}

        <p className="mt-3 text-sm text-muted-foreground">
          Until it is confirmed, there is nothing to see in the app.
        </p>

        <ResendForm email={email} />

        <div className="mt-8 flex items-center justify-between text-sm">
          <Link href="/login" className="text-muted-foreground">
            Back to sign in
          </Link>
          {gate === "unconfirmed" && (
            <form action={signOut}>
              <button type="submit" className="font-semibold text-muted-foreground">
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
