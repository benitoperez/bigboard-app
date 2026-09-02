import type { Metadata } from "next";
import Link from "next/link";
import { getProspects } from "@/lib/data/prospects";
import { requireOrg } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import { getSelections } from "@/lib/data/selections";
import { boardOrder } from "@/lib/template";
import { NoTryout } from "@/components/no-tryout";
import { ExportButton } from "@/app/account/export-button";
import { PositionGroup } from "./position-group";

export const metadata: Metadata = { title: "Selected - Big Board" };

export default async function SelectedPage() {
  const { is_admin, activeOrg } = await requireOrg();

  const tryout = await getActiveTryout();
  if (!tryout) {
    return (
      <main className="safe-top px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Selected</h1>
        <NoTryout isAdmin={is_admin} orgName={activeOrg?.orgName ?? "This club"} />
      </main>
    );
  }

  const [{ template, prospects }, selections] = await Promise.all([
    getProspects(tryout.id),
    getSelections(tryout.id),
  ]);

  if (!template) {
    return (
      <main className="safe-top px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Selected</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          This tryout has no evaluation template.
        </p>
      </main>
    );
  }

  const selectedIds = new Set(selections.map((s) => s.prospectId));
  const addedBy = Object.fromEntries(
    selections.map((s) => [s.prospectId, s.selectedByName ?? "an officer"]),
  );
  const selected = prospects.filter((p) => selectedIds.has(p.id));

  // Segmented by PRIMARY position in the template's board order. Ordering
  // WITHIN a group is the group's own business - each one carries its own
  // sort control, defaulting to overall rating.
  const byPosition = boardOrder(template)
    .map((position) => ({
      position: position.code,
      label: position.label,
      components: position.components,
      rows: selected.filter((p) => p.primaryPosition === position.code),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <main className="safe-top px-6 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {tryout.name}
          {tryoutPeriod(tryout) && (
            <span className="text-muted-foreground"> &middot; {tryoutPeriod(tryout)}</span>
          )}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Selected</h1>
      </header>

      {/* Total count, large, at the top. */}
      <div className="mt-4 bb-card rounded-lg border border-border bg-card p-5 text-center">
        <p className="tnum text-6xl font-bold text-foreground">
          {selected.length}
        </p>
        <p className="mt-1 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          on the team list
        </p>
      </div>

      {/* Export just this list. Admin+, same as the full export - it carries
          the same ratings, only for fewer people. */}
      {is_admin && selected.length > 0 && (
        <div className="mt-3">
          <ExportButton
            scope="selected"
            label="Export the team list"
            hint="Only the athletes above, with their full ratings."
          />
        </div>
      )}

      {selected.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border-strong p-6 text-center">
          <p className="text-base font-semibold text-foreground">
            Nobody selected yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            This is the shared list of must-keep prospects and the guys worth
            discussing. Everyone sees the same list &mdash; adding someone adds
            him for the whole staff.
          </p>
          <Link
            href="/players"
            className="mt-4 inline-flex min-h-tap items-center justify-center rounded-md
                       border border-border px-4 text-sm font-semibold text-foreground"
          >
            Browse athletes
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {byPosition.map((group) => (
            <PositionGroup
              key={group.position}
              template={template}
              label={group.label}
              components={group.components}
              rows={group.rows}
              addedBy={addedBy}
            />
          ))}
        </div>
      )}
    </main>
  );
}
