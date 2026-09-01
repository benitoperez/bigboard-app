import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign In - Big Board" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <header className="mb-10">
          <h1 className="mt-1 text-5xl tracking-tight text-foreground uppercase">
            Big Board
          </h1>
        </header>

        <LoginForm next={next ?? "/"} />

        {/* SPEC-V2 section 4: v2 opens public signup, so this is a link
            again. v1 deliberately had none. */}
        <p className="mt-8 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-semibold text-primary">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
