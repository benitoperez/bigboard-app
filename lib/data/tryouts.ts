import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { isSemester, type Semester, type Tryout, type TryoutWithCount } from "@/lib/tryouts";

export type { Semester, Tryout, TryoutWithCount };
export { isSemester };

/**
 * Tryout classes.
 *
 * A class is one tryout cycle - "Fall 2026" - and every prospect, rating, 40
 * time, selection and comment hangs off it by tryout_id. Exactly one is
 * active at a time, and the active one is what every screen reads. Past
 * classes stay in the database untouched, which is how history is kept:
 * switching the active class swaps the whole app over to that year's data
 * without altering anything.
 *
 * There is deliberately no delete. Removing a class would cascade away an
 * entire season of evaluations.
 */

type Row = {
  id: string;
  name: string;
  season_year: number | null;
  semester: string | null;
  tryout_date: string | null;
  is_active: boolean;
  created_at: string;
};

function toTryout(r: Row): Tryout {
  return {
    id: r.id,
    name: r.name,
    seasonYear: r.season_year,
    semester: isSemester(r.semester) ? r.semester : null,
    tryoutDate: r.tryout_date,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

const SELECT = "id, name, season_year, semester, tryout_date, is_active, created_at";

/**
 * The active class in the caller's ACTIVE org.
 *
 * The org filter is not redundant with RLS. RLS admits every org the user
 * belongs to, so someone in two clubs would get whichever active class came
 * back first - and switching orgs would appear to do nothing, because every
 * screen would keep reading the other club's data.
 */
export async function getActiveTryout(): Promise<Tryout | null> {
  const { activeOrg } = await getOfficer();
  if (!activeOrg) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("tryouts")
    .select(SELECT)
    .eq("org_id", activeOrg.orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? toTryout(data as Row) : null;
}

/**
 * Every class, newest first, each with its prospect count.
 *
 * Counts come from one grouped read rather than a query per class - a club
 * running this for a few years would otherwise fire a dozen round trips just
 * to draw the dropdown.
 */
export async function getTryoutsWithCounts(): Promise<TryoutWithCount[]> {
  const { activeOrg } = await getOfficer();
  if (!activeOrg) return [];

  const supabase = await createClient();

  const [{ data: tryouts }, { data: prospects }] = await Promise.all([
    supabase
      .from("tryouts")
      .select(SELECT)
      .eq("org_id", activeOrg.orgId)
      .order("season_year", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("prospects").select("tryout_id").eq("org_id", activeOrg.orgId),
  ]);

  const counts = new Map<string, number>();
  for (const p of prospects ?? []) {
    counts.set(p.tryout_id, (counts.get(p.tryout_id) ?? 0) + 1);
  }

  return (tryouts ?? []).map((r) => ({
    ...toTryout(r as Row),
    prospectCount: counts.get(r.id) ?? 0,
  }));
}
