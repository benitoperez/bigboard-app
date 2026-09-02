import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth";
import { ROLE_BLURBS, ROLE_LABELS } from "@/lib/org";
import { getActiveTryout, getTryoutsWithCounts } from "@/lib/data/tryouts";
import { getInviteCodes, getMembers } from "@/lib/data/org";
import { getTemplateForTryout } from "@/lib/data/template";
import { signOut } from "@/app/login/actions";
import { CsvImport } from "./csv-import";
import { ImportSheet } from "@/app/players/import/import-sheet";
import { ExportButton } from "./export-button";
import { DeleteAllProspects } from "./delete-all";
import { TryoutManager } from "./tryout-manager";
import { MembersPanel } from "./members-panel";
import { InviteCodes } from "./invite-codes";
import { DeleteOrgPanel, OrgPanel } from "./org-panel";
import Link from "next/link";

export const metadata: Metadata = { title: "Account - Big Board" };

/**
 * ONE Account screen, rendered by role — SPEC-V2.md section 5.
 *
 * Not separate screens per role and no route branching: the same page, with
 * sections that appear as the caller's role allows. Hiding a section is
 * cosmetic; RLS and the RPCs are what actually enforce any of this, which is
 * why every action re-checks rather than trusting that the button was only
 * rendered for the right people.
 */
export default async function AccountPage() {
  const { profile, email, userId, role, is_admin, is_evaluator, activeOrg, memberships } =
    await requireOrg();

  // requireOrg guarantees both; narrowing for the type checker.
  if (!activeOrg || !role || !userId) return null;

  const [tryout, tryouts, members, inviteCodes] = await Promise.all([
    getActiveTryout(),
    getTryoutsWithCounts(),
    getMembers(activeOrg.orgId),
    // Returns empty below admin — the RLS policy on invite_codes decides,
    // not this call site.
    getInviteCodes(activeOrg.orgId),
  ]);

  const supabase = await createClient();

  // Jersey numbers already taken, so the CSV validator can flag collisions
  // before the user submits rather than after.
  let takenJerseys: number[] = [];
  const template = tryout ? await getTemplateForTryout(tryout.id) : null;
  if (tryout) {
    const { data } = await supabase
      .from("prospects")
      .select("jersey_number")
      .eq("tryout_id", tryout.id);
    takenJerseys = (data ?? []).map((p) => p.jersey_number);
  }

  return (
    <main className="safe-top safe-bottom px-6 py-8">
      <header>
        <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg.orgName}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Account</h1>
      </header>

      {/* ---- Everyone: profile ---- */}
      <section className="mt-6 bb-card rounded-lg border border-border bg-card p-4">
        <p className="text-lg font-semibold text-foreground">
          {profile?.display_name ?? "Unknown"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>

        {/* The role is shown to everyone, not just admins: knowing why a
            control is missing is the difference between "read-only" and
            "broken". */}
        <span className="mt-3 inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
          {ROLE_LABELS[role]}
        </span>
        <p className="mt-2 text-xs text-muted-foreground">{ROLE_BLURBS[role]}</p>
      </section>

      {/* ---- Everyone: org name, switcher, leave. Rename is admin+. ---- */}
      <OrgPanel
        activeOrg={activeOrg}
        memberships={memberships}
        role={role}
        isAdmin={is_admin}
      />

      {/* ---- Everyone reads the roster; admin+ gets the controls ---- */}
      <MembersPanel members={members} myRole={role} myUserId={userId} />

      {/* ---- Admin+: invite codes ---- */}
      {is_admin && inviteCodes.length > 0 && <InviteCodes codes={inviteCodes} />}

      {/* ---- Admin+: the template editor, on its own screen ---- */}
      {is_admin && template && (
        <Link
          href="/account/template"
          className="bb-card mt-4 flex min-h-tap-large items-center justify-between gap-3
                     rounded-lg border border-border bg-card px-4 py-3 active:bg-secondary"
        >
          <span className="min-w-0">
            <span className="block text-lg font-bold text-foreground">
              Edit Evaluation Template
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {template.positions.length} positions ·{" "}
              {template.attributes.length} attributes · {template.drills.length}{" "}
              drills
            </span>
          </span>
          <span className="shrink-0 text-xl text-muted-foreground">&rsaquo;</span>
        </Link>
      )}

      {/* ---- Admin+: tryout classes, import, destructive data controls ---- */}
      <TryoutManager tryouts={tryouts} isAdmin={is_admin} />

      {/* ---- Evaluator+: bulk import (SPEC-V2 section 10b.2) ---- */}
      {is_evaluator && template && tryout && (
        <section className="bb-card mt-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-xl uppercase">Import Roster</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A file, a photo of a printed sheet, or pasted text. Everything
            lands in a review table first &mdash; nothing is saved until you
            confirm it.
          </p>
          <div className="mt-3">
            <ImportSheet
              template={template}
              orgId={activeOrg.orgId}
              trigger={
                <span
                  className="min-h-tap-large flex w-full cursor-pointer items-center
                             justify-center rounded-lg bg-primary px-6 text-base
                             font-bold tracking-wide text-primary-foreground"
                >
                  Import a roster
                </span>
              }
            />
          </div>
        </section>
      )}

      {/* ---- Admin+: export, then the destructive data controls ---- */}
      {is_admin && (
        <>
          <section className="bb-card mt-4 rounded-lg border border-border bg-card p-4">
            <h2 className="text-xl uppercase">Export</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One row per athlete, with every drill, position rating and
              attribute in this class. Admins only &mdash; an export carries
              every rating every officer has given.
            </p>
            <div className="mt-3">
              <ExportButton
                scope="all"
                label="Export this tryout class"
                hint={`${takenJerseys.length} ${takenJerseys.length === 1 ? "athlete" : "athletes"} in ${tryout?.name ?? "the class"}.`}
              />
            </div>
          </section>

          {/* The older single-file panel stays: it carries the AI cleanup
              path for a messy CSV that fails validation, which the new flow
              deliberately does not duplicate. */}
          {template && (
            <div className="mt-4">
              <CsvImport
                takenJerseys={takenJerseys}
                template={template}
                orgId={activeOrg.orgId}
              />
            </div>
          )}
          <DeleteAllProspects prospectCount={takenJerseys.length} />
        </>
      )}

      {/* ---- Owner only: delete the org ---- */}
      {role === "owner" && <DeleteOrgPanel orgName={activeOrg.orgName} />}

      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className="min-h-tap-large w-full rounded-lg border border-destructive/40
                     text-base font-bold text-destructive active:bg-destructive/10"
        >
          Sign Out
        </button>
      </form>
    </main>
  );
}
