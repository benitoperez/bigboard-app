# Big Board — V2 Spec

V2 turns Big Board from a single-club flag football tryout app into a
multi-tenant, multi-sport evaluation platform with role-based access,
DB-driven sport templates, public onboarding, and AI assistance.

This document governs all v2 behaviour. Where it conflicts with `SPEC.md`
(v1), **this document wins for v2**. Where it is silent, v1 behaviour
carries forward unchanged — the rating math, the gating rule, the slider
save discipline, the mobile/sunlight design rules, and the 45–99 display
band are all untouched.

All v2 work happens on branch `v2`. `main` stays deployable v1 (tagged
`v1.0`) until v2 merges.

---

## 1. Every v1 assumption v2 breaks

Each of these is flagged again inline with **⚠ BREAKS V1** where it lands.
This is the consolidated list; nothing breaks that is not on it.

| # | V1 assumption (source) | What v2 does instead |
|---|---|---|
| B1 | "Every officer has the same permissions" (SPEC §1) | Four roles: owner, admin, evaluator, viewer |
| B2 | `lib/config/positions.ts` is the single source of truth for positions/attributes/weights (CLAUDE.md rule 2, SPEC §4) | Config moves to org-owned DB tables. `positions.ts` survives only as the flag football **seed definition** consumed by the migration — no runtime code imports it |
| B3 | "Weights stay in TypeScript, never in SQL" (CLAUDE.md rule 2) | Weights live in SQL **rows** (data, per-org). The rule's real target survives: weights still never appear in SQL *logic* — views/window functions stay weight-free, TypeScript still does all weighting at compute time. One source of truth is preserved; it just moved |
| B4 | No signup flow; accounts created by hand (SPEC §2, §11) | Public signup with required email confirmation |
| B5 | `officers` table with `is_admin` boolean | Replaced by global `profiles` + per-org `memberships(role)`. `is_admin` dies |
| B6 | One implicit tenant; `read_all ... to authenticated using (true)` on every table (SPEC §6) | Every policy rewritten to check org membership and role. An authenticated user sees **nothing** outside their orgs |
| B7 | Speed/40 is a special case: one hardcoded drill, `drill_key default 'forty'`, weight key `"speed"` (SPEC §3, §5) | Generalized measured drills, N per template, each with a direction flag and per-position weights like judged attributes. The flag football seed maps the v1 `speed` weight to the `forty` drill |
| B8 | `drill_results` CHECK `value > 0 and value < 20` (SPEC §5) | Forty-specific range dies. Per-drill `value_min`/`value_max` live on `template_drills`; DB keeps only `value > 0` |
| B9 | `prospect_speed` view, forty-only, always lower-is-better (SPEC §7) | Generalized `prospect_drill_stats` view, per drill, direction-aware |
| B10 | Any authenticated user can add/edit prospects; admin deletes (HANDOFF §5) | INSERT/UPDATE prospects → evaluator+ within the org; DELETE stays admin+. Viewer writes nothing, anywhere |
| B11 | Anyone authenticated can record/correct drill times (SPEC §5) | Evaluator+ **within the org** only |
| B12 | Gating thresholds and board order are compile-time constants (SPEC §4) | Per-template DB columns (`min_ratings_for_display`, per-drill `min_timed_for_percentile`, `max_attempts`, position `sort_order`) seeded from the v1 constants |
| B13 | `PositionKey` / `AttributeKey` are static TS union types | Positions and attribute keys become runtime strings validated against the tryout's template. Type safety shifts from the compiler to load-time validation |
| B14 | CSV import columns `forty_1`/`forty_2` are fixed (SPEC §12) | Drill columns are template-driven: `{drill_key}_1 … {drill_key}_N` per measured drill |
| B15 | One Account screen, admin gated by `is_admin` (SPEC §10.5) | One Account screen rendered by role with owner/admin sections |
| B16 | No external API calls; everything is Supabase (SPEC §2) | Server-only `/api` routes call Gemini. A true server secret exists for the first time |
| B17 | Users live forever once created | Nightly pg_cron lifecycle deletes stale accounts |
| B18 | `supabase/migration.sql` is the whole schema story (HANDOFF §9) | v2 ships `supabase/migration-v2.sql` applied **on top**. The v1 file is never edited |
| B19 | `verify:rating` and `seed:dev` read `positions.ts` at runtime | They read the seed definitions / DB template instead |
| B20 | KPI strip hardcodes "fastest 40" (SPEC §10.1) | KPI shows best result per measured drill, direction-aware |
| B21 | Headshot storage path is `{prospect_id}` scoped only by bucket (HANDOFF §5) | Paths become `{org_id}/{prospect_id}…`; storage policies check org membership on the path's first segment |
| B24 | Position boards are the dashboard's primary view (SPEC §10.1) | Overall rating, highest first, is the default sort. Boards are one tap away and unchanged — only the order they are offered in moved |
| B23 | CSV import is admin-only (SPEC §12) | Import is evaluator+; export is the admin-gated direction instead (§10b.1) |
| B22 | CLAUDE.md rules 1, 2, 6, 8 as written | Need rewriting when v2 merges (see §12). Until merge, this spec is the flag that rule 6 (never touch RLS silently) demands |

**Not broken, deliberately:** the exact `computePositionRating` math and
45–99 band; sort on raw, never display; median team rating; sliders save on
release only; no framer-motion on the drag path; the gating rule; optimistic
writes; CSV whole-file validation with readable errors and three-table
rollback; prospects are data rows, never auth users; per-class percentiles,
never absolute; `reference/` screenshots are style-only.

---

## 2. Multi-tenancy

### 2.1 New tables

