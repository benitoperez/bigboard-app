"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ratingColor, formatRating } from "@/lib/rating-color";
import { Avatar, PositionChip } from "@/components/avatar";
import { SelectToggle } from "@/components/select-toggle";
import type { ProspectRow } from "@/lib/data/prospects";

/** SPEC.md section 10.2: search matches on jersey number OR name, both. */
function matches(p: ProspectRow, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (String(p.jerseyNumber).startsWith(needle)) return true;
  return p.fullName.toLowerCase().includes(needle);
}

export function PlayersList({
  prospects,
  selectedIds,
  positions,
}: {
  prospects: ProspectRow[];
  selectedIds: string[];
  /**
   * The org template's positions, in board order. Passed in rather than
   * imported: this is a client component and the template is a server read.
   */
  positions: { code: string; label: string }[];
}) {
  const selected = new Set(selectedIds);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      prospects.filter(
        (p) =>
          matches(p, query) &&
          (position === null ||
            p.primaryPosition === position ||
            p.secondaryPositions.includes(position)),
      ),
    [prospects, query, position],
  );

  const labelFor = (code: string) =>
    positions.find((x) => x.code === code)?.label ?? code;

  return (
    <>
      <div className="mt-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or number..."
          aria-label="Search prospects by name or jersey number"
          autoCapitalize="none"
          autoCorrect="off"
          className="min-h-tap w-full rounded-md border border-border bg-input px-4 text-base
                     text-foreground placeholder:text-muted-foreground outline-none
                     focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      {/* Position filter chips. Order comes from the template's sort order,
          so priority positions can be reordered in the template editor
          without touching this file. */}
      <div className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1">
        <FilterChip
          label="All"
          active={position === null}
          onClick={() => setPosition(null)}
        />
        {positions.map((p) => (
          <FilterChip
            key={p.code}
            label={p.code}
            active={position === p.code}
            onClick={() => setPosition(position === p.code ? null : p.code)}
          />
        ))}
      </div>

      <p className="mt-4 text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        {visible.length} {visible.length === 1 ? "Athlete" : "Athletes"}
      </p>

      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {visible.map((p) => (
          <li key={p.id}>
            <Link
              href={`/players/${p.id}`}
              className="flex min-h-tap-large items-center gap-3 px-3 py-3 active:bg-secondary"
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
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <PositionChip
                    position={p.primaryPosition}
                    label={labelFor(p.primaryPosition)}
                  />
                  {p.secondaryPositions.map((s) => (
                    <PositionChip
                      key={s}
                      position={s}
                      label={labelFor(s)}
                      muted
                    />
                  ))}
                </div>
              </div>

              <RatingCell prospect={p} />

              {/* SPEC.md section 10.4: the add control appears on each
                  directory row as well as in the profile header. */}
              <SelectToggle
                prospectId={p.id}
                prospectName={p.fullName}
                initialSelected={selected.has(p.id)}
              />
            </Link>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            No prospects match that search.
          </li>
        )}
      </ul>
    </>
  );
}

/**
 * SPEC.md section 8: never show a rating that is not fully covered. Show the
 * gap instead - it stops a barely-rated 91 outranking a fully-vetted 84, and
 * it nudges officers toward filling holes.
 */
function RatingCell({ prospect }: { prospect: ProspectRow }) {
  const { rating, inputs, covered, required } = prospect.primary;

  // The mockup's roster list uses a colored number rather than a dial;
  // dials are for the position boards. Same color scale either way.
  return (
    <div className="shrink-0 text-right">
      <div
        className="tnum text-xl font-bold"
        style={{ color: ratingColor(rating) }}
      >
        {formatRating(rating)}
      </div>
      <div className="tnum text-[11px] text-muted-foreground">
        {rating === null
          ? `${covered} of ${required}`
          : `${inputs} ${inputs === 1 ? "input" : "inputs"}`}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "min-h-tap shrink-0 rounded-full px-4 text-sm font-bold tracking-wide uppercase transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-muted-foreground")
      }
    >
      {label}
    </button>
  );
}
