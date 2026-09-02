"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProspectRow } from "@/lib/data/prospects";
import type { PositionComponent, Template } from "@/lib/template";
import { formatDrillValue, getDrill } from "@/lib/template";
import { compareForBoard } from "@/lib/ratings";
import { formatRating, ratingColor } from "@/lib/rating-color";
import { Avatar } from "@/components/avatar";
import { SelectToggle } from "@/components/select-toggle";

/**
 * One position's slice of the team list, with its own sort.
 *
 * The sort options are the components THIS position is scored on, not every
 * attribute in the template. A quarterback group offering "flag pulling"
 * would be noise: the question being asked at a cut is which of these
 * quarterbacks throws better, and only the inputs that move the QB rating
 * can answer it.
 *
 * Each group sorts independently. Comparing receivers by catching while
 * comparing linemen by blocking is the normal way this conversation goes,
 * and one shared control would force the whole screen into whichever
 * question was asked last.
 */
export function PositionGroup({
  template,
  label,
  components,
  rows,
  addedBy,
}: {
  template: Template;
  label: string;
  /** The weighted inputs for this position, from the template. */
  components: PositionComponent[];
  rows: ProspectRow[];
  /** Who put each athlete on the list, by prospect id. */
  addedBy: Record<string, string>;
}) {
  const [sortKey, setSortKey] = useState("overall");

  const options = useMemo(() => {
    const out = [{ value: "overall", label: "Overall" }];
    for (const c of components) {
      const found =
        c.kind === "attribute"
          ? template.attributes.find((a) => a.key === c.key)
          : template.drills.find((d) => d.key === c.key);
      if (found) out.push({ value: `${c.kind}:${c.key}`, label: found.label });
    }
    return out;
  }, [components, template]);

  const sorted = useMemo(() => {
    const list = [...rows];

    if (sortKey === "overall") {
      // Raw, never the 45-99 display band: the band compresses real gaps, so
      // sorting on it would call a genuine difference a tie (SPEC.md §8).
      return list.sort((a, b) =>
        compareForBoard(
          { raw: a.primary.raw, jerseyNumber: a.jerseyNumber },
          { raw: b.primary.raw, jerseyNumber: b.jerseyNumber },
        ),
      );
    }

    const [kind, key] = sortKey.split(":");

    const valueOf = (p: ProspectRow): number | null =>
      kind === "attribute"
        ? (p.attributeRatings[key]?.teamRating ?? null)
        : (p.drills[key]?.best ?? null);

    // A drill sorts by its own direction - a 40 is better lower, an exit
    // velocity better higher. Attributes are always higher-is-better.
    const lowerWins =
      kind === "drill" && getDrill(template, key)?.direction === "lower_is_better";

    return list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      // Unrated and unmeasured fall to the bottom either way. They are on
      // the team list, so they must not be hidden - only ranked last.
      if (av === null && bv === null) return a.jerseyNumber - b.jerseyNumber;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return lowerWins ? av - bv : bv - av;
      return a.jerseyNumber - b.jerseyNumber;
    });
  }, [rows, sortKey, template]);

  /** What to show on the right when sorting by something specific. */
  function readout(p: ProspectRow): string | null {
    if (sortKey === "overall") return null;
    const [kind, key] = sortKey.split(":");
    if (kind === "attribute") {
      const v = p.attributeRatings[key]?.teamRating;
      return v === undefined ? null : v.toFixed(1);
    }
    const drill = getDrill(template, key);
    const v = p.drills[key]?.best;
    return v === undefined || !drill ? null : formatDrillValue(drill, v);
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="shrink-0 text-sm font-bold tracking-wide text-primary uppercase">
          {label}
        </h2>

        {/* Sized to the heading beside it rather than to a form control, so
            it reads as part of the header row instead of a field dropped
            into it. Only rendered when there is more than one way to sort. */}
        {options.length > 1 && (
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            aria-label={`Sort ${label} by`}
            className="min-w-0 flex-1 truncate rounded-md border border-border bg-input
                       px-2 py-0.5 text-xs font-semibold text-muted-foreground
                       outline-none focus-visible:border-primary"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        <span className="tnum shrink-0 text-xs text-muted-foreground">
          {rows.length}
        </span>
      </div>

      <ul className="bb-card mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {sorted.map((p) => {
          const value = readout(p);
          return (
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
                    added by {addedBy[p.id] ?? "an officer"}
                  </p>
                </div>

                {/* The sorted value sits beside the rating, never replacing
                    it: the rating is why they are on this list at all. */}
                {value !== null && (
                  <span className="tnum shrink-0 text-sm font-bold text-foreground">
                    {value}
                  </span>
                )}
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
          );
        })}
      </ul>
    </section>
  );
}
