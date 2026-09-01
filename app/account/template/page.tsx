import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getTemplateForTryout } from "@/lib/data/template";
import { weightErrors } from "@/lib/template";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Template - Big Board" };

/**
 * The template editor — SPEC-V2.md sections 3.1 and 5.
 *
 * A screen of its own rather than another block on Account: this is dense,
 * and Account is already long on a phone. Admin+ only, checked here and
 * again in every action.
 */
export default async function TemplatePage() {
  const { is_admin, activeOrg } = await requireOrg();
  if (!is_admin) redirect("/account");

  const tryout = await getActiveTryout();
  const template = tryout ? await getTemplateForTryout(tryout.id) : null;

  if (!template) {
    return (
      <main className="safe-top safe-bottom px-6 py-8">
        <BackLink />
        <h1 className="mt-2 text-4xl tracking-tight uppercase">Template</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          {tryout
            ? "This tryout class has no evaluation template attached."
            : "Create a tryout class first — the template belongs to the class you are running."}
        </p>
      </main>
    );
  }

  // Surfaced at the top because an unbalanced position silently produces no
  // rating at all, which reads as missing data rather than a broken template.
  const problems = weightErrors(template);

  return (
    <main className="safe-top safe-bottom px-6 py-8">
      <BackLink />

      <header className="mt-2">
        <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg?.orgName}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Template</h1>
        <p className="mt-2 text-sm text-muted-foreground">{template.name}</p>
      </header>

      {/* SPEC-V2 section 3.1: this framing is deliberate. The numbers are
          starting points informed by research, not fixed standards, and the
          UI must never imply otherwise. */}
      <p className="mt-4 rounded-md border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
        Weights are <strong className="text-foreground">research-informed
        defaults, fully editable</strong>. Change them to match how your club
        actually evaluates. Edits take effect immediately, including
        mid-tryout — nothing is stored, so every board recomputes from the
        weights as they stand.
      </p>

      {problems.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-semibold text-destructive-foreground">
            {problems.length} position{problems.length === 1 ? "" : "s"} will
            not produce a rating:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-destructive-foreground">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <TemplateEditor template={template} />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/account"
      className="inline-flex min-h-tap items-center text-sm text-muted-foreground"
    >
      &larr; Account
    </Link>
  );
}
