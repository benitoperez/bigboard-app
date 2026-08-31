import { createClient } from "@/lib/supabase/server";

export type Officer = {
  id: string;
  display_name: string;
  is_admin: boolean;
};

/**
 * The signed-in officer, or null.
 *
 * Two things have to be true, and they fail differently:
 *
 *   1. A valid Supabase session exists.
 *   2. A row in `officers` exists with the same id.
 *
 * SPEC.md section 11 creates accounts by hand in two places - the auth user
 * in the dashboard, then a matching officers row. Miss the second and the
 * user authenticates fine but every write fails a foreign key or an
 * `officer_id = auth.uid()` policy, which reads like a broken app rather
 * than a missing row. Distinguishing the two cases here makes that
 * five seconds to diagnose instead of an hour.
 */
export async function getOfficer(): Promise<{
  userId: string | null;
  officer: Officer | null;
}> {
  const supabase = await createClient();

  // getClaims() validates the JWT signature; getSession() does not.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = (claimsData?.claims?.sub as string | undefined) ?? null;
  if (!userId) return { userId: null, officer: null };

  const { data: officer } = await supabase
    .from("officers")
    .select("id, display_name, is_admin")
    .eq("id", userId)
    .maybeSingle();

  return { userId, officer: officer ?? null };
}
