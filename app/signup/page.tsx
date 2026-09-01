import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create Account - Big Board" };

export default function SignupPage() {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <header className="mb-10">
          <h1 className="text-5xl tracking-tight text-foreground uppercase">
            Big Board
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create an account, then start an organization or join one with an
            invite code.
          </p>
        </header>

        <SignupForm />

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
