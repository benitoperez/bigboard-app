/**
 * SPEC.md section 13: the default avatar is a colored circle containing the
 * jersey number. Headshots are optional and nothing blocks on one existing.
 */

// Deterministic per jersey so a prospect keeps the same color everywhere.
const AVATAR_COLORS = [
  "bg-chip-cyan text-background",
  "bg-chip-green text-background",
  "bg-chip-amber text-background",
  "bg-chip-violet text-foreground",
  "bg-chip-red text-foreground",
] as const;

export function avatarColor(jerseyNumber: number) {
  return AVATAR_COLORS[jerseyNumber % AVATAR_COLORS.length];
}

export function Avatar({
  jerseyNumber,
  headshotUrl,
  name,
  size = "md",
}: {
  jerseyNumber: number;
  headshotUrl?: string | null;
  name?: string;
  size?: "md" | "lg";
}) {
  const dims = size === "lg" ? "h-16 w-16 text-2xl" : "h-11 w-11 text-base";

  if (headshotUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage
      // URLs are not known at build time and are already resized client-side
      // to ~400px on upload (SPEC.md section 13).
      <img
        src={headshotUrl}
        alt={name ?? `#${jerseyNumber}`}
        className={`${dims} bb-avatar-photo shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${dims} ${avatarColor(jerseyNumber)} bb-avatar tnum flex shrink-0 items-center justify-center rounded-full font-bold`}
      aria-hidden="true"
    >
      {jerseyNumber}
    </div>
  );
}

export function PositionChip({
  position,
  label,
  muted = false,
}: {
  /** Position code, e.g. "WR" or "SS". */
  position: string;
  /**
   * Full name for the tooltip. Passed in rather than looked up: positions
   * live in the org's template now, which only server code can read.
   */
  label?: string;
  muted?: boolean;
}) {
  return (
    <span
      title={label ?? position}
      className={
        "rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase " +
        (muted
          ? "bg-secondary text-muted-foreground"
          : "bg-primary/15 text-primary")
      }
    >
      {position}
    </span>
  );
}
