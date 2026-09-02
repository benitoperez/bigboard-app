import type { Metadata } from "next";
import { getProspects } from "@/lib/data/prospects";
import { requireOrg } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import { getSelectedIds } from "@/lib/data/selections";
import { PlayersList } from "./players-list";
import { AddAthlete } from "./add-athlete";
import { boardOrder } from "@/lib/template";
import { NoTryout } from "@/components/no-tryout";

export const metadata: Metadata = { title: "Players - Big Board" };

export default async function PlayersPage() {
  const { is_admin, is_evaluator, activeOrg } = await requireOrg();

  const tryout = await getActiveTryout();

  if (!tryout) {
    return (
      <main className="safe-top safe-bottom px-6 py-8">
        <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg?.orgName}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Players</h1>
        <NoTryout isAdmin={is_admin} orgName={activeOrg?.orgName ?? "This club"} />
      </main>
    );
  }

  const [{ template, prospects }, selectedIds] = await Promise.all([
    getProspects(tryout.id),
    getSelectedIds(tryout.id),
  ]);

  if (!template) {
    return (
      <main className="safe-top safe-bottom px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Players</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          This tryout has no evaluation template.
        </p>
      </main>
    );
  }

  return (
    <main className="safe-top safe-bottom px-6 py-8">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            {tryout.name}
            {tryoutPeriod(tryout) && <> &middot; {tryoutPeriod(tryout)}</>}
          </p>
          <h1 className="mt-1 text-4xl tracking-tight uppercase">Players</h1>
        </div>
        {is_evaluator && prospects.length > 0 && (
          <AddAthlete
            tryoutName={tryout.name}
            tryoutId={tryout.id}
            orgId={activeOrg!.orgId}
            template={template}
            positions={boardOrder(template).map((p) => ({
              code: p.code,
              label: p.label,
            }))}
          />
        )}
      </header>

      {prospects.length === 0 ? (
        <section className="bb-card mt-8 rounded-lg border border-border bg-card p-5">
          <h2 className="text-xl text-foreground uppercase">No athletes yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add them one at a time, or import a roster CSV from the Account
            tab. The button shrinks into the header once the list has someone
            in it.
          </p>
          {is_evaluator && (
            <div className="mt-4">
              <AddAthlete
                tryoutName={tryout.name}
                tryoutId={tryout.id}
                orgId={activeOrg!.orgId}
                template={template}
                positions={boardOrder(template).map((p) => ({
                  code: p.code,
                  label: p.label,
                }))}
                size="large"
              />
            </div>
          )}
        </section>
      ) : (
        <PlayersList
          prospects={prospects}
          selectedIds={[...selectedIds]}
          positions={boardOrder(template).map((p) => ({
            code: p.code,
            label: p.label,
          }))}
        />
      )}
    </main>
  );
}
