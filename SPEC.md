# Big Board — Build Spec

A mobile-optimized web app for running flag football tryouts. Officers rate prospects in real time from their phones on the field, and the app turns those ratings into positional boards that drive roster decisions.

This document is the full spec. Read it end to end before writing code.

---

## 1. Context and goals

**Who uses it.** 12 to 15 club officers, all known to each other, all on their phones, standing on a field during a tryout. Every officer has the same permissions.

**What it replaces.** A shared Excel sheet that is slow to update, impossible to use one-handed, and gets out of sync when multiple people edit it.

**What success looks like.** At the end of a tryout, an officer opens the app and sees a ranked board per position, backed by real inputs from multiple evaluators, and can defend every cut with data.

**Scale.** Roughly 60 to 120 prospects per tryout. 15 concurrent users at absolute peak. This is a small app. Do not over-engineer for scale. Optimize for build speed and field usability.

**Environment constraints that should drive design decisions.**
- Outdoors, bright sun, high contrast needed
- One hand free, often gloved, so tap targets must be large
- Stadium wifi or LTE that may be flaky, so writes must be optimistic and payloads small
- Officers are moving between drills, so nothing should require more than 2 taps to reach

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | |
| Hosting | Vercel | Free tier, deploys from GitHub |
| Database | Supabase Postgres | |
| Auth | Supabase Auth, email + password | No signup flow, accounts created manually |
| Storage | Supabase Storage | Headshots only |
| Styling | Tailwind CSS | |
| CSV parsing | Papaparse | Client side |
| Live updates | Poll on interval + refetch on tab focus | See section 9 |

No state management library. React state plus a few fetch hooks is enough at this size.

---

## 3. Positions and attributes

Six positions. Every prospect has one primary position and zero or more secondary positions. A prospect is only rated on the attributes belonging to the positions they are trying out for.

| Position | Code | Judged attributes |
|---|---|---|
| Wide Receiver | WR | catching, quickness, route_running |
| Defensive Back | DB | coverage, quickness, flag_pulling |
| Linebacker | LB | coverage, flag_pulling, quickness |
| Rusher | R | quickness, flag_pulling |
| Quarterback | QB | throwing_power, accuracy, pocket_movement |
| Offensive Line | OL | blocking, catching, quickness |

**Speed is not a judged attribute.** It is derived from the 40 yard dash and applies to every position, weighted differently per position. It is never rated on a slider and never displayed as a 0 to 100 score. It displays as a raw time plus a percentile.

A prospect trying out at multiple positions gets the union of those attribute sets on their rating form. Shared attributes like quickness are rated once and count toward every position that uses them.

### Position weights

Weights sum to 100 per position. These live in one config file, never duplicated.

| Position | Weights |
|---|---|
| WR | catching 30, quickness 20, route_running 20, speed 30 |
| DB | coverage 30, quickness 20, flag_pulling 20, speed 30 |
| LB | coverage 30, flag_pulling 25, quickness 20, speed 25 |
| R | quickness 35, flag_pulling 30, speed 35 |
| QB | accuracy 35, throwing_power 30, pocket_movement 20, speed 15 |
| OL | blocking 40, quickness 25, catching 20, speed 15 |

---

## 4. Config file (single source of truth)

Create `lib/config/positions.ts`. Every screen imports from here. Do not hardcode a position or attribute list anywhere else in the codebase. If a position label or attribute appears in two files, that is a bug.

