import type { Metadata } from "next";
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
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            NCSU Club Flag Football
          </p>
          <h1 className="mt-1 text-5xl tracking-tight text-foreground uppercase">
            Big Board
          </h1>
        </header>

        <LoginForm next={next ?? "/"} />

        {/* SPEC.md section 11: accounts are created by hand. No signup link. */}
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Accounts are created by an admin. Ask an officer if you need access.
        </p>
      </div>
    </main>
  );
}
