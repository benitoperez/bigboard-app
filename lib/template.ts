/**
 * Client-safe template types and helpers — SPEC-V2.md section 3.
 *
 * In v1, positions/attributes/weights were compile-time constants in
 * lib/config/positions.ts. In v2 they are org-owned database rows, so this
 * module holds only the SHAPE and the pure functions over it; the rows come
 * from lib/data/template.ts, which reaches next/headers and must never be
 * imported by a client component (the v1 trap that bit twice).
 *
 * A position's judged-attribute list is DERIVED from its weight rows. There
 * is no separate attribute list, so there is nothing to drift out of sync —
 * this is what structurally keeps hitting sliders off a pure pitcher.
 */

export type DrillDirection = "lower_is_better" | "higher_is_better";

export type TemplateAttribute = {
  key: string;
  label: string;
  /** Short code for dense UI — "CTH", "CON". */
  short: string;
};

export type TemplateDrill = {
  key: string;
  label: string;
  /** "s", "mph". Display only. */
  unit: string;
  /**
   * Which end is good. Drives both the best-attempt pick (min vs max) and
   * the percentile ordering. A 40 time is lower_is_better; an exit velocity
   * is higher_is_better; the rating math must never assume either.
   */
  direction: DrillDirection;
  maxAttempts: number;
  /**
   * How many prospects in the class need a result before this drill's
   * percentile means anything. Below it the component counts as MISSING,
   * which gates the rating — a rating built on a meaningless percentile is
   * worse than no rating.
   */
  minTimedForPercentile: number;
  valueMin: number;
  valueMax: number;
  decimals: number;
};

/** One weighted input to a position's rating: a judged attribute or a drill. */
export type PositionComponent =
  | { kind: "attribute"; key: string; weight: number }
  | { kind: "drill"; key: string; weight: number };

export type TemplatePosition = {
  code: string;
  label: string;
  /** Board display order. Replaces v1's BOARD_ORDER constant. */
  sortOrder: number;
  /** Weights sum to exactly 100. Enforced in UI, server, and a DB trigger. */
  components: PositionComponent[];
};

export type Template = {
  id: string;
  orgId: string;
  name: string;
  sport: string;
  /** Total officer inputs required before a rating shows. v1 default: 3. */
  minRatingsForDisplay: number;
  positions: TemplatePosition[];
  attributes: TemplateAttribute[];
  drills: TemplateDrill[];
};

export function getPosition(t: Template, code: string): TemplatePosition | null {
  return t.positions.find((p) => p.code === code) ?? null;
}

export function isPositionCode(t: Template, v: unknown): v is string {
  return typeof v === "string" && t.positions.some((p) => p.code === v);
}

export function getAttribute(t: Template, key: string): TemplateAttribute | null {
  return t.attributes.find((a) => a.key === key) ?? null;
}

export function getDrill(t: Template, key: string): TemplateDrill | null {
  return t.drills.find((d) => d.key === key) ?? null;
}

/** Positions in board order. */
export function boardOrder(t: Template): TemplatePosition[] {
  return [...t.positions].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The judged attributes a prospect gets sliders for: the UNION across every
 * position they play, deduped. A shared attribute is rated once and counts
 * toward every position that weights it. This is also what covers baseball
 * two-way players with no new mechanics — P plus a field position simply
 * unions to both sets.
 */
export function attributeUnion(t: Template, codes: string[]): TemplateAttribute[] {
  const keys = new Set<string>();
  for (const code of codes) {
    for (const c of getPosition(t, code)?.components ?? []) {
      if (c.kind === "attribute") keys.add(c.key);
    }
  }
  return t.attributes.filter((a) => keys.has(a.key));
}

/** The measured drills that matter for the positions a prospect plays. */
export function drillUnion(t: Template, codes: string[]): TemplateDrill[] {
  const keys = new Set<string>();
  for (const code of codes) {
    for (const c of getPosition(t, code)?.components ?? []) {
      if (c.kind === "drill") keys.add(c.key);
    }
  }
  return t.drills.filter((d) => keys.has(d.key));
}

/**
 * A measured value with its unit — "4.61s", "88.5mph".
 *
 * Decimals come from the drill, not from the value: a 40 time is always two
 * places even when it lands on 4.60, and a velocity read to one place should
 * not render three because a percentile computation produced them.
 */
export function formatDrillValue(drill: TemplateDrill, value: number): string {
  return `${value.toFixed(drill.decimals)}${drill.unit}`;
}

/** Human label for a component, for progress lines and the weight editor. */
export function componentLabel(t: Template, c: PositionComponent): string {
  const found =
    c.kind === "attribute" ? getAttribute(t, c.key) : getDrill(t, c.key);
  return found?.label ?? c.key.replace(/_/g, " ");
}

/**
 * Weights must sum to exactly 100 per position — the one guardrail shared by
 * seeded templates and the from-scratch builder. Returns the offending
 * positions so the editor can name them rather than just refusing to save.
 */
export function weightErrors(t: Template): string[] {
  const errors: string[] = [];
  for (const p of t.positions) {
    if (p.components.length === 0) {
      errors.push(`${p.code} has no weighted components`);
      continue;
    }
    const sum = p.components.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) errors.push(`${p.code} weights sum to ${sum}, not 100`);
  }
  return errors;
}
