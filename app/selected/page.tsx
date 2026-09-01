import type { Metadata } from "next";
import Link from "next/link";
import { getProspects } from "@/lib/data/prospects";
import { requireOrg } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import { getSelections } from "@/lib/data/selections";
import { boardOrder } from "@/lib/template";
import { ratingColor, formatRating } from "@/lib/rating-color";
import { Avatar } from "@/components/avatar";
import { SelectToggle } from "@/components/select-toggle";

export const metadata: Metadata = { title: "Selected - Big Board" };

export default async function SelectedPage() {
  await requireOrg();

  const tryout = await getActiveTryout();
  if (!tryout) {
    return (
      <main className="safe-top px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Selected</h1>
        <p className="mt-6 text-sm text-muted-foreground">No active tryout.</p>
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
  const selected = prospects.filter((p) => selectedIds.has(p.id));

  // Segmented by PRIMARY position, in the template's board order.
  const byPosition = boardOrder(template)
    .map((position) => ({
      position: position.code,
      label: position.label,
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
      <div className="mt-4 rounded-lg border border-border bg-card p-5 text-center">
        <p className="tnum text-6xl font-bold text-foreground">
          {selected.length}
        </p>
        <p className="mt-1 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          on the team list
        </p>
      </div>

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
          {byPosition.map(({ position, label, rows }) => (
            <section key={position}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold tracking-wide text-primary uppercase">
                  {label}
                </h2>
                <span className="tnum text-xs text-muted-foreground">
                  {rows.length}
                </span>
              </div>

              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-3">
                    <Link
                      href={`/players/${p.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <Avatar
                        jerseyNumber={p.jerseyNumber}
                        headshotUrl={p.headshotUrl}
                        name={p.fullName}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate font-semibold text-foreground">
                            {p.fullName}
                          </span>
                          <span className="tnum shrink-0 text-sm text-muted-foreground">
                            #{p.jerseyNumber}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          added by{" "}
                          {selections.find((s) => s.prospectId === p.id)
                            ?.selectedByName ?? "an officer"}
                        </p>
                      </div>
                      <span
                        className="tnum shrink-0 text-xl font-bold"
                        style={{ color: ratingColor(p.primary.rating) }}
                      >
                        {formatRating(p.primary.rating)}
                      </span>
                    </Link>

                    <SelectToggle
                      prospectId={p.id}
                      prospectName={p.fullName}
                      initialSelected
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
