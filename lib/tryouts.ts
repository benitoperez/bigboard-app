/**
 * Client-safe tryout types and helpers.
 *
 * Kept apart from lib/data/tryouts.ts, which imports the Supabase server
 * client and therefore next/headers. A client component importing a VALUE
 * from that module drags server-only code into the browser bundle and the
 * build fails. Types alone are erased; constants and functions are not.
 */

export const SEMESTERS = [
  { value: "fall", label: "Fall" },
  { value: "spring", label: "Spring" },
  { value: "na", label: "No semester" },
] as const;

export type Semester = (typeof SEMESTERS)[number]["value"];

export type Tryout = {
  id: string;
  name: string;
  seasonYear: number | null;
  semester: Semester | null;
  tryoutDate: string | null;
  isActive: boolean;
  createdAt: string;
};

export type TryoutWithCount = Tryout & { prospectCount: number };

export function isSemester(v: unknown): v is Semester {
  return SEMESTERS.some((s) => s.value === v);
}

/** "Fall 2026", "2026", or "" - the period, separate from the class name. */
export function tryoutPeriod(t: {
  seasonYear: number | null;
  semester: Semester | null;
}): string {
  const sem =
    t.semester && t.semester !== "na"
      ? SEMESTERS.find((s) => s.value === t.semester)?.label
      : null;
  if (sem && t.seasonYear) return `${sem} ${t.seasonYear}`;
  if (t.seasonYear) return String(t.seasonYear);
  return sem ?? "";
}

/** Years offered when creating a class: a couple back, several forward. */
export function yearOptions(now = new Date().getFullYear()): number[] {
  const years: number[] = [];
  for (let y = now - 2; y <= now + 5; y++) years.push(y);
  return years;
}
