import type { Metadata } from "next";
import { getProspects } from "@/lib/data/prospects";
import { getActiveTryout } from "@/lib/data/tryouts";
import { tryoutPeriod } from "@/lib/tryouts";
import { getSelectedIds } from "@/lib/data/selections";
import { PlayersList } from "./players-list";
import { AddAthlete } from "./add-athlete";

export const metadata: Metadata = { title: "Players - Big Board" };

export default async function PlayersPage() {
  const tryout = await getActiveTryout();

  if (!tryout) {
    return (
      <main className="safe-top safe-bottom px-6 py-8">
        <h1 className="text-4xl tracking-tight uppercase">Players</h1>
        <p className="mt-6 text-sm text-muted-foreground">
          No active tryout. An admin needs to create one before prospects can
          be added.
        </p>
      </main>
    );
  }

  const [prospects, selectedIds] = await Promise.all([
    getProspects(tryout.id),
    getSelectedIds(tryout.id),
  ]);

  return (
    <main className="safe-top safe-bottom px-6 py-8">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            {tryout.name}
            {tryoutPeriod(tryout) && <> &middot; {tryoutPeriod(tryout)}</>}
          </p>
          <h1 className="mt-1 text-4xl tracking-tight uppercase">Players</h1>
        </div>
        <AddAthlete tryoutName={tryout.name} />
      </header>

      {prospects.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No athletes in this class yet. Use <strong>+ Add</strong> above for
          one at a time, or import a roster CSV from the Account screen.
        </p>
      ) : (
        <PlayersList prospects={prospects} selectedIds={[...selectedIds]} />
      )}
    </main>
  );
}
