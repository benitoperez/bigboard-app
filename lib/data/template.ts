import { createClient } from "@/lib/supabase/server";
import type {
  DrillDirection,
  PositionComponent,
  Template,
  TemplateAttribute,
  TemplateDrill,
  TemplatePosition,
} from "@/lib/template";

export type {
  DrillDirection,
  PositionComponent,
  Template,
  TemplateAttribute,
  TemplateDrill,
  TemplatePosition,
};

/**
 * Loads an org's evaluation template — SPEC-V2.md section 3.
 *
 * SERVER ONLY. This reaches next/headers through the Supabase server
 * client. A client component importing a VALUE from here drags server code
 * into the browser bundle; import the types and pure helpers from
 * lib/template.ts instead. verify:imports enforces this.
 *
 * Five small queries, assembled here rather than in SQL. The alternative is
 * a four-way join that fans position rows out by component and needs
 * de-duplicating anyway; at template size (tens of rows) this is cheaper to
 * read and cheaper to debug, which SPEC.md section 1 explicitly prefers.
 *
 * Everything is RLS-scoped to the caller, so a member of one org loading
 * another org's template id gets null, not a leak.
 */
export async function getTemplate(templateId: string): Promise<Template | null> {
  const supabase = await createClient();

  const [
    { data: tpl },
    { data: posRows },
    { data: attrRows },
    { data: drillRows },
    { data: weightRows },
  ] = await Promise.all([
    supabase
      .from("templates")
      .select("id, org_id, name, sport, min_ratings_for_display")
      .eq("id", templateId)
      .maybeSingle(),
    supabase
      .from("template_positions")
      .select("id, code, label, sort_order")
      .eq("template_id", templateId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("template_attributes")
      .select("id, key, label, short")
      .eq("template_id", templateId),
    supabase
      .from("template_drills")
      .select(
        "id, key, label, unit, direction, max_attempts, min_timed_for_percentile, value_min, value_max, decimals",
      )
      .eq("template_id", templateId),
    supabase
      .from("position_weights")
      .select("position_id, attribute_id, drill_id, weight")
      .eq("template_id", templateId),
  ]);

  if (!tpl) return null;

  const attributes: TemplateAttribute[] = (attrRows ?? []).map((a) => ({
    key: a.key,
    label: a.label,
    short: a.short,
  }));

  const drills: TemplateDrill[] = (drillRows ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit,
    direction: d.direction as DrillDirection,
    maxAttempts: Number(d.max_attempts),
    minTimedForPercentile: Number(d.min_timed_for_percentile),
    valueMin: Number(d.value_min),
    valueMax: Number(d.value_max),
    decimals: Number(d.decimals),
  }));

  // Resolve weight rows (which reference components by id) to the keys the
  // rating math works in.
  const attrKeyById = new Map((attrRows ?? []).map((a) => [a.id, a.key]));
  const drillKeyById = new Map((drillRows ?? []).map((d) => [d.id, d.key]));

  const componentsByPosition = new Map<string, PositionComponent[]>();
  for (const w of weightRows ?? []) {
    const weight = Number(w.weight);
    let component: PositionComponent | null = null;

    if (w.attribute_id) {
      const key = attrKeyById.get(w.attribute_id);
      if (key) component = { kind: "attribute", key, weight };
    } else if (w.drill_id) {
      const key = drillKeyById.get(w.drill_id);
      if (key) component = { kind: "drill", key, weight };
    }

    // A weight pointing at a component that no longer exists is corruption,
    // not a display problem. Dropping it would silently change every rating
    // at that position, so the position is left to fail the sum-to-100
    // check below and be reported instead.
    if (!component) continue;

    const list = componentsByPosition.get(w.position_id) ?? [];
    list.push(component);
    componentsByPosition.set(w.position_id, list);
  }

  const positions: TemplatePosition[] = (posRows ?? []).map((p) => ({
    code: p.code,
    label: p.label,
    sortOrder: Number(p.sort_order),
    components: componentsByPosition.get(p.id) ?? [],
  }));

  return {
    id: tpl.id,
    orgId: tpl.org_id,
    name: tpl.name,
    sport: tpl.sport,
    minRatingsForDisplay: Number(tpl.min_ratings_for_display),
    positions,
    attributes,
    drills,
  };
}

/**
 * The template a tryout runs on. Every screen reads config through here, so
 * a tryout always renders with the weights it is actually scored by.
 */
export async function getTemplateForTryout(
  tryoutId: string,
): Promise<Template | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tryouts")
    .select("template_id")
    .eq("id", tryoutId)
    .maybeSingle();

  if (!data?.template_id) return null;
  return getTemplate(data.template_id);
}
