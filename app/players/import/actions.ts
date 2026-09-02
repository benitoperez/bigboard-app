"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getActiveTryout } from "@/lib/data/tryouts";
import { getTemplateForTryout } from "@/lib/data/template";
import { isPositionCode, type Template } from "@/lib/template";

/** One reviewed row, as the table hands it back. */
export type ReviewRow = {
  firstName: string;
  lastName: string;
  jerseyNumber: string;
  /** Position codes, primary first. */
  positions: string[];
  /** Attempt values per drill key, as typed. Blank means not measured. */
  drills: Record<string, string[]>;
  selected: boolean;
  /** What to do when this jersey already exists in the class. */
  mode: "insert" | "overwrite" | "skip";
  /**
   * Field names the AI could not read confidently, for highlighting in the
   * review table. Display only — the server ignores it, because whether a
   * model was confident says nothing about whether the value is valid.
   */
  uncertain?: string[];
};

export type RowIssue = { row: number; message: string };

export type CommitResult =
  | {
      ok: true;
      inserted: number;
      overwritten: number;
      results: number;
      selections: number;
      skipped: number;
    }
  | { ok: false; issues: RowIssue[] };

export type PrepareResult =
  | {
      ok: true;
      /** Jersey numbers already used in the active tryout. */
      takenJerseys: number[];
      tryoutName: string;
    }
  | { ok: false; error: string };

/**
 * What the review table needs before it can flag collisions.
 *
 * Read at review time AND re-read at commit, because someone else can add an
 * athlete while a roster is being reviewed — which is exactly the window a
 * photo-based import leaves open.
 */