```sql
create table orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

-- Global per-user row. Replaces v1 `officers`. NO org_id — a user can
-- belong to several orgs; org affiliation lives in memberships. This is
-- the one deliberate exception to "every table gains org_id".
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('owner','admin','evaluator','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Exactly one owner per org, enforced by the database, not convention.
create unique index one_owner_per_org on memberships (org_id)
  where role = 'owner';

create table invite_codes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  role       text not null check (role in ('evaluator','viewer')),
  code       text not null unique,
  rotated_at timestamptz not null default now(),
  unique (org_id, role)
);
```

- **⚠ BREAKS V1 (B5):** the migration renames `officers` → `profiles` and
  drops `is_admin`. Existing FKs from `ratings`, `drill_results`,
  `selections`, `comments` follow the rename untouched.
- The `role` CHECK on `invite_codes` is the hard guarantee behind
  "**admin is granted by promotion only, never by invite code**." There is
  no admin code and the schema cannot express one.
- One row per (org, role): each org has exactly one live evaluator code and
  one live viewer code at all times, created with the org.

### 2.2 Roles

| Capability | viewer | evaluator | admin | owner |
|---|---|---|---|---|
| Read boards, profiles, comments, drill results | ✔ | ✔ | ✔ | ✔ |
| Rate prospects (sliders) | | ✔ | ✔ | ✔ |
| Record / correct drill times | | ✔ | ✔ | ✔ |
| Select / deselect prospects | | ✔ | ✔ | ✔ |
| Comment (delete own only) | | ✔ | ✔ | ✔ |
| Add / edit prospects (manual add, positions, headshots) | | ✔ | ✔ | ✔ |
| CSV import | | | ✔ | ✔ |
| Hard-delete prospects and their data | | | ✔ | ✔ |
| Create / manage tryout classes | | | ✔ | ✔ |
| Edit template (positions, attributes, drills, weights) | | | ✔ | ✔ |
| Manage members (remove evaluator/viewer, change ≤ their own tier) | | | ✔ | ✔ |
| Rotate invite codes | | | ✔ | ✔ |
| Use AI features | | ✔ | ✔ | ✔ |
| Promote / demote **admins** | | | | ✔ |
| Transfer ownership | | | | ✔ |
| Delete org | | | | ✔ |

Owner is a superset of admin everywhere. Admins cannot touch other admins
or the owner. Nobody edits their own role. An owner cannot leave the org —
they transfer ownership first (the one-owner index makes any other path a
constraint violation, which is the point).

- **⚠ BREAKS V1 (B1):** the flat "every officer is equal" model is gone.
- **⚠ BREAKS V1 (B10):** prospect add/edit narrows from any authenticated
  user to evaluator+ within the org. Evaluators keep manual athlete add,
  the add-position button, and headshot upload; viewers write nothing.
  CSV import and prospect deletion stay admin+.

### 2.3 Invite codes

- Format: `EVAL-XXXX` / `VIEW-XXXX`, where `XXXX` is 4 chars from the
  unambiguous alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I).
  ~1M combinations per prefix; collisions are retried on generation.
  Human-readable on purpose — these get shouted across a field and texted.
- **Rotate** = a single button per code (admin+). It UPDATEs the row's
  `code` in place. The old string stops joining instantly. Because
  membership is a separate table, rotation **never removes existing
  members** — the requirement falls out of the schema.
- Codes are readable only by admin+ of that org. Redemption by non-members
  happens through the `join_org` RPC (§2.6), never a direct SELECT, so the
  codes table leaks nothing.

### 2.4 `org_id` on every existing table

`tryouts`, `prospects`, `ratings`, `drill_results`, `selections`, and
`comments` each gain `org_id uuid not null references orgs(id) on delete
cascade`, backfilled by the migration (§8). It is denormalized onto the leaf
tables on purpose: RLS policies check `org_id` on the row directly instead
of joining through `prospects` → `tryouts` on every read, which keeps
policies simple, fast, and auditable.

Integrity of the denormalization: `org_id` on child rows is set by the
server code from the parent row at insert time, and a `BEFORE INSERT`
trigger per child table re-derives it from the parent (`prospect_id` /
`tryout_id`) and overwrites whatever the client sent. The client cannot
lie about `org_id`.

`profiles` is the flagged exception (§2.1). Storage: headshot paths become
`{org_id}/{prospect_id}/…` and storage policies parse the first path
segment (**⚠ BREAKS V1 (B21)** — existing objects are moved by the
migration).

### 2.5 RLS rewrite

**⚠ BREAKS V1 (B6):** every v1 policy is dropped and rewritten. This
section is the stop-and-ask that CLAUDE.md rule 6 requires — nothing lands
until this spec is approved.

**The recursion trap (do not skip this).** Policies on `memberships` that
query `memberships` recurse and error. All role checks go through one
`security definer` helper in a schema PostgREST does not expose:

```sql
create schema if not exists app;

create or replace function app.org_role(p_org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select role from memberships
  where org_id = p_org and user_id = auth.uid()
$$;

revoke all on function app.org_role(uuid) from public, anon;
grant execute on function app.org_role(uuid) to authenticated;
```

Convenience predicates built on it: `app.is_member(org)`,
`app.is_evaluator(org)` (evaluator/admin/owner), `app.is_admin(org)`
(admin/owner), `app.is_owner(org)`.

