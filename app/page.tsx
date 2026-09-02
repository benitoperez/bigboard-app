import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { getProspects, type ProspectRow } from "@/lib/data/prospects";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import { formatDrillValue, type Template } from "@/lib/template";
import { BoardView } from "./board-view";
import { NoTryout } from "@/components/no-tryout";
import { AddAthlete } from "./players/add-athlete";
import { boardOrder } from "@/lib/template";

export default async function HomePage() {
  // Redirects to the screen that matches the failure: /login when signed
  // out, /confirm-email when unconfirmed, /onboarding when they belong to
  // no org. Every authenticated screen goes through this.
  const { is_admin, is_evaluator, activeOrg } = await requireOrg();

  const tryout = await getActiveTryout();
  if (!tryout) {
    return (
      <main className="safe-top safe-bottom px-6 py-8">
        <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg?.orgName}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Big Board</h1>
        <NoTryout isAdmin={is_admin} orgName={activeOrg?.orgName ?? "This club"} />
      </main>
    );
  }

  const { template, prospects } = await getProspects(tryout.id);

  // No readable template means the tryout points at config this account
  // cannot see - a wrong-org id, or a deleted template. Either way the
  // ratings would be meaningless rather than merely absent.
  if (!template) {
    return (
      <main className="safe-top px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Big Board</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          This tryout has no evaluation template.
        </p>
      </main>
    );
  }

  return (
    <main className="safe-top px-6 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {tryout.name}
          {tryoutPeriod(tryout) && (
            <span className="text-muted-foreground"> &middot; {tryoutPeriod(tryout)}</span>
          )}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Big Board</h1>
      </header>

      <KpiStrip template={template} prospects={prospects} />

      {prospects.length === 0 ? (
        /* A class with nobody in it. The boards would be a wall of empty
           headings, so the next action goes here instead - and adding an
           athlete is available to any evaluator, unlike the CSV import. */
        <section className="bb-card mt-8 rounded-lg border border-border bg-card p-5">
          <h2 className="text-xl text-foreground uppercase">Add your athletes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {tryout.name} has no athletes yet. Add them one at a time here, or
            import a roster CSV from the Account tab.
          </p>
          {is_evaluator && (
            <div className="mt-4">
              <AddAthlete
                tryoutName={tryout.name}
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
        <BoardView template={template} prospects={prospects} />
      )}
    </main>
  );
}

/**
 * SPEC.md section 10.1, generalized by SPEC-V2.md: the class leader in each
 * measured drill, most-rated prospect, total prospects, total ratings.
 *
 * "Fastest 40" was hardcoded in v1. A template may now define several drills
 * pointing in different directions, so the leader is whichever end of the
 * range that drill calls good - fastest for a 40, hardest for an exit
 * velocity. Reading `direction` here is what keeps a velocity board from
 * celebrating the weakest hitter in the class.
 */
function KpiStrip({
  template,
  prospects,
}: {
  template: Template;
  prospects: ProspectRow[];
}) {
  const inputsFor = (p: ProspectRow) =>
    Object.values(p.attributeRatings).reduce(
      (sum, a) => sum + (a?.raterCount ?? 0),
      0,
    );

  const totalRatings = prospects.reduce((sum, p) => sum + inputsFor(p), 0);
  const mostRated = prospects.length
    ? prospects.reduce((a, b) => (inputsFor(a) >= inputsFor(b) ? a : b))
    : null;

  // "Fully rated" means the primary position cleared the gate - every
  // weighted component covered and enough officer inputs. It is the number
  // that actually says how ready the board is to cut from, which a raw
  // count of ratings does not.
  const fullyRated = prospects.filter((p) => p.primary.rating !== null).length;

  const drillLeaders = template.drills.map((drill) => {
    const measured = prospects.filter((p) => p.drills[drill.key] != null);
    const leader = measured.length
      ? measured.reduce((a, b) => {
          const av = a.drills[drill.key]!.best;
          const bv = b.drills[drill.key]!.best;
          return drill.direction === "lower_is_better"
            ? av <= bv
              ? a
              : b
            : av >= bv
              ? a
              : b;
        })
      : null;

    return {
      key: drill.key,
      label:
        drill.direction === "lower_is_better"
          ? `Fastest ${drill.label}`
          : `Top ${drill.label}`,
      value: leader
        ? formatDrillValue(drill, leader.drills[drill.key]!.best)
        : "--",
      person: leader,
    };
  });

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {drillLeaders.map((d) => (
        <Kpi
          key={d.key}
          label={d.label}
          value={d.value}
          person={d.person}
          emptyNote="none measured"
        />
      ))}
      <Kpi
        label="Most rated"
        value={mostRated ? String(inputsFor(mostRated)) : "0"}
        person={mostRated && inputsFor(mostRated) > 0 ? mostRated : null}
        emptyNote="no ratings yet"
      />
      <Kpi label="Prospects" value={String(prospects.length)} sub="in this tryout" />
      <Kpi
        label="Ratings Given"
        value={String(fullyRated)}
        sub={`fully rated · ${totalRatings} total ratings logged`}
      />
    </dl>
  );
}

/**
 * One dashboard tile.
 *
 * When the tile is ABOUT a person, their name is the headline under the
 * number and links straight to the profile - the fastest athlete in the
 * class is someone you immediately want to open, and reading the name then
 * hunting for it in the directory was the long way round.
 */
function Kpi({
  label,
  value,
  sub,
  person,
  emptyNote,
}: {
  label: string;
  value: string;
  sub?: string;
  person?: ProspectRow | null;
  emptyNote?: string;
}) {
  return (
    <div className="bb-card rounded-lg border border-border bg-card p-3">
      <dt className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="tnum mt-1 text-2xl font-bold text-foreground">{value}</dd>

      {person ? (
        <dd>
          <Link
            href={`/players/${person.id}`}
            className="-mx-1 flex min-h-tap items-center gap-1.5 rounded px-1 active:bg-secondary"
          >
            <span className="truncate text-sm font-semibold text-primary">
              {person.fullName}
            </span>
            <span className="tnum shrink-0 text-xs text-muted-foreground">
              #{person.jerseyNumber}
            </span>
          </Link>
        </dd>
      ) : (
        <dd className="truncate text-xs text-muted-foreground">
          {sub ?? emptyNote}
        </dd>
      )}
    </div>
  );
}
