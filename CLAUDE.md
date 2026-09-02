# Big Board — Working Rules

**New to this repo? Read `HANDOFF.md` first.** It carries the current state,
the RLS policy map and why its asymmetries are deliberate, the traps that cost
time during the build (Next 16's `proxy.ts`, the client/server import
boundary, `getClaims`), and an honest list of what is and is not verified.
`SPEC.md` is the source of truth for behaviour; `HANDOFF.md` covers everything
the spec does not.


Mobile web app for running flag football tryouts. Officers rate prospects from
their phones on the field; the app turns ratings into positional boards.

## 1. SPEC-V2.md is the source of truth

`SPEC-V2.md` governs v2: multi-tenancy, roles, DB templates, onboarding, AI,
lifecycle. `SPEC.md` is the v1 document and stays useful for the rating math,
the gating rule and the field-usability reasoning it explains at length —
where the two disagree, **v2 wins**.

Read the relevant section before implementing. If the code and the spec
disagree, the spec wins — or the spec gets updated deliberately, never
silently.

## 2. The database template is the only place positions live

**Changed in v2.** `lib/config/positions.ts` is DELETED. Positions,
attributes, drills and weights are org-owned rows, loaded through
`lib/data/template.ts` and shaped by `lib/template.ts`.

**If a position code, attribute key, drill key or weight is written out
anywhere except the seed blocks in `supabase/migration-v2.sql`, that is a
bug — fix it immediately.** That includes fixtures, comments that enumerate
positions, and "helpful" fallbacks.

The rule survives its own move: weights still live in exactly one place, and
they are still applied in TypeScript. SQL does the window functions
(medians, percentiles); `computePositionRating` does the weighting.

`scripts/seed-templates.ts` PARSES the migration rather than restating it,
for this reason. Do not replace it with a hand-written copy.

## 3. Sliders never save by themselves

**Changed in v2.** v1 saved on pointer release; the form now saves only when
the officer presses Save — per attribute, or all pending at once. Upsert on
`(prospect_id, officer_id, attribute_key)`.

What has NOT changed is the reason the original rule existed: **a drag must
never touch the network.** Firing saves during drag lets an older request
resolve after a newer one and overwrite a correct value with a stale one,
silently. Explicit save is strictly safer than save-on-release, because
nothing is ever in flight to be superseded.

`onChange` updates local state only. Never block the UI on the network.

## 4. Never animate the slider drag with framer-motion

The slider handle follows the pointer through native input/CSS only.
framer-motion is for screen transitions, dials, and list animation — never
for drag tracking. Motion on the drag path adds latency and desyncs the
handle from the finger, which is unusable with gloves in the sun.

## 5. Screenshots are style-only, never structure

`reference/` holds JPG exports of the Figma mockup. Use them for colors,
typography, spacing, corner radii, and overall feel.

**Do not take structure, positions, player data, or rating displays from
them.** Their content is outdated placeholder — the mockups show RB/CB/S,
which do not exist in this app. All structure comes from SPEC.md.

## 6. Never modify RLS policies without flagging first

Row level security is the highest-risk part of this build and it fails
silently — a bad policy either lets everyone edit everything or blocks all
writes while looking like a frontend bug.

**Any change to a policy, or to a table's RLS state, stops and asks first.**
Do not "fix" a failing write by loosening a policy. Diagnose it, then raise it.

## 7. Mobile-first, dark, high-contrast

Used outdoors in direct sunlight, one-handed, often gloved.

- Design at phone width first; larger screens are a bonus
- Dark theme, high contrast, no low-contrast gray-on-gray
- Minimum 44px tap targets; slider handles larger still
- Nothing more than 2 taps away
- Optimistic writes, small payloads — assume flaky stadium wifi

## 8. Git workflow

Remote is `benitoperez/bigboard-app` on `main`.

**Commit with a clear message and push after completing each numbered build
step** from SPEC-V2.md section 10. One commit per step, not per file.

`main` is deployed. Tags: `v1.0` is the pre-multi-tenancy app, `v2.0` is the
first multi-tenant release.

**Migrations are append-only.** `migration.sql` and `migration-v2.sql` have
both run against the live database and must never be edited. A schema change
is a new numbered file.

## Verify these by hand — generated code is not trustworthy here

Per SPEC.md section 16:

- **RLS policies** — test with two accounts in separate browser profiles.
  In v2 this also means two ORGS: org A must never read org B
- **Cross-org scoping** — RLS admits every org a user belongs to, so a query
  that forgets `.eq("org_id", activeOrg.orgId)` silently mixes clubs for
  anyone in two of them. This has already happened once, in `tryouts`
- **Slider saves** — confirm a drag writes nothing at all
- **`computePositionRating`** — verify the weighting by hand with fake data;
  wrong weights throw no error, the numbers are just quietly wrong
- **`percent_rank` null handling** in `prospect_drill_stats` — confirm
  unmeasured prospects are excluded from the window, not ranked last, and
  that `direction` orders each drill the right way round
- **Config drift** — `npm run verify:templates`
- **Renamed tables** — PostgREST resolves table names at RUNTIME, so a stale
  one fails in production and nowhere else. `npm run verify:imports` checks

## Gating rule

Never show a positional rating that is not fully covered. Show progress
instead (`4 of 6 inputs · missing route running`). A barely-rated 91 above a
fully-vetted 84 gets the wrong player cut.

Sort on raw score, never on the 45-99 display band.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
