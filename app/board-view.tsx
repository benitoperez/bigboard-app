"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProspectRow } from "@/lib/data/prospects";
import {
  boardOrder,
  formatDrillValue,
  getDrill,
  type Template,
  type TemplatePosition,
} from "@/lib/template";
import { compareForBoard } from "@/lib/ratings";
import { Avatar, PositionChip } from "@/components/avatar";
import { Dial } from "@/components/dial";

/**
 * The dashboard body: one flat ranked list, or position boards.
 *
 * **Overall rating is the default**, which deliberately departs from SPEC.md
 * section 10.1 — that argued position boards should be primary, because
 * officers hunt specific positions and a single "best overall" list is the
 * wrong first view. In use it turned out the other way round: the first
 * question at a tryout is who is best, and the boards are the detour taken
 * once you are hunting a particular spot. Both are one tap apart either way.
 *
 * Position boards are still the RIGHT tool for cut decisions, so nothing was
 * removed — only the order the two are offered in.
 */

/** Overall rating, highest first. See the note above about SPEC §10.1. */
const DEFAULT_SORT = "rating";

type SortOption = {
  value: string;
  label: string;
  group: string;
  /** Null for the default board view. */
  sort: ((a: ProspectRow, b: ProspectRow) => number) | null;
  /** The number to show on each row under this sort. */
  readout: ((p: ProspectRow) => string | null) | null;
};