```ts
export const ATTRIBUTES = {
  catching:        { label: "Catching",        short: "CTH" },
  quickness:       { label: "Quickness",       short: "QCK" },
  route_running:   { label: "Route Running",   short: "RTE" },
  coverage:        { label: "Coverage",        short: "COV" },
  flag_pulling:    { label: "Flag Pulling",    short: "FLG" },
  throwing_power:  { label: "Throwing Power",  short: "PWR" },
  accuracy:        { label: "Accuracy",        short: "ACC" },
  pocket_movement: { label: "Pocket Movement", short: "PKT" },
  blocking:        { label: "Blocking",        short: "BLK" },
} as const;

export type AttributeKey = keyof typeof ATTRIBUTES;
export type PositionKey = "WR" | "DB" | "LB" | "R" | "QB" | "OL";

export const POSITIONS: Record<PositionKey, {
  label: string;
  attributes: AttributeKey[];
  weights: Partial<Record<AttributeKey | "speed", number>>;
}> = {
  WR: {
    label: "Wide Receiver",
    attributes: ["catching", "quickness", "route_running"],
    weights: { catching: 30, quickness: 20, route_running: 20, speed: 30 },
  },
  DB: {
    label: "Defensive Back",
    attributes: ["coverage", "quickness", "flag_pulling"],
    weights: { coverage: 30, quickness: 20, flag_pulling: 20, speed: 30 },
  },
  LB: {
    label: "Linebacker",
    attributes: ["coverage", "flag_pulling", "quickness"],
    weights: { coverage: 30, flag_pulling: 25, quickness: 20, speed: 25 },
  },
  R: {
    label: "Rusher",
    attributes: ["quickness", "flag_pulling"],
    weights: { quickness: 35, flag_pulling: 30, speed: 35 },
  },
  QB: {
    label: "Quarterback",
    attributes: ["throwing_power", "accuracy", "pocket_movement"],
    weights: { accuracy: 35, throwing_power: 30, pocket_movement: 20, speed: 15 },
  },
  OL: {
    label: "Offensive Line",
    attributes: ["blocking", "catching", "quickness"],
    weights: { blocking: 40, quickness: 25, catching: 20, speed: 15 },
  },
};

// Board display order on the dashboard. Editable, not hardcoded in components.
export const BOARD_ORDER: PositionKey[] = ["QB", "R", "WR", "DB", "LB", "OL"];

// Gating thresholds
export const MIN_RATINGS_FOR_DISPLAY = 3;   // total officer inputs for a position
export const MIN_TIMED_FOR_PERCENTILE = 15; // prospects with a 40 before percentile is valid
export const MAX_FORTY_ATTEMPTS = 2;
```

---

## 5. Database schema

Run this as a single migration in the Supabase SQL editor.

```sql
-- ============================================================
-- BIG BOARD SCHEMA
-- ============================================================

create table tryouts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tryout_date  date not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table officers (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table prospects (
  id                  uuid primary key default gen_random_uuid(),
  tryout_id           uuid not null references tryouts(id) on delete cascade,
  jersey_number       int  not null,
  first_name          text not null,
  last_name           text not null,
  primary_position    text not null,
  secondary_positions text[] not null default '{}',
  headshot_url        text,
  created_at          timestamptz not null default now(),
  unique (tryout_id, jersey_number)
);

-- One row per officer per attribute per prospect. Upsert on conflict.
create table ratings (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid not null references prospects(id) on delete cascade,
  officer_id    uuid not null references officers(id) on delete cascade,
  attribute_key text not null,
  value         numeric(3,1) not null check (value >= 0 and value <= 10),
  updated_at    timestamptz not null default now(),
  unique (prospect_id, officer_id, attribute_key)
);

-- Max 2 attempts per prospect per drill. ANY officer may record or correct.
create table drill_results (
  id             uuid primary key default gen_random_uuid(),
  prospect_id    uuid not null references prospects(id) on delete cascade,
  drill_key      text not null default 'forty',
  attempt_number int  not null check (attempt_number in (1, 2)),
  value          numeric(4,2) not null check (value > 0 and value < 20),
  recorded_by    uuid not null references officers(id),
  updated_at     timestamptz not null default now(),
  unique (prospect_id, drill_key, attempt_number)
);

-- Shared team list. One row per prospect, not per officer.
create table selections (
  id          uuid primary key default gen_random_uuid(),
  tryout_id   uuid not null references tryouts(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  selected_by uuid not null references officers(id),
  created_at  timestamptz not null default now(),
  unique (tryout_id, prospect_id)
);

create table comments (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  officer_id  uuid not null references officers(id) on delete cascade,
  body        text not null check (length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index on prospects (tryout_id);
create index on ratings (prospect_id);
create index on drill_results (prospect_id);
create index on selections (tryout_id);
create index on comments (prospect_id, created_at desc);
```

### Why the constraints are shaped this way

`ratings` is unique on **(prospect_id, officer_id, attribute_key)**. Every slider save is an upsert on that conflict target. This is what makes "an officer can only overwrite his own rating" true at the database level rather than a UI convention.

`drill_results` is unique on **(prospect_id, drill_key, attempt_number)** with attempt capped at 2. Note the uniqueness deliberately does **not** include the officer. Anyone can record or correct a 40 time, because a fat-fingered 5.9 sitting in the system all day is a worse outcome than a small trust risk among 15 people who know each other.

`selections` is unique on **(tryout_id, prospect_id)**. It is one shared team list, not a per-officer list. `selected_by` is stored for attribution only.

