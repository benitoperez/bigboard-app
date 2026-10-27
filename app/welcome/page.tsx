import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Big Board" };

/**
 * The first screen a signed-out visitor sees. Signed-in users never reach
 * it - the proxy sends them home - so it only has to do one job: point a
 * new visitor at signup, a returning one at sign-in, and an officer holding
 * an invite code straight at the join path.
 */
export default function WelcomePage() {
  return (
    // Not .safe-bottom: it would replace the bottom padding outright and set
    // the buttons flush against the edge on any phone without a home bar.
    <main className="safe-top flex min-h-dvh flex-col px-6 pt-12 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="bb-fade-in mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h1>
            <Image
              src="/logo.png"
              alt="Big Board"
              width={640}
              height={614}
              priority
              className="h-auto w-48"
            />
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Run tryouts from your phone.
            <br />
            Rank every athlete.
          </p>
        </div>

        {/* Bottom of the screen, where a thumb reaches without a regrip. */}
        <div className="flex flex-col gap-3">
          <Link
            href="/signup"
            className="min-h-tap-large flex items-center justify-center rounded-lg
                       bg-primary px-6 text-base font-bold tracking-wide
                       text-primary-foreground active:opacity-90"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="min-h-tap-large flex items-center justify-center rounded-lg
                       border border-border px-6 text-base font-bold text-foreground
                       active:bg-secondary"
          >
            I already have an account
          </Link>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Have an invite code?{" "}
            <Link href="/signup?join=1" className="font-semibold text-primary">
              Join your club
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
