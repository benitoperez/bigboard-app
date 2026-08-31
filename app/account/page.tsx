import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/prospects";
import { signOut } from "@/app/login/actions";
import { CsvImport } from "./csv-import";

export const metadata: Metadata = { title: "Account - Big Board" };

export default async function AccountPage() {
  const { officer } = await getOfficer();
  const tryout = await getActiveTryout();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Jersey numbers already taken, so the CSV validator can flag collisions
  // before the user submits rather than after.
  let takenJerseys: number[] = [];
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
          Profile
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Account</h1>
      </header>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-lg font-semibold text-foreground">
          {officer?.display_name ?? "Unknown officer"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
        {officer?.is_admin && (
          <span className="mt-3 inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
            Admin
          </span>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          Active Tryout
        </p>
        <p className="mt-1 text-base text-foreground">
          {tryout ? tryout.name : "None"}
        </p>
        {tryout && (
          <p className="tnum mt-1 text-sm text-muted-foreground">
            {tryout.tryout_date} &middot; {takenJerseys.length} prospects
          </p>
        )}
      </section>

      {/* SPEC.md section 12: admin only. The server action re-checks this. */}
      {officer?.is_admin && (
        <div className="mt-4">
          <CsvImport takenJerseys={takenJerseys} />
        </div>
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