---

## 6. Row level security

**This is the highest-risk part of the build.** The failure mode is silent. A bad policy either lets everyone edit everything, which nobody notices, or blocks all writes, which reads like a frontend bug and burns an hour. Write these deliberately, then test with two browser profiles logged in as different officers.

```sql
alter table tryouts       enable row level security;
alter table officers      enable row level security;
alter table prospects     enable row level security;
alter table ratings       enable row level security;
alter table drill_results enable row level security;
alter table selections    enable row level security;
alter table comments      enable row level security;

-- Everyone authenticated can read everything.
create policy read_all on tryouts       for select to authenticated using (true);
create policy read_all on officers      for select to authenticated using (true);
create policy read_all on prospects     for select to authenticated using (true);
create policy read_all on ratings       for select to authenticated using (true);
create policy read_all on drill_results for select to authenticated using (true);
create policy read_all on selections    for select to authenticated using (true);
create policy read_all on comments      for select to authenticated using (true);

-- Prospects: any officer can add or edit (roster management is collaborative).
create policy write_prospects on prospects for insert to authenticated with check (true);
create policy edit_prospects  on prospects for update to authenticated using (true) with check (true);

-- Ratings: own rows only.
create policy ratings_insert on ratings for insert to authenticated
  with check (officer_id = auth.uid());
create policy ratings_update on ratings for update to authenticated
  using (officer_id = auth.uid()) with check (officer_id = auth.uid());
create policy ratings_delete on ratings for delete to authenticated
  using (officer_id = auth.uid());

-- Drill results: anyone can write or correct, but must stamp themselves.
create policy drills_insert on drill_results for insert to authenticated
  with check (recorded_by = auth.uid());
create policy drills_update on drill_results for update to authenticated
  using (true) with check (recorded_by = auth.uid());

-- Selections: anyone can add or remove.
create policy selections_insert on selections for insert to authenticated
  with check (selected_by = auth.uid());
create policy selections_delete on selections for delete to authenticated
  using (true);

-- Comments: post as yourself, delete only your own.
create policy comments_insert on comments for insert to authenticated
  with check (officer_id = auth.uid());
create policy comments_delete on comments for delete to authenticated
  using (officer_id = auth.uid());
```

---

## 7. Views

Two views. They handle the cross-prospect math that SQL is genuinely better at than JavaScript.

```sql
-- Median rating per prospect per attribute, plus how many officers weighed in.
create or replace view prospect_attribute_ratings as
select
  prospect_id,
  attribute_key,
  percentile_cont(0.5) within group (order by value) as team_rating,
  count(*) as rater_count
from ratings
group by prospect_id, attribute_key;

-- Best / average 40, and speed percentile within the tryout class.
create or replace view prospect_speed as
with timed as (
  select
    p.id        as prospect_id,
    p.tryout_id,
    min(d.value) as best_forty,
    avg(d.value) as avg_forty,
    count(d.id)  as attempts
  from prospects p
  join drill_results d
    on d.prospect_id = p.id and d.drill_key = 'forty'
  group by p.id, p.tryout_id
),
ranked as (
  select
    t.*,
    round((percent_rank() over (
      partition by t.tryout_id order by t.best_forty desc
    ) * 100)::numeric, 0) as speed_percentile
  from timed t
),
pool as (
  select tryout_id, count(*) as timed_count
  from timed group by tryout_id
)
select
  p.id        as prospect_id,
  p.tryout_id,
  r.best_forty,
  round(r.avg_forty, 2) as avg_forty,
  r.attempts,
  r.speed_percentile,
  coalesce(pool.timed_count, 0) as timed_count
from prospects p
left join ranked r on r.prospect_id = p.id
left join pool   on pool.tryout_id  = p.tryout_id;
```

**Note on `percent_rank`.** It is ordered descending so the slowest time maps to 0 and the fastest to 100. Prospects with no 40 time are excluded from the window entirely, which is why the ranking happens in a CTE over only timed rows before joining back to the full prospect list. Verify this by hand with 5 fake times before trusting it.

**Why the positional rating is NOT a view.** The position weights live in the TypeScript config. Putting them in SQL too would create two sources of truth, and you will tweak those weights. Compute the weighted sum in one shared TS function that every screen imports. SQL does the window functions, TypeScript does the weighting.

---

## 8. Rating logic

### Sliders

