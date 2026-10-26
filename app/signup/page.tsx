import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create Account - Big Board" };

export default function SignupPage() {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
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
