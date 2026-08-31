# Big Board — Working Rules

Mobile web app for running flag football tryouts. Officers rate prospects from
their phones on the field; the app turns ratings into positional boards.

## 1. SPEC.md is the source of truth

`SPEC.md` governs all schema, logic, positions, attributes, weights, formulas,
and functionality. Read the relevant section before implementing. If the code
and the spec disagree, the spec wins — or the spec gets updated deliberately,
never silently.

## 2. `lib/config/positions.ts` is the only place positions live

Positions, attributes, and weights may be defined in exactly one file:
`lib/config/positions.ts`. Every screen imports from it.

**If a position code, attribute key, label, or weight appears in any other
file, that is a bug — fix it immediately.** This includes SQL, seed data,
test fixtures, and comments that enumerate positions.

The weights stay in TypeScript, never in SQL. SQL does window functions,
TypeScript does the weighting. Two sources of truth for weights is the
failure this rule exists to prevent.

## 3. Sliders save on release only

Save on pointer release. Never on drag, never on change, never on an interval
during interaction. Upsert on `(prospect_id, officer_id, attribute_key)`.

Firing saves during drag lets an older request resolve after a newer one and
overwrite the correct value with a stale one. Apply the new value to local
state immediately, then sync. Never block the UI on the network.

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

Remote is `benitoperez/Player-Eval-Project` on `main`.

**Commit with a clear message and push after completing each numbered build
step** from SPEC.md section 15. One commit per step, not per file.

## Verify these by hand — generated code is not trustworthy here

Per SPEC.md section 16:

- **RLS policies** — test with two accounts in separate browser profiles
- **Slider save race** — confirm saves fire on release only
- **`computePositionRating`** — verify the weighting by hand with fake data;
  wrong weights throw no error, the numbers are just quietly wrong
- **`percent_rank` null handling** in `prospect_speed` — confirm untimed
  prospects are excluded from the window, not ranked as slowest
- **Config drift** — grep for position codes outside `positions.ts`

## Gating rule

Never show a positional rating that is not fully covered. Show progress
instead (`4 of 6 inputs · missing route running`). A barely-rated 91 above a
fully-vetted 84 gets the wrong player cut.

Sort on raw score, never on the 45-99 display band.