- Range 0.0 to 10.0, step 0.1
- Rendered with visible tick marks at whole numbers, but the value moves continuously between them
- The officer's own current value shows on the handle
- Next to each slider, show the team rating as a colored circle plus the rater count, or a hyphen if nobody has rated it
- Under each circle, small tappable text reading "who rated" that expands a dropdown listing each officer's display name and their value

### Saving

Save on release, not during drag. Upsert on `(prospect_id, officer_id, attribute_key)`.

**Race condition warning.** If you fire a save on every drag event, an older request can resolve after a newer one and overwrite the correct value with a stale one. This is a common bug in generated code. Save only on pointer release, and debounce on the value rather than the event.

Apply the new value to local state immediately, then sync. Do not block the UI on the network.

### Team rating

Use the **median** of all officer ratings for that attribute, not the mean. The median resists the one officer who rates everything a 9. With one rating the median is that value, with two it is their average, so there is no special case to handle.

Always display the rater count next to the rating. A 8.4 from one officer and a 8.4 from nine officers are not the same fact and the UI must not pretend otherwise.

### The 40 yard dash

- Maximum 2 attempts per prospect
- Any officer can enter or correct any attempt
- Display both, formatted like `4.61 best / 4.74 avg`
- **Best** time feeds the positional rating
- Percentile is computed within the current tryout class only, never against an absolute scale, because a 4.9 at a club flag football tryout means something completely different than a 4.9 at a combine
- Do not display or use percentile until at least 15 prospects in the tryout have a time. Before that, show the raw time only and treat speed as missing

### Positional rating formula

```ts
function computePositionRating(
  position: PositionKey,
  attributeRatings: Record<AttributeKey, { teamRating: number; raterCount: number }>,
  speedPercentile: number | null
): { rating: number | null; inputs: number; covered: number; required: number } {
  const cfg = POSITIONS[position];
  const required = cfg.attributes.length + 1; // judged attributes + speed
  const covered = cfg.attributes.filter(a => attributeRatings[a]).length
                + (speedPercentile !== null ? 1 : 0);
  const inputs = cfg.attributes.reduce(
    (sum, a) => sum + (attributeRatings[a]?.raterCount ?? 0), 0
  );

  // Gate: every component present AND enough total officer inputs.
  if (covered < required || inputs < MIN_RATINGS_FOR_DISPLAY) {
    return { rating: null, inputs, covered, required };
  }

  let raw = 0;
  for (const attr of cfg.attributes) {
    raw += (attributeRatings[attr].teamRating * 10) * (cfg.weights[attr]! / 100);
  }
  raw += speedPercentile! * (cfg.weights.speed! / 100);

  // Compress 0-100 into a 45-99 display band so it reads like a football rating.
  const display = Math.round(45 + (raw / 100) * 54);
  return { rating: display, inputs, covered, required };
}
```

**On the 45 to 99 band.** This is cosmetic. It makes everyone look better than the raw number and it squeezes real differences between prospects. It is worth doing because officers engage more with a familiar-looking rating, but the trade is real. Never sort on the display number, always sort on `raw`, and keep `raw` available for debugging.

### The gating rule matters more than the formula

If a position is not fully covered, **do not show a rating.** Show progress instead, like `4 of 6 inputs · missing route running`.

The reason is a real bias in how tryouts work. Prospects who show up early or stand near the officers get rated more. A barely-rated 91 sitting above a fully-vetted 84 on the board will get the wrong guy cut. Showing the gap instead also nudges officers toward filling holes, which improves your data for free.

---

## 9. Live updates

Skip Supabase realtime for v1. For 15 users, a 15 second poll plus a refetch on window focus is fewer moving parts, easier to debug, and indistinguishable in practice. Realtime is a fine v2 upgrade once the app is stable.

---

## 10. Screens

Bottom tab bar with four tabs. Home, Players, Selected, Account.

### 10.1 Home (dashboard)

Position boards, not one master list. The officers are hunting specific positions, so a single "best overall" list is the wrong primary view.

- Boards render in `BOARD_ORDER` from config, so priority positions can be reordered without touching components
- Each board is a card listing prospects at that position, sorted by positional rating descending
- Each row shows headshot thumbnail, jersey number, name, positional rating dial, input count, best 40
- Prospects below the display threshold sort to the bottom and render grayed out rather than being hidden, so officers can see who still needs eyes on them
- Above the boards, a small KPI strip with fastest 40 in the class, most-rated prospect, total prospects, total ratings logged

