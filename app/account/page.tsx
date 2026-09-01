import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth";
import { ROLE_BLURBS, ROLE_LABELS } from "@/lib/org";
import { getActiveTryout, getTryoutsWithCounts } from "@/lib/data/tryouts";
import { signOut } from "@/app/login/actions";
import { CsvImport } from "./csv-import";
import { DeleteAllProspects } from "./delete-all";
import { TryoutManager } from "./tryout-manager";
import { getTemplateForTryout } from "@/lib/data/template";

export const metadata: Metadata = { title: "Account - Big Board" };

export default async function AccountPage() {
  const { profile, email, is_admin, activeOrg, role } = await requireOrg();
  const [tryout, tryouts] = await Promise.all([
    getActiveTryout(),
    getTryoutsWithCounts(),
  ]);

  const supabase = await createClient();

  // Jersey numbers already taken, so the CSV validator can flag collisions
  // before the user submits rather than after.
  let takenJerseys: number[] = [];
  const template = tryout ? await getTemplateForTryout(tryout.id) : null;
  if (tryout) {
    const { data } = await supabase
      .from("prospects")
      .select("jersey_number")
      .eq("tryout_id", tryout.id);
    takenJerseys = (data ?? []).map((p) => p.jersey_number);
  }

  return (
    <main className="safe-top px-6 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {activeOrg?.orgName ?? "Profile"}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Account</h1>
      </header>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-lg font-semibold text-foreground">
          {profile?.display_name ?? "Unknown"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>

        {/* The role is shown to everyone, not just admins: knowing why a
            control is missing is the difference between "read-only" and
            "broken". */}
        {role && (
          <span className="mt-3 inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
            {ROLE_LABELS[role]}
          </span>
        )}
        {role && (
          <p className="mt-2 text-xs text-muted-foreground">{ROLE_BLURBS[role]}</p>
        )}
      </section>

      <TryoutManager tryouts={tryouts} isAdmin={is_admin} />

      {/* SPEC.md section 12: admin only. The server action re-checks this. */}
      {is_admin && (
        <>
          {template && (
            <div className="mt-4">
              <CsvImport takenJerseys={takenJerseys} template={template} />
            </div>
          )}
          <DeleteAllProspects prospectCount={takenJerseys.length} />
        </>
      )}

      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className="min-h-tap-large w-full rounded-lg border border-destructive/40
                     text-base font-bold text-destructive active:bg-destructive/10"
        >
          Sign Out
        </button>
      </form>
    </main>
  );
}
