-- ============================================================
-- BIG BOARD - FULL MIGRATION
-- SPEC.md sections 5 (schema), 6 (RLS), 7 (views)
--
-- Run this once, top to bottom, in the Supabase SQL editor.
-- ============================================================


-- ============================================================
-- SECTION 5 - SCHEMA
-- ============================================================

-- A tryout class is one cycle - "Fall 2026". Every prospect, rating, 40
-- time, selection and comment hangs off one by tryout_id, so past classes
-- stay intact forever and switching which is active swaps the whole app onto
-- that season's data. Exactly one is active at a time.
create table tryouts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  season_year  int,
  semester     text check (semester is null or semester in ('fall','spring','na')),
  -- Optional: a class is identified by name + year + semester. A specific
  -- calendar date is extra detail, not a requirement.
  tryout_date  date,
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


-- ============================================================
-- SECTION 6 - ROW LEVEL SECURITY
--
-- Highest-risk part of the build. Failure is silent: a bad policy
-- either lets everyone edit everything, which nobody notices, or
-- blocks all writes, which reads like a frontend bug.
--
-- Test with two browser profiles logged in as different officers
-- before trusting any of this.
-- ============================================================

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

-- Tryout classes: creating one, and switching which is live, are ADMIN
-- actions - they move every officer's screens onto a different season.
-- There is deliberately NO delete policy: a class is the historical record,
-- and deleting one would cascade away an entire year of evaluations.
create policy create_tryouts on tryouts for insert to authenticated
  with check (exists (
    select 1 from officers o where o.id = (select auth.uid()) and o.is_admin
  ));
create policy update_tryouts on tryouts for update to authenticated
  using (exists (
    select 1 from officers o where o.id = (select auth.uid()) and o.is_admin
  ))
  with check (exists (
    select 1 from officers o where o.id = (select auth.uid()) and o.is_admin
  ));

-- Prospects: any officer can add or edit (roster management is collaborative).
create policy write_prospects on prospects for insert to authenticated with check (true);
create policy edit_prospects  on prospects for update to authenticated using (true) with check (true);
-- Delete is ADMIN ONLY, unlike insert and update. Deleting a prospect
-- cascades and destroys every rating, 40 time, selection, and comment about
-- him - that is not a collaborative action, it is a destructive one, and it
-- should not be one mis-tap away for fifteen people.
-- auth.uid() is wrapped in a subselect so Postgres evaluates it once for the
-- statement rather than per row.
create policy delete_prospects on prospects for delete to authenticated
  using (exists (
    select 1 from officers o
    where o.id = (select auth.uid()) and o.is_admin
  ));

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
-- Anyone can clear a bogus attempt, matching the insert/update reasoning
-- above: a wrong time left in the system is worse than a small trust risk
-- among fifteen people who know each other. Unlike ratings, which are one
-- officer's opinion and therefore his alone to delete, a 40 time is a
-- measurement that anyone present can see is wrong.
create policy drills_delete on drill_results for delete to authenticated
  using (true);

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


-- ============================================================
-- STORAGE - headshots (SPEC.md section 13)
--
-- PRIVATE bucket. These are photographs of real people, and section 17 puts
-- public and prospect-facing access out of scope, so the objects are reached
-- through short-lived signed URLs minted at render time rather than by
-- guessable public URLs.
--
-- prospects.headshot_url stores the storage PATH, not a URL: a signed URL
-- expires, and storing one would leave dead links in the database inside an
-- hour.
--
-- All four policies are needed, not three. Replacing a headshot is an upsert,
-- and a Storage upsert requires INSERT + SELECT + UPDATE together - grant only
-- INSERT and new uploads work while replacements silently fail.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('headshots', 'headshots', false, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy headshots_read on storage.objects for select to authenticated
  using (bucket_id = 'headshots');
create policy headshots_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'headshots');
create policy headshots_update on storage.objects for update to authenticated
  using (bucket_id = 'headshots') with check (bucket_id = 'headshots');
create policy headshots_delete on storage.objects for delete to authenticated
  using (bucket_id = 'headshots');


-- ============================================================
-- SECTION 7 - VIEWS
--
-- These handle the cross-prospect math that SQL is genuinely
-- better at than JavaScript. Position WEIGHTS deliberately stay
-- in lib/config/positions.ts and never appear here - two sources
-- of truth for weights is the bug this split exists to prevent.
-- ============================================================

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

-- percent_rank is ordered DESC so the slowest time maps to 0 and the
-- fastest to 100. Untimed prospects never enter the window at all --
-- ranking happens in a CTE over timed rows only, then joins back to
-- the full prospect list, leaving them NULL rather than ranked last.


-- ============================================================
-- FLAGGED FOR YOUR DECISION - NOT APPLIED
--
-- Postgres 15+ creates views with security_invoker = false, meaning
-- a view runs with its OWNER's privileges and does NOT apply the RLS
-- of the tables underneath it. Supabase grants anon SELECT on public
-- views by default.
--
-- Net effect as written above: an UNAUTHENTICATED request can read
-- both views, and through them every rating and 40 time in the
-- database -- even though the tables themselves are correctly locked
-- to `to authenticated`.
--
-- SPEC.md section 17 puts public access out of scope, so this is
-- almost certainly not what you want. The two lines below close it
-- by making the views respect the caller's RLS instead of the
-- owner's.
--
-- CLAUDE.md rule 6 says access control never changes without
-- flagging it first, so these are left commented. Uncomment both
-- before running if you agree.
-- ============================================================

alter view prospect_attribute_ratings set (security_invoker = true);
alter view prospect_speed             set (security_invoker = true);