### 10.2 Players (directory)

- Search bar that matches on **jersey number or name**, both
- Filter chips by position
- List rows showing headshot, jersey number, name, primary and secondary positions, primary positional rating
- Each row has a **select button** on the right (see 10.4)
- Tapping a row opens the player profile

### 10.3 Player profile

**Header block.**
- Large headshot on the left taking most of the left side, with the jersey number badged in the top-left corner of the photo
- First and last name below or beside the headshot
- Position line showing primary and secondaries, like `WR / DB`
- On the right, the **primary position dial**, slightly larger than the others, labeled with the position code and rating, like `WR 84`. Beneath it in small text, the input count
- Below that, a row of **secondary position dials**, equal in size to each other and slightly smaller than the primary. Each has its own independent input count
- At the end of that row, a **plus button** to add a position. Adding a position immediately reveals that position's attributes on the rating form
- A **speed strip** across the bottom of the header, styled differently from the dials because it is a different kind of fact. Format `4.61 best / 4.74 avg · 92nd percentile`. Measurement, not opinion, and the design should say so
- A **select button** in the header (see 10.4)

**Rating section.** One slider per attribute in the union of all the prospect's positions. Each with its team rating circle, rater count, and expandable "who rated" dropdown.

**40 section.** Two attempt fields, editable by anyone.

**Comments.** A scrolling list of officer comments, newest at the bottom, with a text input pinned below it.

### 10.4 Selected

A shared team list of must-keep prospects and guys worth discussing.

- **Total count large at the top of the screen**
- Below that, the list **segmented by position** using the prospect's primary position, with a subheader and count for each segment
- Each entry shows headshot, jersey number, name, positional rating, and a remove control
- Empty state should be explicit about what the screen is for

**The add control.** A plus sign inside a rounded square, appearing in two places, on each row in the Players directory and in the player profile header.

- Not selected, outlined square, plus sign, neutral or yellow
- Selected, filled green square, checkmark instead of a plus
- Tapping toggles. Optimistic update, then sync
- Because `selections` is unique on `(tryout_id, prospect_id)`, one officer adding a prospect adds him for everyone. Handle the conflict case gracefully if two officers tap at once

### 10.5 Account

- Display name and email
- Change password
- Sign out
- Active tryout selector
- Admin only, CSV import and a link to create a new tryout

---

## 11. Auth

No signup page. Accounts are created by hand in the Supabase dashboard under Authentication, then a matching row is inserted into `officers` using the same UUID so the display name has somewhere to live.

The app has a single login page with email and password fields calling `supabase.auth.signInWithPassword`. The client library stores the session token and attaches it to every subsequent request automatically. Postgres reads `auth.uid()` off that token, which is what makes the row level security policies function.

Every route except the login page is gated behind an auth check.

---

## 12. CSV import

Admin only, on the Account screen. Papaparse, client side.

The source is a Google Sheets export, which shapes the format: positions come
from a multi-select cell, and the sheet already carries 40 times and a
selection flag.

### Columns

| Column | Required | Notes |
|---|---|---|
| `first_name` | yes | |
| `last_name` | yes | |
| `jersey_number` | yes | Whole number, unique within the file and the tryout |
| `positions` | yes | Quoted comma-separated list, e.g. `"WR, DB"` |
| `forty_1` | no | 40 yard dash, attempt 1 |
| `forty_2` | no | 40 yard dash, attempt 2 |
| `selected` | no | `TRUE` / `true` / `1` adds him to the shared team list |

### positions

A multi-select cell exports as one quoted, comma-separated string. Split on
comma and trim. **The first value is the primary position; the rest become
secondary positions.** Order in the cell is therefore meaningful.

Normalize each value before matching: strip any parenthetical text and
uppercase, so `R (Rush)` becomes `R` and `wr` becomes `WR`. A sheet built for
humans will label the option in a way a human reads, and the code should meet
it there rather than making someone re-type the column.

After normalizing, a value that is not in `POSITIONS` is an error. Do not
guess and do not drop it silently - a prospect quietly imported at the wrong
position gets rated on the wrong attributes for the rest of the tryout.

Duplicates within one cell collapse to one. A prospect cannot be his own
secondary position.

### forty_1 and forty_2

Optional. When present, insert into `drill_results` with `drill_key` `'forty'`
and `attempt_number` 1 and 2 respectively.

A blank cell means not timed and is not an error. A cell with something
unparseable in it **is** an error - silently dropping a time the importer
believes they imported is worse than refusing the file.

