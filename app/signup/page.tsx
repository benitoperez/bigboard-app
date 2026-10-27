import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create Account - Big Board" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ join?: string }>;
}) {
  // Arrived from "Have an invite code?" on the welcome screen.
  const joining = (await searchParams).join === "1";

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <Link
          href="/welcome"
          className="min-h-tap -ml-2 mb-6 inline-flex items-center px-2 text-sm
                     font-semibold text-muted-foreground"
        >
          &lsaquo; Back
        </Link>
        <header className="mb-10 flex flex-col items-center text-center">
          <h1>
            <Image
              src="/logo.png"
              alt="Big Board"
              width={640}
              height={614}
              priority
              className="h-auto w-40"
            />
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {joining
              ? "Create your account, confirm your email, then enter the invite code you were given."
              : "Create an account, then start an organization or join one with an invite code."}
          </p>
        </header>

        <SignupForm joining={joining} />

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
