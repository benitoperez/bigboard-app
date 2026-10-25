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
import { DeleteOrg, LeaveOrg, OrgPanel } from "./org-panel";
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

  const showRosterData = is_evaluator && template && tryout;

  return (
    <main className="safe-top safe-bottom px-6 py-8">
      <header>
        <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg.orgName}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Account</h1>
      </header>

      {/* Grouped by what the user is managing, in order of how often they
          reach for it. Each group appears only when the role has something
          in it - hiding is cosmetic; RLS and the RPCs enforce. */}

      {/* ---- You ---- */}
      <Group title="You">
        <Card>
          <p className="text-lg font-semibold text-foreground">
            {profile?.display_name ?? "Unknown"}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{email}</p>

          {/* The role is shown to everyone, not just admins: knowing why a
              control is missing is the difference between "read-only" and
              "broken". */}
          <div className="mt-4 border-t border-border pt-4">
            <span className="inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
              {ROLE_LABELS[role]}
            </span>
            <p className="mt-2 text-sm text-muted-foreground">{ROLE_BLURBS[role]}</p>
          </div>
        </Card>
      </Group>

      {/* ---- Organization: identity, people, invites ---- */}
      <Group title="Organization">
        <OrgPanel activeOrg={activeOrg} memberships={memberships} isAdmin={is_admin} />
        <MembersPanel members={members} myRole={role} myUserId={userId} />
        {is_admin && inviteCodes.length > 0 && <InviteCodes codes={inviteCodes} />}
      </Group>

      {/* ---- Tryouts: which class is live, and how it is scored ---- */}
      <Group title="Tryouts">
        <TryoutManager tryouts={tryouts} isAdmin={is_admin} />

        {is_admin && template && (
          <Link
            href="/account/template"
            className="bb-card flex min-h-tap-large items-center justify-between gap-3
                       rounded-lg border border-border bg-card p-4 active:bg-secondary"
          >
            <span className="min-w-0">
              <span className="block text-base font-bold text-foreground">
                Evaluation template
              </span>
              <span className="mt-1 block truncate text-sm text-muted-foreground">
                {template.positions.length} positions ·{" "}
                {template.attributes.length} attributes · {template.drills.length}{" "}
                drills
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-xl text-muted-foreground">
              &rsaquo;
            </span>
          </Link>
        )}
      </Group>

      {/* ---- Roster data: one way in, one way out ---- */}
      {showRosterData && (
        <Group title="Roster data">
          <Card>
            <h3 className="text-base font-bold text-foreground">Import roster</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A file, a photo of a printed sheet, or pasted text. Everything
              lands in a review table first &mdash; nothing is saved until you
              confirm it.
            </p>
            <div className="mt-4">
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

            {/* The plain-CSV path survives inside the same card rather than
                as a second "Import Roster" panel: it carries the AI cleanup
                for a messy CSV that fails validation, which the flow above
                deliberately does not duplicate. */}
            {is_admin && (
              <details className="group mt-4 border-t border-border pt-4">
                <summary
                  className="flex min-h-tap cursor-pointer list-none items-center
                             justify-between text-sm font-semibold text-foreground"
                >
                  Strict CSV import with AI cleanup
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform group-open:rotate-90"
                  >
                    &rsaquo;
                  </span>
                </summary>
                <div className="mt-3">
                  <CsvImport
                    takenJerseys={takenJerseys}
                    template={template}
                    orgId={activeOrg.orgId}
                  />
                </div>
              </details>
            )}
          </Card>

          {is_admin && (
            <Card>
              <h3 className="text-base font-bold text-foreground">Export</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                One row per athlete, with every drill, position rating and
                attribute in this class. Admins only &mdash; an export carries
                every rating every officer has given.
              </p>
              <div className="mt-4">
                <ExportButton
                  scope="all"
                  label="Export this tryout class"
                  hint={`${takenJerseys.length} ${takenJerseys.length === 1 ? "athlete" : "athletes"} in ${tryout?.name ?? "the class"}.`}
                />
              </div>
            </Card>
          )}
        </Group>
      )}

      {/* ---- Danger zone: every irreversible action, in one place ---- */}
      <Group title="Danger zone" tone="destructive">
        <div
          className="bb-card divide-y divide-border overflow-hidden rounded-lg border
                     border-destructive/40 bg-card"
        >
          <LeaveOrg orgName={activeOrg.orgName} role={role} />
          {is_admin && <DeleteAllProspects prospectCount={takenJerseys.length} />}
          {role === "owner" && <DeleteOrg orgName={activeOrg.orgName} />}
        </div>
      </Group>

      <form action={signOut} className="mt-10">
        <button
          type="submit"
          className="min-h-tap-large w-full rounded-lg border border-border
                     text-base font-bold text-foreground active:bg-secondary"
        >
          Sign Out
        </button>
      </form>
    </main>
  );
}

/** One titled group of Account settings. The spacing lives here, once. */
function Group({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2
        className={
          "text-xl tracking-tight uppercase " +
          (tone === "destructive" ? "text-destructive" : "text-foreground")
        }
      >
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bb-card rounded-lg border border-border bg-card p-4">{children}</div>
  );
}
