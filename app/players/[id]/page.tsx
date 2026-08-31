import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOfficer } from "@/lib/auth";
import { getProspectDetail } from "@/lib/data/prospect-detail";
import { POSITIONS, MIN_TIMED_FOR_PERCENTILE } from "@/lib/config/positions";
import { Avatar, PositionChip } from "@/components/avatar";
import { RatingSlider } from "./rating-slider";
import { AddPosition } from "./add-position";

export default async function ProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { officer } = await getOfficer();
  if (!officer) redirect("/login");

  const p = await getProspectDetail(id, officer.id);
  if (!p) notFound();

  const [primaryRating, ...secondaryRatings] = p.positionRatings;

  return (
    <main className="safe-top px-6 py-6">
      <Link
        href="/players"
        className="inline-flex min-h-tap items-center text-sm text-muted-foreground"
      >
        &larr; Athletes
      </Link>

      {/* ---- Header (SPEC.md section 10.3) ---- */}
      <header className="mt-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <Avatar
              jerseyNumber={p.jerseyNumber}
              headshotUrl={p.headshotUrl}
              name={p.fullName}
              size="lg"
            />
            <span className="tnum absolute -top-1 -left-1 rounded bg-background px-1.5 text-[11px] font-bold text-foreground">
              #{p.jerseyNumber}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl leading-tight tracking-tight uppercase">
              {p.fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <PositionChip position={p.primaryPosition} />
              {p.secondaryPositions.map((s) => (
                <PositionChip key={s} position={s} muted />
              ))}
            </div>
          </div>

          {/* Primary position rating. Becomes a dial in build order step 7. */}
          <PositionScore
            code={primaryRating.position}
            rating={primaryRating.rating.rating}
            inputs={primaryRating.rating.inputs}
            covered={primaryRating.rating.covered}
            required={primaryRating.rating.required}
            missing={primaryRating.missing}
            primary
          />
        </div>

        {/* Secondary positions, each with its own independent input count. */}
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {secondaryRatings.map((r) => (
            <PositionScore
              key={r.position}
              code={r.position}
              rating={r.rating.rating}
              inputs={r.rating.inputs}
              covered={r.rating.covered}
              required={r.rating.required}
              missing={r.missing}
            />
          ))}
          <AddPosition
            prospectId={p.id}
            taken={[p.primaryPosition, ...p.secondaryPositions]}
          />
        </div>

        {/* Speed strip. Styled apart from the position scores on purpose:
            this is a measurement, not an opinion, and the design should say
            so. Entry arrives in build order step 8. */}
        <div className="mt-4 rounded-md border border-border-strong bg-secondary px-3 py-2">
          <p className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            40 Yard Dash
          </p>
          {p.bestForty === null ? (
            <p className="mt-1 text-sm text-muted-foreground">No time recorded</p>
          ) : (
            <p className="tnum mt-1 text-lg font-bold text-foreground">
              {p.bestForty.toFixed(2)}{" "}
              <span className="text-xs font-normal text-muted-foreground">best</span>
              {p.avgForty !== null && (
                <>
                  {" / "}
                  {p.avgForty.toFixed(2)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">avg</span>
                </>
              )}
              {p.speedPercentile !== null && (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  &middot; {ordinal(p.speedPercentile)} percentile
                </span>
              )}
            </p>
          )}
          {p.bestForty !== null && !p.percentileIsValid && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Percentile hidden until {MIN_TIMED_FOR_PERCENTILE} prospects are
              timed.
            </p>
          )}
        </div>
      </header>

      {/* ---- Rating section ---- */}
      <section className="mt-6">
        <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          Your Ratings
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every attribute across {p.positionRatings.length}{" "}
          {p.positionRatings.length === 1 ? "position" : "positions"}. Shared
          attributes are rated once and count toward each.
        </p>

        <div className="mt-2 rounded-lg border border-border bg-card px-4">
          {p.attributes.map((a) => (
            <RatingSlider
              key={a.key}
              attribute={a}
              prospectId={p.id}
              officerId={officer.id}
            />
          ))}
        </div>
      </section>

      <p className="mt-6 pb-4 text-xs text-muted-foreground">
        40 entry lands in step 8, the select control in step 9, comments in
        step 11.
      </p>
    </main>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * SPEC.md section 8: when a position is not fully covered, show the gap
 * instead of a number. A barely-rated 91 above a fully-vetted 84 cuts the
 * wrong player, and naming the hole nudges officers toward filling it.
 */
function PositionScore({
  code,
  rating,
  inputs,
  covered,
  required,
  missing,
  primary = false,
}: {
  code: keyof typeof POSITIONS;
  rating: number | null;
  inputs: number;
  covered: number;
  required: number;
  missing: string[];
  primary?: boolean;
}) {
  return (
    <div className="shrink-0 text-center">
      <div
        className={
          "flex items-center justify-center rounded-full border-2 " +
          (primary ? "h-20 w-20 border-primary" : "h-14 w-14 border-border-strong")
        }
      >
        <span
          className={
            "tnum font-bold " +
            (rating === null ? "text-rating-none " : "text-foreground ") +
            (primary ? "text-3xl" : "text-lg")
          }
        >
          {rating ?? "--"}
        </span>
      </div>
      <p className="mt-1 text-[11px] font-bold tracking-wide text-primary uppercase">
        {code}
      </p>
      {rating === null ? (
        <p className="tnum text-[10px] text-muted-foreground">
          {covered} of {required}
        </p>
      ) : (
        <p className="tnum text-[10px] text-muted-foreground">
          {inputs} {inputs === 1 ? "input" : "inputs"}
        </p>
      )}
      {rating === null && missing.length > 0 && primary && (
        <p className="mx-auto mt-1 max-w-[10rem] text-[10px] leading-tight text-muted-foreground">
          missing {missing.join(", ")}
        </p>
      )}
    </div>
  );
}
