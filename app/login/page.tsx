import type { Metadata } from "next";
import Image from "next/image";
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
