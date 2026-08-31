/**
 * Guard against client components importing server-only code.
 *
 * A "use client" file that imports a VALUE (constant, function, class) from a
 * module which transitively reaches next/headers drags server code into the
 * browser bundle, and the build fails with a message that names the Pages
 * Router and points nowhere useful. Type-only imports are erased at compile
 * and are always safe.
 *
 * This has bitten twice - lib/data/comments.ts and lib/data/tryouts.ts - so
 * it is checked rather than remembered. The fix each time is the same: split
 * the client-safe constants and types into their own module.
 *
 *   npm run verify:imports
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN = ["app", "components", "lib"];

/** Modules that reach the server at runtime. */
const SERVER_MARKERS = ["next/headers", "@/lib/supabase/server"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((d) => {
  try {
    return walk(join(ROOT, d));
  } catch {
    return [];
  }
});

const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** Resolve an "@/..." specifier to a real file on disk. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(ROOT, spec.slice(2));
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (source.has(candidate)) return candidate;
  }
  return null;
}

function isServerAction(file: string): boolean {
  return /^\s*["']use server["']/m.test(source.get(file) ?? "");
}

/** Does this module reach the server, directly or through its imports? */
const serverReach = new Map<string, boolean>();
function reachesServer(file: string, seen = new Set<string>()): boolean {
  if (serverReach.has(file)) return serverReach.get(file)!;
  if (seen.has(file)) return false;
  seen.add(file);

  // A "use server" module is a server ACTION file. Client components are
  // meant to import these - Next replaces them with RPC stubs at build time,
  // so nothing server-side reaches the bundle. It is also a boundary: what
  // the action imports stays behind it.
  if (isServerAction(file)) {
    serverReach.set(file, false);
    return false;
  }

  const text = source.get(file) ?? "";
  if (SERVER_MARKERS.some((m) => text.includes(`"${m}"`))) {
    serverReach.set(file, true);
    return true;
  }
  for (const m of text.matchAll(/from\s+"(@\/[^"]+)"/g)) {
    const dep = resolveAlias(m[1]);
    if (dep && reachesServer(dep, seen)) {
      serverReach.set(file, true);
      return true;
    }
  }
  serverReach.set(file, false);
  return false;
}

const problems: string[] = [];

for (const [file, text] of source) {
  if (!/^\s*["']use client["']/m.test(text)) continue;

  // Every import statement, with its specifier.
  for (const m of text.matchAll(/import\s+([\s\S]*?)\s+from\s+"(@\/[^"]+)"/g)) {
    const clause = m[1];
    const spec = m[2];

    // `import type { X }` is erased entirely - always safe.
    if (/^\s*type\s/.test(clause)) continue;

    const dep = resolveAlias(spec);
    if (!dep || !reachesServer(dep)) continue;

    // A braced clause where EVERY member is `type X` is also erased.
    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      const members = braced[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (members.length > 0 && members.every((x) => x.startsWith("type "))) {
        continue;
      }
    }

    problems.push(
      `${file.replace(ROOT + "\\", "").replace(ROOT + "/", "")}\n` +
        `        imports a VALUE from "${spec}", which reaches the server.\n` +
        `        Split the client-safe constants/types into their own module.`,
    );
  }
}

console.log("=".repeat(70));
console.log("Client components importing server-only modules");
console.log("=".repeat(70));
console.log(`scanned ${source.size} files`);

if (problems.length === 0) {
  console.log("\nALL CHECKS PASS - no client component pulls in server code");
  process.exit(0);
}
for (const p of problems) console.log(`\nFAIL  ${p}`);
console.log(`\n${problems.length} PROBLEM(S)`);
process.exit(1);
