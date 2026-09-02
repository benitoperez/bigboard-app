import { ratingColor, formatRating } from "@/lib/rating-color";

/**
 * Rating dial - SPEC.md section 14: "SVG circles using stroke-dasharray for
 * the arc".
 *
 * The arc length is the rating out of 100. Ratings live in a 45-99 display
 * band, so a real dial never reads as near-empty, which is the intent of the
 * band - it makes the number feel like a football rating.
 *
 * Color comes from lib/rating-color.ts and nowhere else.
 */

const SIZES = {
  sm: { box: 44, stroke: 5, text: "text-sm" },
  md: { box: 56, stroke: 6, text: "text-lg" },
  lg: { box: 80, stroke: 7, text: "text-3xl" },
} as const;

export type DialSize = keyof typeof SIZES;

export function Dial({
  rating,
  size = "md",
  label,
}: {
  /** 0-100 display rating, or null when gated / unrated. */
  rating: number | null;
  size?: DialSize;
  /** Position code rendered under the dial, e.g. "WR". */
  label?: string;
}) {
  const { box, stroke, text } = SIZES[size];
  const r = (box - stroke) / 2;
  const cx = box / 2;
  const circumference = 2 * Math.PI * r;

  // Unrated draws no arc at all. A zero-length arc would still paint a dot
  // under a round linecap, which reads as "barely rated" rather than
  // "not rated".
  const hasRating = rating !== null;
  const filled = hasRating ? (Math.max(0, Math.min(100, rating)) / 100) * circumference : 0;
  const color = ratingColor(rating);

  return (
    <div className="bb-dial flex shrink-0 flex-col items-center">
      <div className="relative" style={{ width: box, height: box }}>
        <svg
          width={box}
          height={box}
          viewBox={`0 0 ${box} ${box}`}
          role="img"
          aria-label={
            hasRating
              ? `${label ? label + " " : ""}rating ${rating} out of 100`
              : `${label ? label + " " : ""}not yet rated`
          }
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke="var(--secondary)"
            strokeWidth={stroke}
          />
          {/* Arc, drawn from 12 o'clock clockwise */}
          {hasRating && (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference - filled}`}
              transform={`rotate(-90 ${cx} ${cx})`}
              style={{ transition: "stroke-dasharray 300ms ease-out" }}
            />
          )}
        </svg>

        <span
          className={`tnum absolute inset-0 flex items-center justify-center font-bold ${text}`}
          style={{ color: hasRating ? color : "var(--color-rating-none)" }}
          aria-hidden="true"
        >
          {formatRating(rating)}
        </span>
      </div>

      {label && (
        <span className="mt-1 text-xs font-bold tracking-wide text-primary uppercase">
          {label}
        </span>
      )}
    </div>
  );
}
