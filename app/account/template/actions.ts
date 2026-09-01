"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { getTemplate } from "@/lib/data/template";
import type { PositionComponent } from "@/lib/template";

export type TemplateResult = { ok: true } | { ok: false; error: string };

/**
 * Template editing — SPEC-V2.md section 3.1.
 *
 * Positions, attributes and drills are ordinary RLS-protected table writes
 * (admin+ policies). Weight replacement and component deletion go through
 * security definer RPCs, because neither can be done correctly from the
 * client library: weights must be replaced in ONE transaction to satisfy the
 * sum-to-100 trigger, and deleting a component has to clear ratings or drill
 * results that an admin has no policy to delete.
 *
 * Every position code and attribute key is snake_case / uppercase enforced
 * here so the CSV importer and the rating math can rely on the shape.
 */

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const CODE_RE = /^[A-Z0-9]{1,4}$/;

/** Confirm the caller administers the org that owns this template. */
async function requireTemplateAdmin(
  templateId: string,
): Promise<{ orgId: string } | { error: string }> {
  const { activeOrg, is_admin } = await getOfficer();
  if (!activeOrg) return { error: "No active organization." };
  if (!is_admin) return { error: "Only admins can edit the template." };

  const template = await getTemplate(templateId);
  // Reading it through RLS is itself the check that it belongs to an org the
  // caller can see; comparing to the active org stops an admin of one org
  // editing another's template with a copied id.
  if (!template || template.orgId !== activeOrg.orgId) {
    return { error: "That template does not belong to this organization." };
  }
  return { orgId: activeOrg.orgId };
}