export function BoardView({
  template,
  prospects,
}: {
  template: Template;
  prospects: ProspectRow[];
}) {
  const options = useMemo(() => buildOptions(template), [template]);
  const [sortKey, setSortKey] = useState(DEFAULT_SORT);

  const active = options.find((o) => o.value === sortKey) ?? options[0];

  return (
    <>
      <div className="mt-4">
        <label
          htmlFor="board-sort"
          className="text-xs font-bold tracking-[0.12em] text-foreground uppercase"
        >
          Sort by
        </label>
        <select
          id="board-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="min-h-tap mt-1.5 w-full rounded-md border border-border bg-input px-3
                     text-base font-semibold text-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2
                     focus-visible:ring-ring/40"
        >
          {groupBy(options).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {active.sort === null ? (
        <div className="mt-6 space-y-6">
          {boardOrder(template).map((position) => (
            <Board
              key={position.code}
              template={template}
              position={position}
              prospects={prospects}
            />
          ))}
        </div>
      ) : (
        <RankedList
          prospects={prospects}
          sort={active.sort}
          readout={active.readout}
          valueIsRating={active.value === DEFAULT_SORT}
        />
      )}
    </>
  );
}

/**
 * One flat, ranked list across every position.
 *
 * Rows carry position chips because the segmentation that normally supplies
 * that context is gone — without them a name at the top of a 40 list tells
 * you nothing about where they would play.
 *
 * Prospects with no value for the chosen measure sort to the bottom and grey
 * out, the same treatment gated prospects get on the boards: they are not
 * bad, they are unmeasured, and hiding them would hide who still needs work.
 */
function RankedList({
  prospects,
  sort,
  readout,
  valueIsRating,
}: {
  prospects: ProspectRow[];
  sort: (a: ProspectRow, b: ProspectRow) => number;
  readout: ((p: ProspectRow) => string | null) | null;
  /** True when the sorted value is the rating the dial already shows. */
  valueIsRating: boolean;
}) {
  const rows = [...prospects].sort(sort);

  if (rows.length === 0) return null;

  return (
    <ol className="bb-card mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {rows.map((p, i) => {
        const value = readout?.(p) ?? null;
        const missing = value === null;
        return (
          <li key={p.id}>
            <Link
              href={`/players/${p.id}`}
              className={
                "flex min-h-tap-large items-center gap-3 px-3 py-2 active:bg-secondary " +
                (missing ? "opacity-45" : "")
              }
            >
              <span className="tnum w-5 shrink-0 text-right text-xs text-muted-foreground">
                {missing ? "" : i + 1}
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
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <PositionChip position={p.primaryPosition} />
                  {p.secondaryPositions.map((sec) => (
                    <PositionChip key={sec} position={sec} muted />
                  ))}
                </div>
              </div>

              {/* The dial is always here, whatever the sort. It is how a
                  rating reads everywhere else in the app, and dropping it
                  when this list became the default view quietly took the
                  colour band - the thing that makes an 87 and a 62 tell
                  apart at a glance - off the busiest screen.

                  When sorting by something OTHER than the rating, the sorted
                  value sits beside it: the dial answers "how good", the
                  number answers "by what you asked to sort on". */}
              {!valueIsRating && (
                <span className="tnum shrink-0 text-sm font-bold text-foreground">
                  {value ?? "--"}
                </span>
              )}
              <Dial rating={p.primary.rating} size="sm" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One position board — SPEC.md section 10.1.
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

      <ol className="bb-card mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
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

// ------------------------------------------------------------------ sorting

/** Missing values always sort last, whichever direction is chosen. */
function byValue(
  get: (p: ProspectRow) => number | null,
  bestIsHigh: boolean,
): (a: ProspectRow, b: ProspectRow) => number {
  return (a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av === null && bv === null) return a.jerseyNumber - b.jerseyNumber;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return bestIsHigh ? bv - av : av - bv;
    return a.jerseyNumber - b.jerseyNumber;
  };
}

function buildOptions(template: Template): SortOption[] {
  const options: SortOption[] = [
    {
      // Primary-position rating, sorted on RAW so the display band's
      // collisions do not present real gaps as ties (SPEC.md section 8).
      value: "rating",
      label: "Overall rating — highest first",
      group: "Everyone",
      sort: (a, b) =>
        compareForBoard(
          { raw: a.primary.raw, jerseyNumber: a.jerseyNumber },
          { raw: b.primary.raw, jerseyNumber: b.jerseyNumber },
        ),
      readout: (p) => (p.primary.rating === null ? null : String(p.primary.rating)),
    },
    {
      value: "boards",
      label: "Position boards",
      group: "Everyone",
      sort: null,
      readout: null,
    },
  ];

  for (const drill of template.drills) {
    const best = (p: ProspectRow) => p.drills[drill.key]?.best ?? null;
    const show = (p: ProspectRow) => {
      const v = p.drills[drill.key]?.best;
      return v === undefined ? null : formatDrillValue(drill, v);
    };
    const lower = drill.direction === "lower_is_better";

    options.push({
      value: `drill:${drill.key}:best`,
      label: `${drill.label} — ${lower ? "fastest" : "highest"} first`,
      group: "Measured drills",
      sort: byValue(best, !lower),
      readout: show,
    });
    options.push({
      value: `drill:${drill.key}:worst`,
      label: `${drill.label} — ${lower ? "slowest" : "lowest"} first`,
      group: "Measured drills",
      sort: byValue(best, lower),
      readout: show,
    });
  }

  for (const attr of template.attributes) {
    // The team rating is a median across officers; a prospect nobody has
    // rated on it has no value rather than a zero.
    const get = (p: ProspectRow) => p.attributeRatings[attr.key]?.teamRating ?? null;
    const show = (p: ProspectRow) => {
      const v = get(p);
      return v === null ? null : v.toFixed(1);
    };

    options.push({
      value: `attr:${attr.key}:high`,
      label: `${attr.label} — highest first`,
      group: "Judged attributes",
      sort: byValue(get, true),
      readout: show,
    });
    options.push({
      value: `attr:${attr.key}:low`,
      label: `${attr.label} — lowest first`,
      group: "Judged attributes",
      sort: byValue(get, false),
      readout: show,
    });
  }

  return options;
}

function groupBy(options: SortOption[]): [string, SortOption[]][] {
  const out: [string, SortOption[]][] = [];
  for (const o of options) {
    const existing = out.find(([g]) => g === o.group);
    if (existing) existing[1].push(o);
    else out.push([o.group, [o]]);
  }
  return out;
}
