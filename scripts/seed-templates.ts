/**
 * Reads the seed templates straight out of supabase/migration-v2.sql.
 *
 * The verification scripts need the seeded positions, attributes, drills and
 * weights as objects. Restating them in TypeScript would create exactly the
 * second source of truth that CLAUDE.md rule 2 exists to prevent - and the
 * drift would be invisible, because both copies would look right in
 * isolation while the app scored prospects on one and the tests passed on
 * the other.
 *
 * So this parses the migration instead. The SQL is the only place the seed
 * numbers live. If someone edits a weight in the migration, the checks move
 * with it; if they edit it badly, the checks fail.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DrillDirection,
  PositionComponent,
  Template,
  TemplateAttribute,
  TemplateDrill,
  TemplatePosition,
} from "../lib/template";

const SQL = readFileSync(
  resolve(import.meta.dirname, "..", "supabase", "migration-v2.sql"),
  "utf8",
);

/** Split one SQL tuple body into fields, respecting single-quoted strings. */
function splitTuple(body: string): string[] {
  const out: string[] = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "'") {
        if (body[i + 1] === "'") { current += "'"; i++; continue; } // escaped ''
        inString = false;
        continue;
      }
      current += ch;
    } else if (ch === "'") {
      inString = true;
    } else if (ch === ",") {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Every top-level (...) tuple in a VALUES list. */
function tuples(list: string): string[][] {
  const rows: string[][] = [];
  let depth = 0;
  let start = -1;
  let inString = false;

  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (inString) {
      if (ch === "'") inString = ch === "'" && list[i + 1] === "'" ? (i++, inString) : false;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === "(") { if (depth === 0) start = i + 1; depth++; }
    else if (ch === ")") { depth--; if (depth === 0 && start >= 0) rows.push(splitTuple(list.slice(start, i))); }
  }
  return rows;
}

/** The body of one `do $tag$ ... $tag$;` block. */
function seedBlock(tag: string): string {
  const open = `$${tag}$`;
  const start = SQL.indexOf(open);
  const end = SQL.indexOf(open, start + open.length);
  if (start < 0 || end < 0) throw new Error(`seed block ${tag} not found`);
  return SQL.slice(start + open.length, end);
}

/** The VALUES list of the first `insert into <table>` in a block. */
function insertValues(block: string, table: string): string[][] {
  const at = block.indexOf(`insert into ${table}`);
  if (at < 0) return [];
  const valuesAt = block.toLowerCase().indexOf("values", at);
  const end = block.indexOf(";", valuesAt);
  return tuples(block.slice(valuesAt + "values".length, end));
}

/** The inline `from (values ...) as w(...)` list used for position weights. */
function weightValues(block: string): string[][] {
  const at = block.indexOf("from (values");
  if (at < 0) return [];
  const end = block.indexOf(") as w(", at);
  return tuples(block.slice(at + "from (values".length, end));
}

function isNull(v: string): boolean {
  return v.toLowerCase() === "null";
}

function parseSeed(tag: string, sport: string): Template {
  const block = seedBlock(tag);

  // insert into templates ... values (v_sys, 'Flag Football', 'flag_football', 3)
  const tplRow = insertValues(block, "templates")[0];
  const name = tplRow[1];
  const minRatingsForDisplay = Number(tplRow[3]);

  // (v_tpl, v_sys, key, label, short)
  const attributes: TemplateAttribute[] = insertValues(
    block,
    "template_attributes",
  ).map((t) => ({ key: t[2], label: t[3], short: t[4] }));

  // (v_tpl, v_sys, key, label, unit, direction, max_attempts,
  //  min_timed_for_percentile, value_min, value_max, decimals)
  const drills: TemplateDrill[] = insertValues(block, "template_drills").map(
    (t) => ({
      key: t[2],
      label: t[3],
      unit: t[4],
      direction: t[5] as DrillDirection,
      maxAttempts: Number(t[6]),
      minTimedForPercentile: Number(t[7]),
      valueMin: Number(t[8]),
      valueMax: Number(t[9]),
      decimals: Number(t[10]),
    }),
  );

  // (v_tpl, v_sys, code, label, sort_order)
  const positionRows = insertValues(block, "template_positions").map((t) => ({
    code: t[2],
    label: t[3],
    sortOrder: Number(t[4]),
  }));

  // (code, attr_key | null, drill_key | null, weight)
  const componentsByCode = new Map<string, PositionComponent[]>();
  for (const w of weightValues(block)) {
    const [code, attrKey, drillKey, weight] = w;
    const component: PositionComponent = isNull(attrKey)
      ? { kind: "drill", key: drillKey, weight: Number(weight) }
      : { kind: "attribute", key: attrKey, weight: Number(weight) };
    const list = componentsByCode.get(code) ?? [];
    list.push(component);
    componentsByCode.set(code, list);
  }

  const positions: TemplatePosition[] = positionRows.map((p) => ({
    ...p,
    components: componentsByCode.get(p.code) ?? [],
  }));

  return {
    id: `seed-${sport}`,
    orgId: "seed",
    name,
    sport,
    minRatingsForDisplay,
    positions,
    attributes,
    drills,
  };
}

export const FLAG_FOOTBALL = parseSeed("seed_flag", "flag_football");
export const BASEBALL = parseSeed("seed_baseball", "baseball");
export const SEEDS = [FLAG_FOOTBALL, BASEBALL];
