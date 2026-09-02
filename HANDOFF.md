# Big Board — V1 Handoff

Written at the end of the build session that took this from an empty repo to a
deployed app. Everything here is either verified against the live database or
flagged as unverified. `SPEC.md` remains the source of truth for behaviour;
this document covers **state, decisions, and traps** that the spec does not.

---

## 1. What this is

Mobile web app for running flag football tryouts at NCSU Club Flag Football.
Officers rate prospects from their phones on the field; the app turns those
ratings into positional boards that drive roster decisions. Replaces a shared
Excel sheet.

| | |
|---|---|
| Repo | `benitoperez/bigboard-app` (renamed from Player-Eval-Project), branch `main` |
| Stack | Next.js 16.3.3 (App Router), React 19.2.8, TypeScript, Tailwind **v4** |
| Database | Supabase Postgres 17, project ref `qmcjtynomaezbcjdbxzk` |
| Hosting | Vercel, auto-deploys from `main` |
| Extras | `framer-motion`, `papaparse`, `@supabase/ssr`, `tsx` (dev) |

---

## 2. Current state

All 12 build-order steps in `SPEC.md` §15 are complete, plus two rounds of
requested changes. 25 commits.

**Live data** (as of handoff): 1 tryout class ("2026 Fall Tryouts", active),
40 prospects, ~108 ratings, ~38 drill results, 5 selections, 3 comments, 1
officer. The prospects are **fake seed data** — real rosters get imported by
CSV. Counts drift upward with real usage; that is expected.

**Screens:** `/login`, `/` (position boards + KPI strip), `/players`
(directory, search, filters, add athlete), `/players/[id]` (profile, sliders,
40 entry, comments, headshot, admin delete), `/selected` (shared team list),
`/account` (profile, tryout class picker, CSV import, danger zone).

---

## 3. Getting a new session running

`.env.local` exists locally and is **gitignored** — verified never committed at
any point in history. It holds:

