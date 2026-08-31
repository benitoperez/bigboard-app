import type { Metadata } from "next";
import { getActiveTryout, getProspects } from "@/lib/data/prospects";
import { getSelectedIds } from "@/lib/data/selections";
import { PlayersList } from "./players-list";

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
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {tryout.name}
        </p>
        <h1 className="mt-1 text-4xl tracking-tight uppercase">Players</h1>
      </header>

      {prospects.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No prospects yet. Import a roster from the Account screen.
        </p>
      ) : (
        <PlayersList prospects={prospects} selectedIds={[...selectedIds]} />
      )}
    </main>
  );
}