function done(): TemplateResult {
  // Weights feed every board and every profile dial, so a template edit
  // invalidates essentially the whole app.
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------- positions

export async function addPosition(
  templateId: string,
  code: string,
  label: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const c = code.trim().toUpperCase();
  const l = label.trim();
  if (!CODE_RE.test(c)) {
    return { ok: false, error: "Use 1-4 letters or digits, like WR or SS." };
  }
  if (!l) return { ok: false, error: "Give the position a name." };

  const template = await getTemplate(templateId);
  if (template?.positions.some((p) => p.code === c)) {
    return { ok: false, error: `${c} already exists in this template.` };
  }

  const nextOrder =
    Math.max(0, ...(template?.positions.map((p) => p.sortOrder) ?? [0])) + 1;

  const supabase = await createClient();
  const { error } = await supabase.from("template_positions").insert({
    template_id: templateId,
    org_id: auth.orgId,
    code: c,
    label: l,
    sort_order: nextOrder,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

export async function renamePosition(
  templateId: string,
  positionId: string,
  label: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const l = label.trim();
  if (!l) return { ok: false, error: "Give the position a name." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("template_positions")
    .update({ label: l })
    .eq("id", positionId);

  if (error) return { ok: false, error: error.message };
  return done();
}

/**
 * Deleting a position removes its weight rows and nothing else.
 *
 * Prospects listed at that position keep the code in their row — it simply
 * stops resolving, and the data layer drops those rows from the boards
 * rather than crashing. Ratings survive, because attributes are shared
 * across positions and another position may still weight them.
 */
export async function deletePosition(
  templateId: string,
  positionId: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("template_positions")
    .delete()
    .eq("id", positionId);

  if (error) return { ok: false, error: error.message };
  return done();
}

export async function reorderPositions(
  templateId: string,
  orderedIds: string[],
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  // Sequential rather than one upsert: ON CONFLICT DO UPDATE cannot touch
  // the same row twice in a statement, and the board order is a handful of
  // rows changed rarely.
  for (const [i, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from("template_positions")
      .update({ sort_order: i + 1 })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
  }
  return done();
}

// --------------------------------------------------------------- attributes

export async function addAttribute(
  templateId: string,
  key: string,
  label: string,
  short: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const k = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const l = label.trim();
  const s = short.trim().toUpperCase();

  if (!KEY_RE.test(k)) {
    return { ok: false, error: "The key must be lowercase letters, digits and underscores." };
  }
  if (!l) return { ok: false, error: "Give the attribute a name." };
  if (!s || s.length > 4) return { ok: false, error: "Use a short code of 1-4 characters." };

  const template = await getTemplate(templateId);
  if (template?.attributes.some((a) => a.key === k)) {
    return { ok: false, error: `${k} already exists in this template.` };
  }
  // A key shared with a drill would make ratings and results ambiguous.
  if (template?.drills.some((d) => d.key === k)) {
    return { ok: false, error: `${k} is already used by a drill.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("template_attributes").insert({
    template_id: templateId,
    org_id: auth.orgId,
    key: k,
    label: l,
    short: s,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

/**
 * Delete an attribute AND every rating recorded against it.
 *
 * Ratings key on the text attribute_key with no foreign key, so nothing
 * cascades — leaving them would keep a median alive for an attribute the
 * template no longer has. An admin also has no policy to delete another
 * officer's rating, which is why this is an RPC.
 */
export async function deleteAttribute(
  templateId: string,
  attributeId: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_template_attribute", {
    p_attribute: attributeId,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

// ------------------------------------------------------------------- drills

export async function addDrill(
  templateId: string,
  input: {
    key: string;
    label: string;
    unit: string;
    direction: string;
    maxAttempts: number;
    minTimedForPercentile: number;
    valueMin: number;
    valueMax: number;
    decimals: number;
  },
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const k = input.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const l = input.label.trim();
  const u = input.unit.trim();

  if (!KEY_RE.test(k)) {
    return { ok: false, error: "The key must be lowercase letters, digits and underscores." };
  }
  if (!l) return { ok: false, error: "Give the drill a name." };
  if (!u) return { ok: false, error: "Give the drill a unit, like s or mph." };
  if (input.direction !== "lower_is_better" && input.direction !== "higher_is_better") {
    return { ok: false, error: "Say which end of the range is better." };
  }
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 5) {
    return { ok: false, error: "Attempts must be between 1 and 5." };
  }
  if (!(input.valueMin < input.valueMax)) {
    return { ok: false, error: "The minimum must be below the maximum." };
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 3) {
    return { ok: false, error: "Decimals must be between 0 and 3." };
  }
  if (!Number.isInteger(input.minTimedForPercentile) || input.minTimedForPercentile < 1) {
    return { ok: false, error: "The percentile threshold must be at least 1." };
  }

  const template = await getTemplate(templateId);
  if (template?.drills.some((d) => d.key === k)) {
    return { ok: false, error: `${k} already exists in this template.` };
  }
  if (template?.attributes.some((a) => a.key === k)) {
    return { ok: false, error: `${k} is already used by an attribute.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("template_drills").insert({
    template_id: templateId,
    org_id: auth.orgId,
    key: k,
    label: l,
    unit: u,
    direction: input.direction,
    max_attempts: input.maxAttempts,
    min_timed_for_percentile: input.minTimedForPercentile,
    value_min: input.valueMin,
    value_max: input.valueMax,
    decimals: input.decimals,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

/** Delete a drill and every result recorded against it. See deleteAttribute. */
export async function deleteDrill(
  templateId: string,
  drillId: string,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_template_drill", {
    p_drill: drillId,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

// ------------------------------------------------------------------ weights

/**
 * Replace one position's weights — the guardrail that matters most.
 *
 * Weights must sum to exactly 100. It is checked three times: in the editor
 * before Save is enabled, here, and by a deferred constraint trigger in the
 * database. The RPC does the delete and insert inside one transaction so the
 * trigger sees the finished state rather than an empty intermediate one.
 *
 * Editing weights mid-tryout is allowed and takes effect immediately —
 * nothing is stored, the weights are read at compute time. The editor says
 * so on save.
 */
export async function savePositionWeights(
  templateId: string,
  positionId: string,
  components: PositionComponent[],
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  if (components.length === 0) {
    return { ok: false, error: "A position needs at least one weighted input." };
  }
  const sum = components.reduce((s, c) => s + c.weight, 0);
  if (sum !== 100) {
    return { ok: false, error: `Weights must sum to 100. They currently sum to ${sum}.` };
  }
  if (components.some((c) => !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)) {
    return { ok: false, error: "Each weight must be a whole number from 1 to 100." };
  }
  const keys = components.map((c) => `${c.kind}:${c.key}`);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: "The same input is listed twice." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_position_weights", {
    p_position: positionId,
    p_components: components,
  });

  if (error) return { ok: false, error: error.message };
  return done();
}

/** How many ratings or results a component deletion would take with it. */
export async function componentUsage(
  templateId: string,
  key: string,
): Promise<{ ratings: number; results: number }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("component_usage", {
    p_template: templateId,
    p_key: key,
  });

  // The RPC returns a single-row table.
  const row = (data as { rating_count: number; drill_count: number }[] | null)?.[0];
  return {
    ratings: Number(row?.rating_count ?? 0),
    results: Number(row?.drill_count ?? 0),
  };
}

/** The minimum officer inputs before a rating shows. v1 default: 3. */
export async function setMinRatings(
  templateId: string,
  value: number,
): Promise<TemplateResult> {
  const auth = await requireTemplateAdmin(templateId);
  if ("error" in auth) return { ok: false, error: auth.error };

  if (!Number.isInteger(value) || value < 1 || value > 50) {
    return { ok: false, error: "Pick a number between 1 and 50." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("templates")
    .update({ min_ratings_for_display: value })
    .eq("id", templateId);

  if (error) return { ok: false, error: error.message };
  return done();
}
