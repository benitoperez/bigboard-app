import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getProspectDetail } from "@/lib/data/prospect-detail";
import { getPositionRanks, type PositionRank } from "@/lib/data/prospects";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getSelectedIds } from "@/lib/data/selections";
import { getComments } from "@/lib/data/comments";
import { Avatar, PositionChip } from "@/components/avatar";
import { Dial } from "@/components/dial";
import { RatingsPanel } from "./ratings-panel";
import { PositionEditor } from "./position-editor";
import { DrillEntry } from "./drill-entry";
import { SelectToggle } from "@/components/select-toggle";
import { Comments } from "./comments";
import { HeadshotUpload } from "./headshot-upload";
import { ScoutingSummary } from "./scouting-summary";
import { DeleteProspect } from "./delete-prospect";

export default async function ProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, is_admin, is_evaluator, activeOrg } = await requireOrg();

  const detail = await getProspectDetail(id, profile!.id);
  if (!detail) notFound();
  const { template, prospect: p } = detail;

  const [tryout, comments] = await Promise.all([
    getActiveTryout(),
    getComments(id),
  ]);

  // Standing among everyone else at each position. Needs the whole class,
  // so it cannot come from the single-prospect read.
  const ranks = tryout ? await getPositionRanks(tryout.id) : new Map();
  const selectedIds = tryout ? await getSelectedIds(tryout.id) : new Set<string>();

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
      <header className="mt-2 bb-card rounded-lg border border-border bg-card p-4">
        {/* Row 1: photo, identity, primary rating. The rating sits hard
            right because it is the answer the screen exists to give - the
            eye lands on the name, then the number, without a detour. */}
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <Avatar
              jerseyNumber={p.jerseyNumber}
              headshotUrl={p.headshotUrl}
              name={p.fullName}
              size="lg"
            />
            <span className="tnum absolute -top-1 -left-1 rounded bg-background px-1.5 text-xs font-bold text-foreground">
              #{p.jerseyNumber}
            </span>

            {/* The pencil badge lives on the photo itself. */}
            {tryout && is_evaluator && (
              <HeadshotUpload
                prospectId={p.id}
                tryoutId={tryout.id}
                hasHeadshot={p.headshotPath !== null}
                currentPath={p.headshotPath}
                orgId={activeOrg!.orgId}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            {/* First and last on their own lines. A single truncated line
                cut surnames off entirely - "Brandon ..." identifies nobody
                on a roster where several share a first name. */}
            <h1 className="text-2xl leading-tight tracking-tight break-words uppercase">
              <span className="block">{p.firstName}</span>
              <span className="block">{p.lastName}</span>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <PositionChip
                position={p.primaryPosition}
                label={primaryRating.label}
              />
              {secondaryRatings.map((r) => (
                <PositionChip
                  key={r.position}
                  position={r.position}
                  label={r.label}
                  muted
                />
              ))}
            </div>
          </div>

          <PositionScore
            code={primaryRating.position}
            label={primaryRating.label}
            rating={primaryRating.rating.rating}
            inputs={primaryRating.rating.inputs}
            covered={primaryRating.rating.covered}
            required={primaryRating.rating.required}
            missing={primaryRating.missing}
            rank={ranks.get(primaryRating.position)?.get(p.id) ?? null}
            primary
          />
        </div>

        {/* Secondary positions, the add/remove control, and faint
            placeholders for the slots still open.

            The placeholders are the same dial and caption at low opacity,
            not a different shape: on an athlete with one position the row
            was a lone button with nothing to explain it, and an empty row
            teaches nothing about what belongs there. They fill the row to
            five and disappear as real positions take their places. */}
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {secondaryRatings.map((r) => (
            <PositionScore
              key={r.position}
              code={r.position}
              label={r.label}
              rating={r.rating.rating}
              inputs={r.rating.inputs}
              covered={r.rating.covered}
              required={r.rating.required}
              missing={r.missing}
              rank={ranks.get(r.position)?.get(p.id) ?? null}
            />
          ))}

          {is_evaluator && (
            <PositionEditor
              prospectId={p.id}
              primary={p.primaryPosition}
              secondary={p.secondaryPositions}
              positions={template.positions
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((tp) => ({ code: tp.code, label: tp.label }))}
            />
          )}

          {is_evaluator &&
            Array.from(
              { length: Math.max(0, ROW_TILES - secondaryRatings.length - 1) },
              (_, i) => <PositionPlaceholder key={i} />,
            )}
        </div>

        {/* The team-list toggle, full width and horizontal, in the
            slot the "Replace photo" bar used to occupy. It is the one
            decision an officer makes from this header, so it gets a row of
            its own rather than being tucked beside the name. */}
        {is_evaluator && (
          <div className="bb-card mt-4 flex min-h-tap-large items-center gap-3 rounded-lg border border-border bg-secondary px-3">
            <SelectToggle
              prospectId={p.id}
              prospectName={p.fullName}
              initialSelected={selectedIds.has(p.id)}
              size="lg"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {selectedIds.has(p.id) ? "On the team list" : "Not on the team list"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {selectedIds.has(p.id)
                  ? "Everyone sees them on the Selected tab"
                  : "Tap to add them for the whole staff"}
              </span>
            </span>
          </div>
        )}

        {/* Measurement strip. Styled apart from the dials on purpose: these
            are measurements, not opinions, and the design should say so. It
            carries only the headline facts - the drill sections below own
            the attempts and the editing. */}
        {p.drills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {p.drills.map((d) => (
              <div
                key={d.drill.key}
                className="flex flex-1 items-baseline gap-2 bb-card rounded-md border border-border-strong bg-secondary px-3 py-2"
              >
                <p className="text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                  {d.drill.label}
                </p>
                {d.best === null ? (
                  <p className="text-sm text-muted-foreground">Not measured</p>
                ) : (
                  <>
                    <p className="tnum text-lg font-bold text-foreground">
                      {d.best.toFixed(d.drill.decimals)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {d.drill.unit}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {d.percentile !== null
                        ? `${ordinal(d.percentile)} pct`
                        : `pct at ${d.drill.minTimedForPercentile}`}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </header>

      {!is_evaluator && (
        <p className="mt-6 rounded-md border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
          Your role in this organization is read-only. Ratings, drill results,
          comments and the team list are visible but not editable.
        </p>
      )}

      {/* ---- Rating section ---- */}
      {is_evaluator && (
      <section className="mt-6">
        <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          Your Ratings
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every attribute across {p.positionRatings.length}{" "}
          {p.positionRatings.length === 1 ? "position" : "positions"}. Shared
          attributes are rated once and count toward each. Nothing saves
          until you say so.
        </p>

        <RatingsPanel
          attributes={p.attributes}
          prospectId={p.id}
          officerId={profile!.id}
        />
      </section>
      )}

      {/* ---- Measured drills (SPEC.md section 10.3) ---- */}
      {is_evaluator && <DrillEntry prospectId={p.id} drills={p.drills} />}

      {/* ---- AI scouting summary (SPEC-V2 section 6.4) ---- */}
      {is_evaluator && activeOrg && (
        <ScoutingSummary prospectId={p.id} orgId={activeOrg.orgId} />
      )}

      {/* ---- Comments (SPEC.md section 10.3) ---- */}
      <div>
        <Comments
          prospectId={p.id}
          comments={comments}
          officerId={profile!.id}
          canComment={is_evaluator}
        />
      </div>

      {/* Destructive, admin only, and last on the page on purpose. */}
      {is_admin && (
        <div className="pb-4">
          <DeleteProspect
            prospectId={p.id}
            prospectName={p.fullName}
            jerseyNumber={p.jerseyNumber}
          />
        </div>
      )}
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
/**
 * How many tiles fit across a phone at this size. Once the real positions
 * plus the add control reach this, no placeholders are drawn and the control
 * simply wraps to the next line.
 */
const ROW_TILES = 5;

/**
 * An empty position slot.
 *
 * Deliberately the SAME dial and caption as a real one, just faded - a
 * different shape would read as a control rather than as "another position
 * could go here". The caption says POS instead of a position name because
 * inventing one would suggest the app expects that specific position.
 */
function PositionPlaceholder() {
  return (
    <div className="shrink-0 text-center opacity-30" aria-hidden="true">
      <Dial rating={null} size="md" label="POS" />
      <p className="tnum text-[11px] text-muted-foreground">&mdash;</p>
    </div>
  );
}

function PositionScore({
  code,
  label,
  rating,
  inputs,
  covered,
  required,
  missing,
  rank = null,
  primary = false,
}: {
  code: string;
  label?: string;
  rating: number | null;
  inputs: number;
  covered: number;
  required: number;
  missing: string[];
  rank?: PositionRank | null;
  primary?: boolean;
}) {
  return (
    <div className="shrink-0 text-center">
      <Dial rating={rating} size={primary ? "lg" : "md"} label={code} />

      {/* Standing first, input count demoted beneath it. "84" says how good;
          "#2 of 11" says whether that survives a cut, which is the question
          a board is being read to answer. */}
      {rating === null ? (
        <p className="tnum text-[11px] text-muted-foreground">
          {covered} of {required}
        </p>
      ) : (
        <>
          {rank && (
            <p
              className={
                "tnum font-bold text-foreground " +
                (primary ? "text-sm" : "text-[11px]")
              }
            >
              #{rank.rank}
              <span className="font-normal text-muted-foreground">
                {" "}
                of {rank.of}
                {primary && label ? ` ${label}s` : ""}
              </span>
            </p>
          )}
          <p className="tnum text-[11px] text-muted-foreground">
            ({inputs} {inputs === 1 ? "input" : "inputs"})
          </p>
        </>
      )}
      {rating === null && missing.length > 0 && primary && (
        <p className="mx-auto mt-1 max-w-[10rem] text-[11px] leading-tight text-muted-foreground">
          missing {missing.join(", ")}
        </p>
      )}
    </div>
  );
}