export async function prepareImport(): Promise<PrepareResult> {
  const { is_evaluator, activeOrg } = await getOfficer();
  if (!activeOrg) return { ok: false, error: "No active organization." };
  if (!is_evaluator) {
    return { ok: false, error: "Your role in this organization is read-only." };
  }

  const tryout = await getActiveTryout();
  if (!tryout) return { ok: false, error: "There is no active tryout class." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("prospects")
    .select("jersey_number")
    .eq("tryout_id", tryout.id);

  return {
    ok: true,
    takenJerseys: (data ?? []).map((p) => p.jersey_number),
    tryoutName: tryout.name,
  };
}

/**
 * Write a reviewed roster — SPEC-V2.md sections 10b.5 and 10b.6.
 *
 * EVALUATOR+, which is a change from v1 (B23). The RLS policies already
 * allow it: prospects_insert and prospects_update are both
 * app.is_evaluator(org_id).
 *
 * Everything lands through ONE `import_roster` RPC, in a single transaction.
 * v1 imported in three client-side steps and unwound a failure by deleting
 * the prospects it had just inserted — and prospects_delete is admin-only,
 * so that rollback is closed to evaluators. Any failure here rolls back
 * whole, for everybody, with no delete permission required.
 *
 * Validation runs again server-side. The review table validated the same
 * things for fast feedback, but a server action is a public endpoint and
 * client validation is a courtesy, never a control.
 */
export async function commitImport(rows: ReviewRow[]): Promise<CommitResult> {
  const { is_evaluator, activeOrg } = await getOfficer();
  if (!activeOrg) {
    return { ok: false, issues: [{ row: 0, message: "No active organization." }] };
  }
  if (!is_evaluator) {
    return {
      ok: false,
      issues: [
        { row: 0, message: "Your role in this organization is read-only." },
      ],
    };
  }

  const tryout = await getActiveTryout();
  if (!tryout) {
    return {
      ok: false,
      issues: [{ row: 0, message: "There is no active tryout class." }],
    };
  }

  const template = await getTemplateForTryout(tryout.id);
  if (!template) {
    return {
      ok: false,
      issues: [
        { row: 0, message: "This tryout has no evaluation template." },
      ],
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("prospects")
    .select("jersey_number")
    .eq("tryout_id", tryout.id);
  const taken = new Set((existing ?? []).map((p) => p.jersey_number));

  const keep = rows.filter((r) => r.mode !== "skip");
  const skipped = rows.length - keep.length;

  const issues: RowIssue[] = [];
  const seen = new Map<number, number>();
  const payload: unknown[] = [];

  keep.forEach((row, i) => {
    const line = i + 1;
    const first = row.firstName.trim();
    const last = row.lastName.trim();
    const jerseyRaw = row.jerseyNumber.trim();

    if (!first) issues.push({ row: line, message: "First name is empty." });
    if (!last) issues.push({ row: line, message: "Last name is empty." });

    if (!/^\d+$/.test(jerseyRaw)) {
      issues.push({
        row: line,
        message: `Jersey "${jerseyRaw}" is not a whole number.`,
      });
      return;
    }
    const jersey = Number(jerseyRaw);
    if (jersey < 0 || jersey > 999) {
      issues.push({ row: line, message: `Jersey ${jersey} is out of range.` });
      return;
    }

    if (seen.has(jersey)) {
      issues.push({
        row: line,
        message: `Jersey ${jersey} appears twice in this import (also row ${seen.get(jersey)}).`,
      });
      return;
    }
    seen.set(jersey, line);

    // The collision decision is the reviewer's, but the CLAIM is checked:
    // "insert" on a jersey that now exists would violate the unique
    // constraint, and "overwrite" on one that does not would update nothing.
    // Either means the class changed while the roster was being reviewed.
    if (row.mode === "insert" && taken.has(jersey)) {
      issues.push({
        row: line,
        message: `Jersey ${jersey} was taken while you were reviewing. Choose overwrite, skip, or a different number.`,
      });
      return;
    }
    if (row.mode === "overwrite" && !taken.has(jersey)) {
      issues.push({
        row: line,
        message: `Jersey ${jersey} no longer exists to overwrite. Switch this row to add.`,
      });
      return;
    }

    const codes = row.positions
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
    const unique = [...new Set(codes)];
    const bad = unique.filter((c) => !isPositionCode(template, c));
    if (bad.length > 0) {
      issues.push({
        row: line,
        message: `Not a position in this template: ${bad.join(", ")}.`,
      });
      return;
    }
    if (unique.length === 0) {
      issues.push({ row: line, message: "Pick at least one position." });
      return;
    }

    const drills = validateDrills(template, row.drills, line, issues);

    payload.push({
      first_name: first,
      last_name: last,
      jersey_number: jersey,
      primary_position: unique[0],
      secondary_positions: unique.slice(1),
      selected: row.selected,
      mode: row.mode,
      drills,
    });
  });

  if (issues.length > 0) return { ok: false, issues };
  if (payload.length === 0) {
    return {
      ok: false,
      issues: [{ row: 0, message: "Every row was skipped. Nothing to import." }],
    };
  }

  const { data, error } = await supabase.rpc("import_roster", {
    p_tryout: tryout.id,
    p_rows: payload,
  });

  if (error) {
    return {
      ok: false,
      issues: [
        {
          row: 0,
          message: `Nothing was imported — the whole batch was rolled back. ${error.message}`,
        },
      ],
    };
  }

  const counts = (data as
    | { inserted: number; overwritten: number; results: number; selections: number }[]
    | null)?.[0];

  revalidatePath("/players");
  revalidatePath("/selected");
  revalidatePath("/");

  return {
    ok: true,
    inserted: Number(counts?.inserted ?? 0),
    overwritten: Number(counts?.overwritten ?? 0),
    results: Number(counts?.results ?? 0),
    selections: Number(counts?.selections ?? 0),
    skipped,
  };
}

/**
 * Drill values, checked against each drill's own range.
 *
 * A blank cell is "not measured" and is not an error. Something unparseable
 * IS an error — silently dropping a time the importer believes they imported
 * is the failure v1 SPEC section 12 exists to prevent, and it matters more
 * here, where the value may have come from a photo.
 */
function validateDrills(
  template: Template,
  raw: Record<string, string[]>,
  line: number,
  issues: RowIssue[],
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};

  for (const drill of template.drills) {
    const values = raw[drill.key];
    if (!values) continue;

    const attempts: (number | null)[] = [];
    values.slice(0, drill.maxAttempts).forEach((v, i) => {
      const trimmed = (v ?? "").trim();
      if (trimmed === "") {
        attempts.push(null);
        return;
      }
      if (!/^\d{1,3}(\.\d{1,3})?$/.test(trimmed)) {
        issues.push({
          row: line,
          message: `${drill.label} "${trimmed}" (attempt ${i + 1}) is not a number.`,
        });
        attempts.push(null);
        return;
      }
      const n = Number(trimmed);
      if (!(n > drill.valueMin && n <= drill.valueMax)) {
        issues.push({
          row: line,
          message: `${drill.label} ${n} (attempt ${i + 1}) must be between ${drill.valueMin} and ${drill.valueMax} ${drill.unit}.`,
        });
        attempts.push(null);
        return;
      }
      attempts.push(n);
    });

    if (attempts.some((a) => a !== null)) out[drill.key] = attempts;
  }

  return out;
}