### selected

Optional. Truthy (`TRUE`, `true`, `1`) inserts a row into `selections` for the
active tryout, putting him on the shared team list on arrival. Blank, `FALSE`,
`false` and `0` mean not selected. Any other value is an error.

### Whole-file validation

**Validate the entire file before inserting anything.** Reject the whole
upload with a readable, row-numbered error list rather than half-importing.
Half-imported rosters at midnight are painful to untangle.

Validation rules.
- Jersey numbers unique within the file and not already taken in the tryout
- Every position resolves to a `POSITIONS` entry after normalizing
- At least one position per prospect
- Names non-empty
- 40 times, where present, parse and fall inside the `drill_results` CHECK
- `selected`, where present, is a recognized truthy or falsy value
- Trailing blank rows ignored

The import writes to three tables - `prospects`, `drill_results`, and
`selections` - which cannot share a single statement from the client library.
If a later write fails, the prospects already inserted are deleted again,
which cascades the rest away and restores the state the admin started from.
Effective atomicity, since anything less reintroduces the half-done outcome
this section exists to prevent.

---

## 13. Headshots

Optional. Do not block anything on a photo existing.

- Default avatar is a colored circle containing the jersey number
- Capture via a file input with `capture="environment"` so it opens the phone camera
- **Resize client-side to roughly 400px on the long edge before upload.** A raw iPhone photo is several megabytes and will wreck load times on field wifi
- Handle HEIC and EXIF rotation. iPhones will hand you sideways images if you do not

This is the biggest hidden time sink in the whole project, and it is an operations problem more than a code problem. Photographing 100 people and matching each to a jersey number happens in the middle of a chaotic tryout. Design so it can be done in a batch afterward.

---

## 14. Visual design

- Dark or high-contrast theme. This is used in direct sunlight
- Minimum tap target 44px. Sliders need generous handles for gloved hands
- Dials are SVG circles using `stroke-dasharray` for the arc

**Rating color scale**, one pure function mapping a number to a color, used everywhere.

| Range | Color |
|---|---|
| 90+ | deep green |
| 80 to 89 | medium green |
| 75 to 79 | pale green |
| 70 to 74 | yellow |
| 60 to 69 | orange |
| below 60 | red |
| not rated | neutral gray with a hyphen |

---

## 15. Build order

1. Supabase project, schema migration, RLS policies, 15 accounts created by hand
2. `lib/config/positions.ts` and the shared `computePositionRating` function
3. Auth, login page, route protection
4. Players directory with search, and the prospect table wired up
5. CSV import
6. Player profile with sliders and upsert
7. Dial component and color function
8. 40 entry and the speed view
9. Selected screen and the toggle control
10. Home dashboard boards
11. Comments
12. Headshots

Steps 1 and 2 gate everything. Steps 11 and 12 are the safe cuts if time runs short.

---

## 16. Difficulty notes

Being straight about which parts are trivial and which are not, so effort goes to the right places.

**Genuinely easy.**
- Auth with pre-made accounts, pure boilerplate
- The directory, search, sorting, filtering
- The dial component, this is the flashiest thing in the app and it is about 15 lines of SVG
- The color gradient, one pure function
- Dashboard boards, they are sorted queries over data that already exists
- Comments
- The Selected screen and toggle

**Medium, mostly from edge cases rather than logic.**
- CSV import, the code is simple and the dirty data is not
- Headshot upload, HEIC and EXIF rotation and file size

**Do not trust generated code here without verifying.**
- **RLS policies.** Most common Supabase failure, and it fails silently. Test with two accounts
- **The slider save race condition.** Save on release only
- **The positional rating formula.** No error will fire if the weighting is wrong, the numbers will just be quietly off. Verify by hand with fake data
- **`percent_rank` null handling** in the speed view. Confirm untimed prospects are excluded from the window, not ranked as slowest
- **Config drift.** If a position or attribute list appears anywhere outside `positions.ts`, fix it immediately

The pattern worth internalizing is that the visual layer, the part that makes officers want to use the app, is cheap. The data integrity layer is where the time goes and where the real risk lives.

---

## 17. Explicitly out of scope for v1

- Public or prospect-facing access
- Prospect self-registration
- Native mobile apps
- Offline-first sync
- Rater bias normalization, z-scoring officers against their own distributions. Worth building later once there is enough data to see whose ratings run hot
- Historical comparison across tryout years
- Export to PDF or Excel
