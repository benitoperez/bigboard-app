import Link from "next/link";
import { getOfficer } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { getProspects, type ProspectRow } from "@/lib/data/prospects";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import {
  boardOrder,
  formatDrillValue,
  getDrill,
  type Template,
  type TemplatePosition,
} from "@/lib/template";
import { Avatar } from "@/components/avatar";
import { Dial } from "@/components/dial";
import { compareForBoard } from "@/lib/ratings";

export default async function HomePage() {
  const { userId, officer } = await getOfficer();

  // Authenticated, but no officers row. Every write would fail an
  // `officer_id = auth.uid()` policy from here, so say so plainly instead of
  // letting it surface later as a mystery permissions error.
  if (userId && !officer) {
    return (
      <main className="safe-top flex min-h-dvh flex-col justify-center px-6">
        <div className="mx-auto w-full max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h1 className="text-2xl text-foreground">Account not finished</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You are signed in, but there is no officer record for this account
            yet. An admin needs to add a row to <code>officers</code> with your
            user id.
          </p>
          <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
            {userId}
          </p>
          <form action={signOut} className="mt-6">
            <button
              type="submit"
              className="min-h-tap w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground"
            >
              Sign Out
            </button>
          </form>
        </div>
      </main>
    );
  }

  const tryout = await getActiveTryout();
  if (!tryout) {
    return (
      <main className="safe-top px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Big Board</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          No active tryout yet.
        </p>
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
        <p className="mt-8 text-sm text-muted-foreground">
          No prospects yet. Import a roster from the Account screen.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {/* SPEC.md section 10.1: boards render in the template's sort
              order, so priority positions reorder from the template editor
              without touching this file. */}
          {boardOrder(template).map((position) => (
            <Board
              key={position.code}
              template={template}
              position={position}
              prospects={prospects}
            />
          ))}
        </div>
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
      sub: leader
        ? `#${leader.jerseyNumber} ${leader.lastName}`
        : "none measured",
    };
  });

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {drillLeaders.map((d) => (
        <Kpi key={d.key} label={d.label} value={d.value} sub={d.sub} />
      ))}
      <Kpi
        label="Most rated"
        value={mostRated ? String(inputsFor(mostRated)) : "0"}
        sub={
          mostRated && inputsFor(mostRated) > 0
            ? `#${mostRated.jerseyNumber} ${mostRated.lastName}`
            : "no ratings yet"
        }
      />
      <Kpi label="Prospects" value={String(prospects.length)} sub="in this tryout" />
      <Kpi label="Ratings logged" value={String(totalRatings)} sub="across all officers" />
    </dl>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <dt className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="tnum mt-1 text-2xl font-bold text-foreground">{value}</dd>
      <dd className="truncate text-xs text-muted-foreground">{sub}</dd>
    </div>
  );
}

/**
 * One position board - SPEC.md section 10.1.
 *
 * Sorted by RAW score descending, never by the 45-99 display number: the band
 * compresses real gaps, so two prospects can share a display value while one
 * is genuinely ahead. Section 8 is explicit about this.
 *
 * Gated prospects sort to the bottom and render grayed out rather than being
 * hidden, so officers can see who still needs eyes on them.
 */
function Board({
  template,
  position,
  prospects,
}: {
  template: Template;
  position: TemplatePosition;
  prospects: ProspectRow[];
}) {
  // The drills this position is actually scored on, so a row shows the
  // measurements that moved its own number rather than every drill in the
  // template.
  const drillKeys = position.components
    .filter((c) => c.kind === "drill")
    .map((c) => c.key);

  const rows = prospects
    .filter((p) => p.playedPositions.includes(position.code))
    .map((p) => ({ p, r: p.ratingsByPosition[position.code]! }))
    .sort((a, b) =>
      compareForBoard(
        { raw: a.r.raw, jerseyNumber: a.p.jerseyNumber },
        { raw: b.r.raw, jerseyNumber: b.p.jerseyNumber },
      ),
    );

  if (rows.length === 0) return null;

  const ranked = rows.filter((x) => x.r.rating !== null).length;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold tracking-wide text-primary uppercase">
          {position.label}
        </h2>
        <span className="tnum text-xs text-muted-foreground">
          {ranked} of {rows.length} rated
        </span>
      </div>

      <ol className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map(({ p, r }, i) => {
          const gated = r.rating === null;
          return (
            <li key={p.id}>
              <Link
                href={`/players/${p.id}`}
                className={
                  "flex min-h-tap-large items-center gap-3 px-3 py-2 active:bg-secondary " +
                  (gated ? "opacity-45" : "")
                }
              >
                <span className="tnum w-5 shrink-0 text-right text-xs text-muted-foreground">
                  {gated ? "" : i + 1}
                </span>

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
                    <span className="tnum shrink-0 text-xs text-muted-foreground">
                      #{p.jerseyNumber}
                    </span>
                  </div>
                  <p className="tnum mt-0.5 text-xs text-muted-foreground">
                    {gated
                      ? `${r.covered} of ${r.required} inputs`
                      : `${r.inputs} ${r.inputs === 1 ? "input" : "inputs"}`}
                    {drillKeys.map((key) => {
                      const stat = p.drills[key];
                      const drill = getDrill(template, key);
                      if (!stat || !drill) return null;
                      return (
                        <span key={key}>
                          {" "}
                          &middot; {formatDrillValue(drill, stat.best)}
                        </span>
                      );
                    })}
                  </p>
                </div>

                <Dial rating={r.rating} size="sm" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