**Policy map.** The v1 asymmetries (HANDOFF §5) survive inside the org,
re-expressed per role. Do not "tidy" them.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `orgs` | member | via RPC only | admin+ (rename) | owner (via RPC) |
| `profiles` | own row, plus profiles of co-members | own row (signup) | own row | cascade from auth only |
| `memberships` | member (see own org's roster) | via RPC only | via RPC only | admin+ removing ≤ their tier; any member deleting **own** row (leave org, owner blocked) |
| `invite_codes` | admin+ | migration/RPC only | admin+ (rotate) | none |
| `tryouts` | member | admin+ | admin+ | **none** (still the historical record) |
| `prospects` | member | evaluator+ | evaluator+ | admin+ |
| `ratings` | member | evaluator+ **and own** | own | own |
| `drill_results` | member | evaluator+ self-stamped | evaluator+ (any row) | evaluator+ (any row) |
| `selections` | member | evaluator+ self-stamped | — | evaluator+ (any row) |
| `comments` | member | evaluator+ **and own** | — | own |
| templates (all 5 tables, §3.1) | member | admin+ | admin+ | admin+ |
| `ai_usage` | admin+ (own org) | via server route (self-stamped) | none | none |
| `storage.objects` (headshots) | member of path org | evaluator+ of path org | evaluator+ of path org | evaluator+ of path org |

Reasoning that must not be lost, updated from v1:

- A rating is still one person's opinion — own rows only, even for owner.
- A drill time is still a measurement anyone present can correct —
  **within the org, evaluator and up**. Viewers correct nothing.
- A comment is still one person's words — nobody else deletes it, no role
  overrides that.
- Deleting a prospect is still destruction → admin+.
- `tryouts` still has no DELETE policy. A season is the historical record.
  v2 adds the rename UI (admin UPDATE) that v1 lacked, so a typo'd class
  is no longer permanent — but it is still undeletable.
- `memberships` INSERT/role-UPDATE go through RPCs (§2.6) because the
  invariants (one owner, no self-promotion, invite-code role binding,
  admins-can't-touch-admins) are cross-row rules RLS cannot express
  cleanly. Storage upsert still needs INSERT + SELECT + UPDATE together
  (HANDOFF §6 trap).

All views are recreated with `security_invoker = true`, same as v1, same
reason.

### 2.6 RPCs (security definer, `public`, authenticated-only)

Each validates everything itself — being `security definer`, they trust
nothing from the caller. All are single transactions.

- `create_org(name text, template_slug text) returns uuid` — requires a
  confirmed session and (for v2's copy-on-create model) a valid seed slug
  (`flag_football` | `baseball` | `scratch`); creates the org, copies the seed template
  into it (§3.5), inserts the caller as **owner**, generates both invite
  codes.
- `join_org(code text) returns uuid` — looks up the code, inserts the
  caller as a member **at that code's role**, idempotent-safe error if
  already a member. This is the only path a code touches.
- `rotate_invite_code(org uuid, invite_role text)` — admin+.
- `set_member_role(org uuid, member uuid, new_role text)` — promote/demote
  within the matrix in §2.2: admin+ may set evaluator↔viewer; **owner only**
  for granting or revoking admin; never targets the owner; never yourself.
- `transfer_ownership(org uuid, new_owner uuid)` — owner only; target must
  be an existing member; demotes caller to admin and promotes target to
  owner in one transaction (ordered so the one-owner index never trips).
- `remove_member(org uuid, member uuid)` — admin+ removing below their
  tier; removing yourself = leaving (owner refused).
- `delete_org(org uuid)` — owner only; cascades everything including
  storage objects (deleted by the same routine).

---

## 3. Templates

**⚠ BREAKS V1 (B2, B3, B12, B13):** `lib/config/positions.ts` stops being
the runtime source of truth. Templates, positions, attributes, drills, and
weights are org-owned DB rows. `computePositionRating` keeps its **exact
math** and reads config from the DB.

### 3.1 Tables

```sql
create table templates (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references orgs(id) on delete cascade,
  name                    text not null,
  sport                   text not null,           -- 'flag_football' | 'baseball' | 'custom'
  min_ratings_for_display int  not null default 3, -- v1 MIN_RATINGS_FOR_DISPLAY
  created_at              timestamptz not null default now()
);

create table template_positions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  code        text not null,           -- 'WR', 'SS', …
  label       text not null,
  sort_order  int  not null,           -- replaces BOARD_ORDER
  unique (template_id, code)
);

create table template_attributes (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  key         text not null,           -- 'catching', 'contact_hitting', …
  label       text not null,
  short       text not null,           -- 'CTH', 'CON', …
  unique (template_id, key)
);

create table template_drills (
  id                       uuid primary key default gen_random_uuid(),
  template_id              uuid not null references templates(id) on delete cascade,
  org_id                   uuid not null references orgs(id) on delete cascade,
  key                      text not null,   -- 'forty', 'exit_velocity', …
  label                    text not null,
  unit                     text not null,   -- 's', 'mph'
  direction                text not null check (direction in ('lower_is_better','higher_is_better')),
  max_attempts             int  not null default 2 check (max_attempts between 1 and 5),
  min_timed_for_percentile int  not null default 15,  -- v1 MIN_TIMED_FOR_PERCENTILE
  value_min                numeric not null,
  value_max                numeric not null,
  decimals                 int  not null default 2,
  unique (template_id, key)
);

-- One row per (position, component). A component is a judged attribute OR
-- a measured drill; exactly one of the two FKs is set.
create table position_weights (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references templates(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  position_id  uuid not null references template_positions(id) on delete cascade,
  attribute_id uuid references template_attributes(id) on delete cascade,
  drill_id     uuid references template_drills(id) on delete cascade,
  weight       int not null check (weight between 1 and 100),
  check (num_nonnulls(attribute_id, drill_id) = 1),
  unique (position_id, attribute_id),
  unique (position_id, drill_id)
);
```

A position's judged-attribute list **is derived from its weight rows** —
there is no separate attribute list to drift out of sync. This is how
"pitchers are not rated on hitting" holds structurally: P simply has no
weight row for any hitting attribute, so hitting sliders never render for a
pure pitcher.

One template per org in v2, created at onboarding. `tryouts` gains
`template_id` so multiple templates per org is a column away, but the v2 UI
does not offer it.

`ratings.attribute_key` and `drill_results.drill_key` stay **text** keys
(not FKs). The upsert conflict targets that v1's save discipline depends on
survive unchanged; keys resolve unambiguously through the tryout's
template. Server code validates keys against the template on write. The
trade (no DB-level FK) is accepted and noted.

**Guardrails**, identical for seeded and scratch templates:

- **Weights must sum to exactly 100 per position.** Enforced three times:
  in the template editor UI (cannot save otherwise), in the server
  validation, and by a constraint trigger on `position_weights` (deferred,
  checked at transaction end so edits can rebalance within one save).
- A position needs at least one weighted component. Keys are snake_case,
  codes uppercase, both unique per template.
- Deleting an attribute/drill that carries ratings/results warns with the
  count and requires typed confirmation; the orphaned data rows are
  deleted with it (admin-tier destruction, consistent with §2.2).
- Editing weights mid-tryout recomputes boards live (weights are read at
  compute time, nothing is stored). The editor says so on save.
- The UI presents all weights as **"research-informed defaults, fully
  editable"** — never as fixed industry standards. This exact framing
  appears in the template picker and the editor.

### 3.2 Drill direction and percentiles

**⚠ BREAKS V1 (B7, B8, B9):** every drill row carries `direction`.

- **Best attempt** per prospect: `min(value)` when `lower_is_better`,
  `max(value)` when `higher_is_better`.
- **Percentile** (0 = worst, 100 = best in class, same semantics as v1):
  `percent_rank()` partitioned by `(tryout_id, drill_key)`, ordered
  `best desc` for `lower_is_better` and `best asc` for
  `higher_is_better`. Untimed prospects stay **excluded from the window**,
  exactly as v1 — ranked in a CTE over timed rows only, joined back.
- Percentile is hidden (and the component counts as *missing*, gating the
  rating) until `min_timed_for_percentile` prospects have a result **for
  that drill**. Per drill, not per tryout.

The `prospect_speed` view is replaced by `prospect_drill_stats`:

```
prospect_drill_stats(prospect_id, tryout_id, org_id, drill_key,
                     best, avg, attempts, percentile, measured_count)
```

Same CTE structure as v1's view, generalized over drills, direction folded
into the `order by`, `security_invoker = true`. `drill_results` drops the
forty-specific CHECK; DB keeps `value > 0`, and per-drill
`value_min`/`value_max` are enforced in the entry UI and server validation
(**B8**).

### 3.3 Rating math — unchanged, DB-fed

`computePositionRating` keeps the identical formula; only the config source
and the shape of the speed term generalize:

```
raw = Σ over judged components:  teamRating(0–10) × 10 × weight/100
    + Σ over drill components:   percentile(0–100)    × weight/100

display = round(45 + raw/100 × 54)
```

- Gate, unchanged in spirit: **every** weighted component covered (each
  judged attribute has a team rating; each weighted drill has a valid
  percentile for this prospect) AND total officer inputs ≥ the template's
  `min_ratings_for_display`. Otherwise no rating — progress line instead
  (`5 of 8 inputs · missing exit velocity`).
- Sort on `raw`, never on display. Verified numbers in
  `scripts/verify-rating.ts` are re-pointed at the seed definitions
  (**B19**) and extended with a baseball case and a multi-drill case.
- The v1 signature's `PositionKey`/`AttributeKey` unions become strings
  validated at template load (**B13**). One loader
  (`lib/data/template.ts`, server-only) fetches and validates the whole
  template per request; screens receive it as a typed object shaped like
  the old config, so component code barely changes.

### 3.4 Onboarding template picker

Shown when creating an org:

| Card | State |
|---|---|
| **Flag Football** | selectable — Seed 1 |
| **Baseball** | selectable — Seed 2 |
| **Basketball** | visible, **grayed out, labeled "Coming Soon", not clickable** |
| **Start From Scratch** | selectable — blank template builder, same guardrails, weights must sum to 100 per position before the org can run a tryout |

Every card carries the "research-informed defaults, fully editable" line.

### 3.5 Seed mechanics

Seed definitions live in SQL inside `migration-v2.sql` as **template rows
belonging to no live org** (a reserved system org row, not selectable, not
joinable). `create_org` **copies** the chosen seed's rows into the new org,
which the org then owns and edits freely. Editing your template never
touches the seed; new orgs always start clean.

### 3.6 Seed 1 — Flag Football (exact v1 port)

Ported verbatim from `lib/config/positions.ts` at `v1.0`. The v1 `speed`
weight becomes the weight on the `forty` drill (**B7**).

Drill: `forty` — "40 Yard Dash", unit `s`, **lower_is_better**,
`max_attempts` 2, `min_timed_for_percentile` 15, range 0–20 exclusive
(v1's CHECK, now template data), 2 decimals.

Attributes: catching CTH, quickness QCK, route_running RTE, coverage COV,
flag_pulling FLG, throwing_power PWR, accuracy ACC, pocket_movement PKT,
blocking BLK.

Positions, `sort_order` = v1 `BOARD_ORDER` (QB, R, WR, DB, LB, OL):

| Pos | Label | Weights (sum 100) |
|---|---|---|
| QB | Quarterback | accuracy 35, throwing_power 30, pocket_movement 20, forty 15 |
| R | Rusher | quickness 35, flag_pulling 30, forty 35 |
| WR | Wide Receiver | catching 30, quickness 20, route_running 20, forty 30 |
| DB | Defensive Back | coverage 30, quickness 20, flag_pulling 20, forty 30 |
| LB | Linebacker | coverage 30, flag_pulling 25, quickness 20, forty 25 |
| OL | Offensive Line | blocking 40, quickness 25, catching 20, forty 15 |

`min_ratings_for_display` 3.

### 3.7 Seed 2 — Baseball

Measured drills (all `max_attempts` 2, `min_timed_for_percentile` 15,
defaults editable like everything else):

| Key | Label | Unit | Direction | Range |
|---|---|---|---|---|
| `sixty_yard_dash` | 60 Yard Dash | s | lower_is_better | 0–20 |
| `exit_velocity` | Exit Velocity | mph | higher_is_better | 0–130 |
| `throwing_velocity` | Throwing Velocity | mph | higher_is_better | 0–110 |

Judged attributes (0–10 sliders):

| Key | Short | Label |
|---|---|---|
| `contact_hitting` | CON | Contact Hitting |
| `power_hitting` | POW | Power Hitting |
| `ground_balls` | GB | Ground Balls |
| `fly_balls` | FB | Fly Balls |
| `receiving` | RCV | Receiving (catcher blocking/framing) |
| `arm_accuracy` | ACC | Arm Accuracy |
| `base_running` | BSR | Base Running |
| `command` | CMD | Command (pitchers) |
| `breaking_ball` | BRK | Breaking Ball (pitchers) |
| `offspeed` | OFS | Offspeed (pitchers) |

Positions and default weights (each row verified to sum to 100):

| Pos | Weights |
|---|---|
| P | command 30, throwing_velocity 25, breaking_ball 20, offspeed 15, ground_balls 10 |
| C | receiving 25, arm_accuracy 15, throwing_velocity 15, contact_hitting 15, power_hitting 10, exit_velocity 10, sixty_yard_dash 5, base_running 5 |
| 1B | contact_hitting 25, power_hitting 20, ground_balls 20, exit_velocity 15, base_running 10, arm_accuracy 5, sixty_yard_dash 5 |
| 2B | ground_balls 25, contact_hitting 20, base_running 15, sixty_yard_dash 15, arm_accuracy 10, exit_velocity 10, power_hitting 5 |
| SS | ground_balls 25, contact_hitting 15, sixty_yard_dash 15, arm_accuracy 15, throwing_velocity 10, base_running 10, exit_velocity 10 |
| 3B | ground_balls 25, throwing_velocity 15, power_hitting 15, contact_hitting 15, exit_velocity 15, arm_accuracy 10, sixty_yard_dash 5 |
| LF | fly_balls 20, contact_hitting 20, power_hitting 20, exit_velocity 15, sixty_yard_dash 10, base_running 10, arm_accuracy 5 |
| CF | fly_balls 25, sixty_yard_dash 20, base_running 15, contact_hitting 15, power_hitting 10, exit_velocity 10, arm_accuracy 5 |
| RF | fly_balls 20, power_hitting 20, throwing_velocity 15, exit_velocity 15, contact_hitting 15, sixty_yard_dash 5, base_running 5, arm_accuracy 5 |

Board `sort_order`: P, C, SS, 2B, 3B, 1B, CF, LF, RF.

- **Pitchers are not rated on hitting** — P has no hitting weight rows, so
  the attribute-list-derived-from-weights rule (§3.1) keeps hitting
  sliders off a pure pitcher's form.
- **Two-way players** add P plus a field position; the existing
  multi-position attribute **union** covers them with zero new mechanics —
  the rating form shows the union of both positions' components.
- **Per-pitch tracking** (curveball vs slider as separate attributes) is
  **explicitly deferred**. Orgs that want it add attributes through the
  template editor.

---

## 4. Onboarding

**⚠ BREAKS V1 (B4):** public signup is re-enabled, **with required email
confirmation**.

Supabase Auth dashboard changes (config, not SQL — listed in the migration
file's header comment as manual steps): enable signups, require email
confirmation, and enable **leaked-password protection** (closing HANDOFF
gap #4 while we are in that screen).

Flow:

1. `/signup` — email, password, display name. Creates the auth user and
   the `profiles` row.
2. Confirmation email → until clicked, the account accesses **nothing**.
   `proxy.ts` (Next 16 — not `middleware.ts`, per the v1 trap) checks
   `getClaims()` (never `getSession()`): no session → `/login`; session
   without a confirmed email → `/confirm-email` (a "check your inbox"
   screen with resend); confirmed but zero memberships → `/onboarding`.
3. `/onboarding` — two cards:
   - **Create an Org** — name it, pick a template (§3.4) → `create_org`
     RPC → land on Home as **owner**.
   - **Join an Org** — enter an invite code → `join_org` RPC → land on
     Home **at that code's role**. Errors are honest: bad/rotated code vs
     already-a-member.

A user in multiple orgs gets an org switcher in the Account tab; the
active org is remembered client-side and every screen scopes to it.

---

## 5. Role-rendered Account tab

**⚠ BREAKS V1 (B15):** one Account screen, sections rendered by the
caller's role in the active org — not separate screens, no route
branching. RLS makes hiding a section cosmetic, never load-bearing.

| Section | Who sees it |
|---|---|
| Profile (display name), change password, sign out | everyone |
| Org name, active-tryout picker, org switcher (if >1), **leave org** | everyone (leave is refused for the owner with a "transfer first" message) |
| Members list with roles | everyone reads; admin+ gets remove / evaluator↔viewer controls per §2.2 |
| Invite codes — both codes shown big and copyable, one **Rotate** button each | admin+ |
| Template editor (positions, attributes, drills, weights, "research-informed defaults, fully editable") | admin+ |
| Tryout management (create, **rename** — new in v2, activate) | admin+ |
| CSV import | admin+ |
| Danger zone: hard-delete prospects/data | admin+ |
| Promote/demote admins, **transfer ownership**, **delete org** (typed-confirmation, cascades a whole club) | owner |

---

## 6. Gemini AI

**⚠ BREAKS V1 (B16):** first external API, first true server secret.

### 6.1 Secret handling — non-negotiable

- `GEMINI_API_KEY` lives in `.env.local` (gitignored, verified) and as a
  **Secret-type** env var in Vercel. It **never** gets a `NEXT_PUBLIC`
  prefix, never appears in any client component, never reaches the browser
  bundle. `scripts/verify-imports.ts` gains a check: any file importing
  the Gemini client module must be a route handler or server-only module,
  and the string `GEMINI_API_KEY` may appear only in server code and env
  examples.
- Model name comes from `GEMINI_MODEL` env (default set in code), so a
  model deprecation is a config change, not a deploy.

### 6.2 Route architecture

The browser only ever calls our own routes:

- `POST /api/ai/csv-cleanup`
- `POST /api/ai/scouting-summary`

Every AI route, in order, **before** any Gemini call:

1. `getClaims()` — authenticated and email-confirmed, else 401.
2. Org membership + role check (evaluator+ for scouting summary; admin+
   for CSV cleanup, since only admins import) against the request's
   `org_id`, else 403.
3. Rate limit check (§6.5), else 429 with the friendly message.
4. Only then call Gemini, server-to-server.

### 6.3 Feature 1 — CSV cleanup

On the import screen, next to the file picker: **"Clean up with AI"**
(optional — the deterministic path works without it).

- Sends the raw CSV text plus the org's template context (position codes,
  drill keys, expected columns) to Gemini, asking it to normalize headers,
  position spellings, and obvious formatting mess into the import format
  (§12 of v1, columns per **B14**).
- The response renders as a **diff preview** (before/after per changed
  cell). The admin accepts or discards; nothing is imported from AI output
  directly.
- Accepted output goes through the **full deterministic validator
  unchanged** — whole-file validation, row-numbered errors, three-table
  rollback. The AI is a pre-processor, never an authority. A hallucinated
  position still fails validation exactly like a typo'd one.
- Cell values that are opinions (ratings) are never AI-touched; the import
  format has none.

### 6.4 Feature 2 — AI scouting summary

On the player profile, evaluator+: **"AI scouting summary"** button.

- Server route gathers, via the caller's own RLS-scoped session (so a
  caller can never summarize a prospect they cannot read): team ratings
  per attribute with rater counts, drill bests/percentiles, position
  ratings or gate status, and comments.
- Prompt asks for a **3-sentence scouting report** — strengths, concerns,
  bottom line — grounded only in supplied data, with an instruction to say
  "limited data" rather than invent when inputs are thin.
- Renders in a distinct AI-styled block with a regenerate button. Not
  stored in v2 — regenerating is cheap and storage invites staleness.
- Accepted trade, stated plainly: prospect names, ratings, and officer
  comments are sent to Google's API under its data terms. This ships
  as-is for v2; an org-level AI kill switch is future work (§11).

### 6.5 Rate limiting

```sql
create table ai_usage (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  route      text not null,
  created_at timestamptz not null default now()
);
create index on ai_usage (user_id, created_at);
create index on ai_usage (created_at);
```

- Per-user cap: **25 calls per UTC day**. Global cap across all orgs:
  **500 per UTC day** (protects the API bill from any single tenant or a
  runaway loop). Both are code constants in one server module —
  deliberately not org-editable.
- The route counts rows before calling Gemini and inserts one row after a
  successful call. Over either cap → HTTP 429, body rendered as:
  *"AI limit reached — resets tomorrow."* Friendly, no stack traces, no
  distinction leaked between the per-user and global cap beyond the same
  message.
- Failures (Gemini down, timeout) do not consume quota.

---

## 7. Lifecycle cleanup (pg_cron)

**⚠ BREAKS V1 (B17).** The migration enables the `pg_cron` extension and
schedules one nightly job (09:10 UTC — small-hours US Eastern):

- Delete `auth.users` rows **unconfirmed** (`email_confirmed_at is null`)
  older than **7 days**.
- Delete **confirmed** users with **zero org memberships** whose account
  is older than **30 days** (the 30 days runs from account creation;
  someone who just left their only org keeps the account until age +
  membership are both stale — flag noted, acceptable for v2).

Implemented as one `security definer` function owned by `postgres`, called
by the cron job. Deletions cascade `profiles` (FK) and thence memberships.
The function never touches users who hold any membership. Job runs are
visible in `cron.job_run_details` for auditing.

---

## 8. Migration and rollout

**⚠ BREAKS V1 (B18, B22).**

- v2 ships as **`supabase/migration-v2.sql`**, applied on top of the v1
  schema. `supabase/migration.sql` is never edited again. Running v1 then
  v2 fresh reproduces the complete database; the file's header documents
  the manual Auth-dashboard steps (§4) that SQL cannot express.
- The migration is written to run **once, transactionally**, on the live
  database, and in order it must:
  1. Create the new tables (§2.1, §3.1, §6.5) and the `app` helper schema.
  2. Rename `officers` → `profiles`, drop `is_admin`.
  3. Create the **default org** — name `NCSU Club Flag Football` — and
     seed templates (§3.5), copying the Flag Football template into the
     default org.
  4. Attach **the existing account** (the single current officer row,
     Benito's account) as the default org's **owner**. Any other officer
     rows that exist by migration day become `evaluator` (promotable
     afterward from the Account tab).
  5. Backfill `org_id` on every existing row of `tryouts`, `prospects`,
     `ratings`, `drill_results`, `selections`, `comments` to the default
     org; then set NOT NULL; add the derive-org triggers (§2.4).
  6. Add `template_id` to `tryouts`, pointed at the default org's
     template. Existing `drill_results.drill_key = 'forty'` rows now
     resolve against the seeded `forty` drill — no data rewrite needed.
  7. Drop every v1 policy; create the v2 policies (§2.5). Replace
     `prospect_speed` with `prospect_drill_stats`; recreate
     `prospect_attribute_ratings` org-aware; `security_invoker = true` on
     both. Move storage objects to `{org_id}/…` paths and swap storage
     policies.
  8. Generate the default org's invite codes.
  9. Enable `pg_cron`, create the lifecycle function and schedule (§7).
- Rollback story: `v1.0` tag for code. For the database, take a manual
  Supabase backup/restore point immediately before applying the migration
  — the tags-don't-cover-the-DB trap from HANDOFF §9 applies double here.
- Vercel: `GEMINI_API_KEY` and `GEMINI_MODEL` added as env vars **and a
  redeploy triggered** (v1 trap: Vercel does not apply new env vars to an
  existing build).

---

## 9. Testing plan

Machine-verified (extend `npm run verify`):

- `verify:rating` re-pointed at seed definitions (**B19**); adds baseball
  P and C hand-checked arithmetic, a multi-drill position, a
  higher-is-better percentile case, both band edges, all gates.
- `verify:templates` (new): every seed position's weights sum to exactly
  100; every weight references a component defined in its template; P has
  no hitting components; direction present on every drill.
- `verify:roster` extended for template-driven drill columns (**B14**).
- `verify:imports` extended with the Gemini server-only checks (§6.1).
- `verify:color` unchanged.

Verified by hand against the live database — **two fake orgs ("Org A",
"Org B"), with one account per role in each** (8 throwaway accounts + the
real owner), two browser profiles:

1. **Cross-org isolation, the headline check:** every table and both
   views — an Org A account (each role) reads **zero** Org B rows and
   writes nothing into Org B, including via hand-crafted PostgREST
   requests with forged `org_id`s (the derive-triggers must overwrite
   them). Org A can never read Org B, in either direction.
2. **Code-join flows:** evaluator code lands at evaluator, viewer code at
   viewer; rotated code stops joining immediately; pre-rotation members
   remain; there is no code that yields admin.
3. **Role boundaries, per §2.2:** viewer cannot write anything (UI *and*
   direct API); evaluator can rate/time/select/comment and add or edit
   athletes by hand, but not import CSV, delete prospects, or touch
   templates; admin cannot demote another
   admin or the owner; owner-only paths (promote admin, transfer, delete
   org) refuse everyone else. Own-rows-only on `ratings` and `comments`
   tested across two accounts — closing v1's unclosed gap #1 in the same
   pass.
4. **Ownership invariants:** transfer succeeds and leaves exactly one
   owner; owner leave refused; second-owner insert refused by the index.
5. **Onboarding:** unconfirmed account blocked everywhere; confirm →
   onboarding → both paths land correctly.
6. **Templates:** scratch template refuses to save at ≠100; baseball org
   shows no hitting sliders on a pure P; two-way P+SS shows the union;
   weight edit re-ranks the board live.
7. **AI:** routes refuse anon, unconfirmed, non-members, and (cleanup)
   non-admins; 26th call of the day returns the friendly 429; key absent
   from the browser bundle (grep the build output).
8. **Lifecycle:** run the cron function manually against planted stale
   test users; verify confirmed-with-membership users survive.

---

## 10. Build order

Steps 1–3 gate everything. One commit per step, pushed (CLAUDE.md rule 8
still applies, on branch `v2`).

1. `migration-v2.sql` §8 items 1–6 + seeds, applied to a **Supabase
   branch/staging copy first**, then live after review
2. RLS rewrite + RPCs (§2.5, §2.6) — the stop-and-ask is this spec's
   approval
3. Template loader (`lib/data/template.ts`) + generalized
   `computePositionRating` + re-pointed verify scripts; delete runtime
   imports of `positions.ts`
4. Auth: signup, email confirmation, `proxy.ts` gates, onboarding
   create/join flows (RPC-backed)
5. Generalized drill entry + `prospect_drill_stats` on profile, boards,
   KPI strip (**B20**)
6. Role-rendered Account tab: members, codes + rotation, tryout
   management incl. rename, owner section
7. Template editor
8. CSV import v2 (template-driven columns)
9. AI plumbing: `ai_usage`, rate limiter, `/api/ai/csv-cleanup` + diff
   preview UI
10. `/api/ai/scouting-summary` + profile button
11. pg_cron lifecycle job
12. Full §9 two-org test pass; fix-forward; merge `v2` → `main`, tag
    `v2.0`

Safe cuts if time runs short: 10, then 9 (the deterministic import path is
independent), then 11.

---

## 10b. Bulk roster import

Added after the v2.0 release. Supersedes §6.3 and the admin-only framing of
the v1 CSV import.

### 10b.1 Permissions

| Action | viewer | evaluator | admin | owner |
|---|---|---|---|---|
| Import a roster (all three sources) | | ✔ | ✔ | ✔ |
| Export CSV | | | ✔ | ✔ |

**⚠ BREAKS V1 (B23):** CSV import was admin-only in v1 and in v2.0. It is
now evaluator+, because the people holding phones at a tryout are the ones
with the roster. Export stays admin+: a full export is every rating every
officer has given, and that is a different kind of disclosure from adding
athletes.

The RLS policies already permit this — `prospects_insert` and
`prospects_update` are both `app.is_evaluator(org_id)` — so no policy change
is required. **`prospects_delete` is admin-only, and that matters** (§10b.5).

### 10b.2 Entry points

Two, opening the same flow:

1. **Account → Import Roster** (as today).
2. **A button inside the manual Add Athlete sheet**, "Import full roster",
   with subtext naming the supported sources. Rendered for evaluator+.

The second exists because adding athletes one at a time is where someone
realises they have a whole list; making them back out to a settings tab to
act on that is the wrong shape.

### 10b.3 Sources

A picker with three options, all converging on one review table:

| Source | Path |
|---|---|
| CSV or Excel file | Papaparse, no AI call |
| Photo or screenshot | AI extraction |
| Pasted text or table | AI extraction |

The **CSV path never calls the AI.** A file that already parses does not
need a model, and routing it through one would spend quota and add a failure
mode for no gain. AI cleanup remains available on a CSV that fails
validation (§6.3).

### 10b.4 AI extraction

Extends the authenticated AI routes (§6.2) — same guard order, same
`ai_usage` accounting, same daily caps. Evaluator+ rather than admin.

- Accepts JPG, PNG and HEIC. Images are resized client-side before upload
  and capped at 5MB each; **multiple images are accepted in one request**,
  because a paper roster is often several pages.
- The prompt carries the org's valid position codes and the exact target
  schema: `first_name`, `last_name`, `jersey_number`, `positions`, and one
  field per template drill.
- **The model must return `null` for any field it cannot read confidently,
  and flag it.** It is told explicitly never to guess or infer. A wrong
  jersey number that looks plausible is worse than a blank one, because a
  blank gets fixed and a plausible one gets imported.

### 10b.5 The review table

**All three sources land here, and nothing reaches the database until the
user confirms.** This is the whole safety model: extraction is a proposal,
the table is the decision.

- Fields the AI flagged as low-confidence render **highlighted**, and every
  cell is editable.
- Positions are normalized and validated against the org template; invalid
  ones are flagged for correction rather than dropped.
- **A jersey collision with an existing prospect in the active tryout is a
  per-row choice — skip, overwrite, or edit — never a whole-file failure.**
  v1 rejected the entire file on any collision, which is right for a file
  you can go fix in a spreadsheet and wrong for a photo of a roster where
  three names overlap last season's.

### 10b.6 Atomicity

The commit runs as **one `import_roster` RPC in a single transaction**,
not as a sequence with a rollback.

This is not a preference. v1 achieved effective atomicity by deleting the
prospects it had just inserted if a later write failed — and
`prospects_delete` is **admin-only**. An evaluator hitting that path could
not roll back and would leave a half-imported roster behind. The function is
`security invoker`, so every statement is still checked against the caller's
RLS policies; what it adds is one transaction boundary.

Overwrites are `UPDATE`s, which evaluators are permitted, so no part of the
flow needs a policy an evaluator lacks.

---

## 10c. CSV export

Admin+. One row per prospect, wide format, for the active tryout.

### 10c.1 Columns

Every column is generated from the org's template. **Nothing is hardcoded**,
which is the same rule the rest of v2 lives under (§3).

| Group | Columns |
|---|---|
| Identity | `first_name`, `last_name`, `jersey_number`, `primary_position`, `secondary_positions`, `selected` |
| Per drill | `{drill}_1..N` (each attempt), `{drill}_best`, `{drill}_avg` |
| Per position | `{CODE}_rating`, `{CODE}_inputs` |
| Per attribute | `{attr}_median`, `{attr}_raters` |

- A position column is **blank** where the prospect does not play it, and
  blank where the rating is gated. Blank is not zero, and an unrated
  attribute must never export as `0` — a spreadsheet will average it.
- Ratings are the 45–99 display band, matching what officers saw on screen.

### 10c.2 Entry points and naming

- **Account → Export**, the whole active tryout.
- **Selected → Export**, only the prospects on the shared team list.

Filename: `{org}-{tryout}-{date}.csv`, slugified.

### 10c.3 Out of scope

**Long-format export** — one row per individual officer rating, for
per-rater analysis — is deliberately deferred. It answers a different
question (who rates hot, who disagrees) and belongs with rater-bias
normalization, which v1 §17 already defers.

## 11. Explicitly out of scope for v2

- Basketball template (visible, grayed out, Coming Soon — no seed rows)
- Long-format CSV export, one row per rating (§10c.3)
- Per-pitch tracking for pitchers (orgs can self-serve via template editing)
- Multiple templates per org; template sharing/marketplace
- Org-level AI kill switch and org-editable AI caps
- Billing/plans; org size limits
- Prospect-facing anything (prospects remain data rows, never auth users)
- Realtime, offline sync, native apps, exports, rater-bias normalization,
  cross-year comparison (all still deferred from v1 §17)

---

## 12. Docs to update when v2 merges (not before)

- **CLAUDE.md rule 1** → "SPEC-V2.md governs v2 behaviour; SPEC.md is
  historical."
- **CLAUDE.md rule 2** → rewritten: templates in the DB are the single
  source of truth; `positions.ts` is dead; config drift check becomes
  "no position/attribute/drill key hardcoded anywhere outside seed SQL."
- **CLAUDE.md rule 6** (RLS) — unchanged, and this spec satisfies it for
  the v2 rewrite.
- **CLAUDE.md rule 8** → branch/merge workflow while `v2` is open.
- **HANDOFF.md** → superseded by a v2 handoff written at merge time.