```
NEXT_PUBLIC_SUPABASE_URL=https://qmcjtynomaezbcjdbxzk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Both are `NEXT_PUBLIC_*` and ship in the browser bundle **by design** — the
anon key is public, and RLS is what protects the data. The same two vars are
set in Vercel → Settings → Environment Variables. **Vercel does not apply new
env vars to an existing build; a redeploy is required.**

The `service_role` key appears nowhere in the repo and must never be added.

```bash
npm run dev        # local
npm run build      # production build (also typechecks)
npm run verify     # all four verification suites
npm run seed:dev   # regenerate fake data → stdout SQL (does not run it)
```

---

## 4. Where things live

```
lib/config/positions.ts   THE source of positions, attributes, weights
lib/ratings.ts            computePositionRating, compareForBoard, missingComponents
lib/rating-color.ts       the one number→colour mapping
lib/csv/roster.ts         CSV validation, pure (no Supabase, no papaparse)
lib/images.ts             headshot resize + EXIF handling
lib/auth.ts               getOfficer() — session AND officers-row check
lib/tryouts.ts            CLIENT-SAFE tryout types/helpers
lib/comments.ts           CLIENT-SAFE comment types/limits
lib/data/*                server-only reads (import next/headers)
lib/supabase/{client,server,proxy}.ts
proxy.ts                  route protection (NOT middleware.ts — see §6)
scripts/verify-*.ts       four verification suites
supabase/migration.sql    full schema + RLS + storage, matches live DB
supabase/seed.sql         one tryout + one officer, placeholder UUID
```

---

## 5. RLS policies, and why they are asymmetric

This is the highest-risk area (`SPEC.md` §16) and the asymmetries are
**deliberate**. Do not "tidy" them into consistency.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `tryouts` | all | **admin** | **admin** | **none** |
| `officers` | all | none | none | none |
| `prospects` | all | any officer | any officer | **admin** |
| `ratings` | all | own | own | **own** |
| `drill_results` | all | self-stamped | any officer | **any officer** |
| `selections` | all | self-stamped | — | any officer |
| `comments` | all | own | — | **own** |
| `storage.objects` | all | all | all | all (bucket-scoped) |

**The reasoning, which is easy to lose:**

- **A rating is one officer's opinion**, so only he may change or withdraw it.
- **A 40 time is a measurement** anyone present can see is wrong, so anyone may
  correct or clear it. A fat-fingered 5.9 sitting in the system all day is
  worse than a small trust risk among fifteen people who know each other.
- **A comment is one officer's words**, so nobody else retracts them.
- **Deleting a prospect is destruction, not collaboration** — it cascades away
  every rating, time, selection and comment about him — so it is admin-only
  even though adding and editing are open.
- **`tryouts` has no DELETE policy at all.** A class is the historical record;
  deleting one would cascade away an entire season. This means **a class
  created with a typo is currently permanent** — there is no rename UI either,
  though the admin UPDATE policy would allow one.

**Both views use `security_invoker = true`.** Without it they would bypass the
RLS of the tables underneath and expose every rating to `anon`. Verified set.

**Headshots bucket is PRIVATE.** `prospects.headshot_url` stores the storage
**path**, not a URL — signed URLs expire and would leave dead links in the
database within the hour. They are minted at render time, batched per screen.

---

## 6. Traps that cost time in this session

Each of these was hit for real. A fresh session is likely to hit them again.

**Next.js 16 renamed `middleware.ts` → `proxy.ts`.** `PROXY_FILENAME = 'proxy'`
in `node_modules/next/dist/lib/constants.js`; middleware is deprecated.
Writing `middleware.ts` from memory produces **no error and no route
protection**.

**Use `getClaims()`, not `getSession()` or `getUser()`, in server code.**
`getSession()` does not revalidate the JWT. `getClaims()` verifies the
signature against the project's published keys every call.

**A client component must never import a VALUE from a module that reaches
`next/headers`.** Types are erased at compile; constants and functions are not.
This bit twice (comments, then tryouts) and the build error unhelpfully names
the Pages Router. `npm run verify:imports` now catches it. Server *action*
files (`"use server"`) are exempt — importing those from client components is
the intended pattern.

**Tailwind v4 is CSS-first.** There is no `tailwind.config.ts`; tokens live in
an `@theme` block in `app/globals.css`.

**Supabase Storage upsert needs INSERT + SELECT + UPDATE together.** With only
INSERT, new uploads work and replacements silently fail.

**`ON CONFLICT DO UPDATE` cannot touch the same row twice in one statement.**
Split into sequential statements.

**Two Supabase advisor warnings are false positives.** `public.rls_auto_enable()`
is flagged as an `anon`-callable `SECURITY DEFINER` function. It returns
`event_trigger`, and calling it raises `0A000 — trigger functions can only be
called as triggers`. It is a platform-installed safety feature that
auto-enables RLS on new tables. Nothing to fix.

---

## 7. Decisions a fresh session might undo by accident

- **`lib/config/positions.ts` is the only place positions, attributes, or
  weights may be defined** (CLAUDE.md rule 2). Weights stay in TypeScript,
  never in SQL — SQL does window functions, TypeScript does weighting. The dev
  seed generator *reads* the config rather than restating it, for this reason.
- **Sliders save on pointer/key RELEASE only.** `onChange` updates local state
  and never touches the network. Saves carry a sequence number so a superseded
  response is discarded. Firing per drag event lets a stale response overwrite
  a correct value, silently.
- **No framer-motion anywhere on the slider drag path** (CLAUDE.md rule 4).
  It is still fine for screen transitions and dials. Nothing imports it yet.
- **Boards sort on `raw`, never on the 45–99 display number.** The band
  compresses real gaps: raw 74.0 and 74.5 both render as 85. Sorting on the
  display value would call that a tie.
- **Never show a rating that is not fully covered.** Show progress instead
  (`4 of 6 inputs · missing route running`). Gated prospects sort to the bottom
  at reduced opacity rather than being hidden.
- **Speed is a percentile within the tryout class**, never an absolute scale,
  and is hidden until `MIN_TIMED_FOR_PERCENTILE` (15) prospects are timed.
  Below that, speed counts as *missing*, which gates every rating — deliberate,
  because a rating built on a meaningless percentile is worse than none.
- **The CSV import writes three tables** and cannot use one transaction from
  the client library. On failure it deletes the just-inserted prospects, which
  cascades the rest away. Do not "simplify" that rollback out.
- **Screenshots in `reference/` are style-only.** They show RB/CB/S, which are
  not positions in this app. Structure comes from `SPEC.md`.

---

## 8. What is verified, and what is not

**Verified by machine** (`npm run verify`, ~130 assertions):

- `verify:rating` — weighting hand-checked against arithmetic for four
  positions, both band edges, all three gates, board ordering incl. the
  display-band collision
- `verify:roster` — 47 dirty-data cases for the CSV format
- `verify:color` — every band boundary from both sides, plus a 0–100 sweep
- `verify:imports` — client/server import boundary

**Verified against the live database:** upsert conflict targets, CSV
atomicity, three-table rollback, delete cascade, `percent_rank` excluding
untimed prospects, speed percentile re-ranking the cohort, tryout class
isolation, view `security_invoker`, comment length constraints.

**Verified visually:** dial arcs and all seven colour bands; the headshot
resize pipeline (4032×3024 / 11.17 MB → 400×300 / 35 KB, aspect preserved,
small images not upscaled).

**NOT verified — genuine gaps:**

1. **Own-rows-only RLS on `ratings` and `comments` has never been tested with
   two accounts.** The policies are declared correctly but enforcement is
   untested. `SPEC.md` §16 calls this the most common Supabase failure. One
   throwaway account and two browser profiles settles it.
2. **EXIF rotation is untested.** Synthetic test images carry no EXIF tag. The
   code relies on `createImageBitmap(file, { imageOrientation: "from-image" })`
   rather than a hand-rolled parser. One real sideways iPhone photo confirms it.
3. **No rendered page was ever loaded with an authenticated session by the
   assistant** — RLS requires a session and no credentials were available.
   Route protection was verified by redirect behaviour only.
4. **Leaked-password protection is disabled** in Supabase Auth. Enable before
   the repo or app goes public: Auth → Providers → Password.

---

## 9. Undo points

```
pre-csv-v2             before the Google Sheets CSV format rewrite
pre-tryout-classes     before multi-season classes + manual athlete add
pre-tweaks-2026-08-31  before the first tweak round (full build order only)
```

`git reset --hard <tag>` locally, or `git checkout <tag>` to look.

**Database changes are NOT covered by these tags.** Schema and RLS were applied
live via SQL as the code was written. `supabase/migration.sql` is kept in sync
and is the authoritative record — running it fresh reproduces the current
database.

---

## 10. Reasonable next steps

Nothing is broken. In rough order of value:

1. Close gap #1 (two-account RLS test) — highest risk, ~5 minutes
2. Enable leaked-password protection
3. Import a real roster and delete the 40 fake prospects (Account → danger zone)
4. Create the officer accounts — auth user **plus** a matching `officers` row;
   missing the second gives a clear "Account not finished" screen with the UUID
   to paste
5. Rename UI for tryout classes, if a typo'd class name becomes annoying
6. `SPEC.md` §17 lists what is deliberately out of scope for v1 — rater bias
   normalization is the most interesting future item once there is enough data
