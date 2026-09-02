-- ============================================================
-- BIG BOARD V2 MIGRATION
-- Applied ON TOP of migration.sql (v1). Never edit that file.
-- Governed by SPEC-V2.md. Run once, in the Supabase SQL editor.
--
-- BEFORE APPLYING TO THE LIVE DATABASE:
--   1. Take a manual database backup / restore point. Git tags do
--      not cover the database (HANDOFF §9); this migration
--      rewrites every RLS policy and renames a table.
--   2. Apply to a staging copy first if one is available.
--
-- MANUAL STEPS SQL CANNOT DO (Supabase dashboard, after applying):
--   * Auth -> Sign In / Up: ENABLE public signups
--   * Auth -> Sign In / Up: REQUIRE email confirmation
--   * Auth -> Providers -> Password: enable leaked-password
--     protection (closes v1 HANDOFF gap #4)
--   * Vercel: add GEMINI_API_KEY (Secret) and GEMINI_MODEL env
--     vars, then trigger a redeploy (env vars do not apply to
--     existing builds)
--
-- Fixed UUIDs (documented, referenced by later sections):
--   system org  (owns seed templates, not joinable):
--     00000000-0000-4000-8000-000000000000
--   default org (NCSU Club Flag Football, owns all v1 data):
--     11111111-1111-4111-8111-111111111111
-- ============================================================

begin;

-- ============================================================
-- 1. ORGS
-- ============================================================

create table orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. officers -> profiles  (SPEC-V2 B5)
-- is_admin survives until §9 picks the default org's owner.
-- FKs from ratings/drill_results/selections/comments follow the
-- rename untouched.
-- ============================================================

alter table officers rename to profiles;

-- ============================================================
-- 3. MEMBERSHIPS + INVITE CODES
-- ============================================================

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('owner','admin','evaluator','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Exactly one owner per org, enforced by the database.
create unique index one_owner_per_org on memberships (org_id)
  where role = 'owner';

-- role CHECK is the guarantee behind "admin by promotion only,
-- never by invite code": an admin code is inexpressible.
create table invite_codes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  role       text not null check (role in ('evaluator','viewer')),
  code       text not null unique,
  rotated_at timestamptz not null default now(),
  unique (org_id, role)
);

-- ============================================================
-- 4. app SCHEMA — helpers used by RLS policies and RPCs.
-- Not exposed via PostgREST. security definer breaks the
-- memberships-checking-memberships RLS recursion (SPEC-V2 §2.5).
-- ============================================================

create schema if not exists app;
grant usage on schema app to authenticated;

create or replace function app.system_org_id()
returns uuid language sql immutable as
$$ select '00000000-0000-4000-8000-000000000000'::uuid $$;

create or replace function app.org_role(p_org uuid)
returns text language sql stable security definer set search_path = public as
$$ select role from memberships where org_id = p_org and user_id = auth.uid() $$;

create or replace function app.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select p_org is not null and app.org_role(p_org) is not null $$;

create or replace function app.is_evaluator(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(app.org_role(p_org) in ('evaluator','admin','owner'), false) $$;

create or replace function app.is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select app.org_role(p_org) in ('admin','owner') $$;

create or replace function app.is_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select app.org_role(p_org) = 'owner' $$;

create or replace function app.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from memberships a
    join memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

/*
 * The org id from a storage path's first segment, or null.
 *
 * The headshot policies authorize on this. A hard ::uuid cast would
 * throw on any object whose name is not {uuid}/..., and an exception
 * raised inside an RLS policy fails the whole query - so one file
 * uploaded through the Supabase dashboard would break storage for
 * every user. Returning null instead denies access to that one object
 * and leaves the rest working.
 */
create or replace function app.path_org(p_name text)
returns uuid language plpgsql immutable as
$$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end
$$;

create or replace function app.email_confirmed()
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null
  )
$$;

-- Signup trap: with email confirmation required, signUp returns no
-- session, so the client cannot insert its own profiles row (RLS
-- needs auth.uid()). The profile is created here instead, from the
-- signup metadata, the moment the auth user is created. The
-- profiles_insert policy below stays as a first-login fallback.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Human-readable, unambiguous-alphabet codes: EVAL-7K2M / VIEW-....
create or replace function app.generate_invite_code(p_role text)
returns text language plpgsql volatile security definer set search_path = public as
$$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  prefix text := case p_role when 'evaluator' then 'EVAL'
                             when 'viewer'    then 'VIEW' end;
  suffix text;
  i int;
begin
  if prefix is null then
    raise exception 'invalid invite role %', p_role;
  end if;
  loop
    suffix := '';
    for i in 1..4 loop
      suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from invite_codes where code = prefix || '-' || suffix);
  end loop;
  return prefix || '-' || suffix;
end
$$;

-- ============================================================
-- 5. TEMPLATE TABLES (SPEC-V2 §3.1)
-- A position's judged-attribute list is DERIVED from its weight
-- rows; there is no separate list to drift.
-- ============================================================

create table templates (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references orgs(id) on delete cascade,
  name                    text not null,
  sport                   text not null,
  min_ratings_for_display int  not null default 3,
  created_at              timestamptz not null default now()
);

create table template_positions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  code        text not null,
  label       text not null,
  sort_order  int  not null,
  unique (template_id, code)
);

create table template_attributes (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  key         text not null,
  label       text not null,
  short       text not null,
  unique (template_id, key)
);

create table template_drills (
  id                       uuid primary key default gen_random_uuid(),
  template_id              uuid not null references templates(id) on delete cascade,
  org_id                   uuid not null references orgs(id) on delete cascade,
  key                      text not null,
  label                    text not null,
  unit                     text not null,
  direction                text not null check (direction in ('lower_is_better','higher_is_better')),
  max_attempts             int  not null default 2 check (max_attempts between 1 and 5),
  min_timed_for_percentile int  not null default 15,
  value_min                numeric not null,
  value_max                numeric not null,
  decimals                 int  not null default 2,
  unique (template_id, key),
  check (value_min < value_max)
);

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

-- Weights sum to exactly 100 per position (or 0 mid-teardown).
-- Deferred so a single-transaction rebalance can pass through
-- intermediate states.
create or replace function app.check_position_weights()
returns trigger language plpgsql as
$$
declare
  v_pos uuid := coalesce(new.position_id, old.position_id);
  v_sum int;
begin
  select coalesce(sum(weight), 0) into v_sum
  from position_weights where position_id = v_pos;
  if v_sum not in (0, 100) then
    raise exception 'position weights must sum to 100, got % for position %', v_sum, v_pos;
  end if;
  return null;
end
$$;

create constraint trigger position_weights_sum
  after insert or update or delete on position_weights
  deferrable initially deferred
  for each row execute function app.check_position_weights();

-- ============================================================
-- 6. AI USAGE (SPEC-V2 §6.5)
-- ============================================================

create table ai_usage (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  route      text not null,
  created_at timestamptz not null default now()
);
create index on ai_usage (user_id, created_at);
create index on ai_usage (created_at);

-- ============================================================
-- 7. TEMPLATE COPY (copy-on-create, SPEC-V2 §3.5)
-- Weight rows are re-pointed by joining old components to new
-- ones on code/key, which are unique per template.
-- ============================================================

create or replace function app.copy_template(p_src uuid, p_dest_org uuid)
returns uuid language plpgsql volatile security definer set search_path = public as
$$
declare
  v_new uuid;
begin
  insert into templates (org_id, name, sport, min_ratings_for_display)
  select p_dest_org, name, sport, min_ratings_for_display
  from templates where id = p_src
  returning id into v_new;

  if v_new is null then
    raise exception 'source template % not found', p_src;
  end if;

  insert into template_positions (template_id, org_id, code, label, sort_order)
  select v_new, p_dest_org, code, label, sort_order
  from template_positions where template_id = p_src;

  insert into template_attributes (template_id, org_id, key, label, short)
  select v_new, p_dest_org, key, label, short
  from template_attributes where template_id = p_src;

  insert into template_drills (template_id, org_id, key, label, unit, direction,
                               max_attempts, min_timed_for_percentile,
                               value_min, value_max, decimals)
  select v_new, p_dest_org, key, label, unit, direction,
         max_attempts, min_timed_for_percentile, value_min, value_max, decimals
  from template_drills where template_id = p_src;

  insert into position_weights (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select v_new, p_dest_org, np.id, na.id, nd.id, w.weight
  from position_weights w
  join template_positions sp on sp.id = w.position_id
  join template_positions np on np.template_id = v_new and np.code = sp.code
  left join template_attributes sa on sa.id = w.attribute_id
  left join template_attributes na on na.template_id = v_new and na.key = sa.key
  left join template_drills sd on sd.id = w.drill_id
  left join template_drills nd on nd.template_id = v_new and nd.key = sd.key
  where w.template_id = p_src;

  return v_new;
end
$$;

-- ============================================================
-- 8. SEED TEMPLATES (owned by the system org; SPEC-V2 §3.6, §3.7)
-- ============================================================

insert into orgs (id, name) values (app.system_org_id(), '__system__');

-- ---------- Seed 1: Flag Football (exact v1 port) ----------
do $seed_flag$
declare
  v_sys uuid := app.system_org_id();
  v_tpl uuid;
begin
  insert into templates (org_id, name, sport, min_ratings_for_display)
  values (v_sys, 'Flag Football', 'flag_football', 3)
  returning id into v_tpl;

  insert into template_attributes (template_id, org_id, key, label, short) values
    (v_tpl, v_sys, 'catching',        'Catching',        'CTH'),
    (v_tpl, v_sys, 'quickness',       'Quickness',       'QCK'),
    (v_tpl, v_sys, 'route_running',   'Route Running',   'RTE'),
    (v_tpl, v_sys, 'coverage',        'Coverage',        'COV'),
    (v_tpl, v_sys, 'flag_pulling',    'Flag Pulling',    'FLG'),
    (v_tpl, v_sys, 'throwing_power',  'Throwing Power',  'PWR'),
    (v_tpl, v_sys, 'accuracy',        'Accuracy',        'ACC'),
    (v_tpl, v_sys, 'pocket_movement', 'Pocket Movement', 'PKT'),
    (v_tpl, v_sys, 'blocking',        'Blocking',        'BLK');

  -- v1 range CHECK (0 < value < 20) becomes template data (B8).
  insert into template_drills (template_id, org_id, key, label, unit, direction,
                               max_attempts, min_timed_for_percentile,
                               value_min, value_max, decimals) values
    (v_tpl, v_sys, 'forty', '40 Yard Dash', 's', 'lower_is_better', 2, 15, 0, 20, 2);

  -- sort_order = v1 BOARD_ORDER
  insert into template_positions (template_id, org_id, code, label, sort_order) values
    (v_tpl, v_sys, 'QB', 'Quarterback',    1),
    (v_tpl, v_sys, 'R',  'Rusher',         2),
    (v_tpl, v_sys, 'WR', 'Wide Receiver',  3),
    (v_tpl, v_sys, 'DB', 'Defensive Back', 4),
    (v_tpl, v_sys, 'LB', 'Linebacker',     5),
    (v_tpl, v_sys, 'OL', 'Offensive Line', 6);

  -- v1 "speed" weight maps to the forty drill (B7).
  insert into position_weights (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select v_tpl, v_sys, p.id, a.id, d.id, w.weight
  from (values
    ('QB', 'accuracy',        null,    35),
    ('QB', 'throwing_power',  null,    30),
    ('QB', 'pocket_movement', null,    20),
    ('QB', null,              'forty', 15),
    ('R',  'quickness',       null,    35),
    ('R',  'flag_pulling',    null,    30),
    ('R',  null,              'forty', 35),
    ('WR', 'catching',        null,    30),
    ('WR', 'quickness',       null,    20),
    ('WR', 'route_running',   null,    20),
    ('WR', null,              'forty', 30),
    ('DB', 'coverage',        null,    30),
    ('DB', 'quickness',       null,    20),
    ('DB', 'flag_pulling',    null,    20),
    ('DB', null,              'forty', 30),
    ('LB', 'coverage',        null,    30),
    ('LB', 'flag_pulling',    null,    25),
    ('LB', 'quickness',       null,    20),
    ('LB', null,              'forty', 25),
    ('OL', 'blocking',        null,    40),
    ('OL', 'quickness',       null,    25),
    ('OL', 'catching',        null,    20),
    ('OL', null,              'forty', 15)
  ) as w(code, attr_key, drill_key, weight)
  join template_positions p on p.template_id = v_tpl and p.code = w.code
  left join template_attributes a on a.template_id = v_tpl and a.key = w.attr_key
  left join template_drills d on d.template_id = v_tpl and d.key = w.drill_key;
end
$seed_flag$;

-- ---------- Seed 2: Baseball ----------
do $seed_baseball$
declare
  v_sys uuid := app.system_org_id();
  v_tpl uuid;
begin
  insert into templates (org_id, name, sport, min_ratings_for_display)
  values (v_sys, 'Baseball', 'baseball', 3)
  returning id into v_tpl;

  insert into template_attributes (template_id, org_id, key, label, short) values
    (v_tpl, v_sys, 'contact_hitting', 'Contact Hitting', 'CON'),
    (v_tpl, v_sys, 'power_hitting',   'Power Hitting',   'POW'),
    (v_tpl, v_sys, 'ground_balls',    'Ground Balls',    'GB'),
    (v_tpl, v_sys, 'fly_balls',       'Fly Balls',       'FB'),
    (v_tpl, v_sys, 'receiving',       'Receiving',       'RCV'),
    (v_tpl, v_sys, 'arm_accuracy',    'Arm Accuracy',    'ACC'),
    (v_tpl, v_sys, 'base_running',    'Base Running',    'BSR'),
    (v_tpl, v_sys, 'command',         'Command',         'CMD'),
    (v_tpl, v_sys, 'breaking_ball',   'Breaking Ball',   'BRK'),
    (v_tpl, v_sys, 'offspeed',        'Offspeed',        'OFS');

  insert into template_drills (template_id, org_id, key, label, unit, direction,
                               max_attempts, min_timed_for_percentile,
                               value_min, value_max, decimals) values
    (v_tpl, v_sys, 'sixty_yard_dash',   '60 Yard Dash',       's',   'lower_is_better',  2, 15, 0, 20,  2),
    (v_tpl, v_sys, 'exit_velocity',     'Exit Velocity',      'mph', 'higher_is_better', 2, 15, 0, 130, 1),
    (v_tpl, v_sys, 'throwing_velocity', 'Throwing Velocity',  'mph', 'higher_is_better', 2, 15, 0, 110, 1);

  insert into template_positions (template_id, org_id, code, label, sort_order) values
    (v_tpl, v_sys, 'P',  'Pitcher',      1),
    (v_tpl, v_sys, 'C',  'Catcher',      2),
    (v_tpl, v_sys, 'SS', 'Shortstop',    3),
    (v_tpl, v_sys, '2B', 'Second Base',  4),
    (v_tpl, v_sys, '3B', 'Third Base',   5),
    (v_tpl, v_sys, '1B', 'First Base',   6),
    (v_tpl, v_sys, 'CF', 'Center Field', 7),
    (v_tpl, v_sys, 'LF', 'Left Field',   8),
    (v_tpl, v_sys, 'RF', 'Right Field',  9);

  -- Every position sums to 100 (verified in SPEC-V2 §3.7).
  -- P has no hitting rows: pitchers are not rated on hitting.
  insert into position_weights (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select v_tpl, v_sys, p.id, a.id, d.id, w.weight
  from (values
    ('P',  'command',         null,                30),
    ('P',  null,              'throwing_velocity', 25),
    ('P',  'breaking_ball',   null,                20),
    ('P',  'offspeed',        null,                15),
    ('P',  'ground_balls',    null,                10),
    ('C',  'receiving',       null,                25),
    ('C',  'arm_accuracy',    null,                15),
    ('C',  null,              'throwing_velocity', 15),
    ('C',  'contact_hitting', null,                15),
    ('C',  'power_hitting',   null,                10),
    ('C',  null,              'exit_velocity',     10),
    ('C',  null,              'sixty_yard_dash',    5),
    ('C',  'base_running',    null,                 5),
    ('1B', 'contact_hitting', null,                25),
    ('1B', 'power_hitting',   null,                20),
    ('1B', 'ground_balls',    null,                20),
    ('1B', null,              'exit_velocity',     15),
    ('1B', 'base_running',    null,                10),
    ('1B', 'arm_accuracy',    null,                 5),
    ('1B', null,              'sixty_yard_dash',    5),
    ('2B', 'ground_balls',    null,                25),
    ('2B', 'contact_hitting', null,                20),
    ('2B', 'base_running',    null,                15),
    ('2B', null,              'sixty_yard_dash',   15),
    ('2B', 'arm_accuracy',    null,                10),
    ('2B', null,              'exit_velocity',     10),
    ('2B', 'power_hitting',   null,                 5),
    ('SS', 'ground_balls',    null,                25),
    ('SS', 'contact_hitting', null,                15),
    ('SS', null,              'sixty_yard_dash',   15),
    ('SS', 'arm_accuracy',    null,                15),
    ('SS', null,              'throwing_velocity', 10),
    ('SS', 'base_running',    null,                10),
    ('SS', null,              'exit_velocity',     10),
    ('3B', 'ground_balls',    null,                25),
    ('3B', null,              'throwing_velocity', 15),
    ('3B', 'power_hitting',   null,                15),
    ('3B', 'contact_hitting', null,                15),
    ('3B', null,              'exit_velocity',     15),
    ('3B', 'arm_accuracy',    null,                10),
    ('3B', null,              'sixty_yard_dash',    5),
    ('LF', 'fly_balls',       null,                20),
    ('LF', 'contact_hitting', null,                20),
    ('LF', 'power_hitting',   null,                20),
    ('LF', null,              'exit_velocity',     15),
    ('LF', null,              'sixty_yard_dash',   10),
    ('LF', 'base_running',    null,                10),
    ('LF', 'arm_accuracy',    null,                 5),
    ('CF', 'fly_balls',       null,                25),
    ('CF', null,              'sixty_yard_dash',   20),
    ('CF', 'base_running',    null,                15),
    ('CF', 'contact_hitting', null,                15),
    ('CF', 'power_hitting',   null,                10),
    ('CF', null,              'exit_velocity',     10),
    ('CF', 'arm_accuracy',    null,                 5),
    ('RF', 'fly_balls',       null,                20),
    ('RF', 'power_hitting',   null,                20),
    ('RF', null,              'throwing_velocity', 15),
    ('RF', null,              'exit_velocity',     15),
    ('RF', 'contact_hitting', null,                15),
    ('RF', null,              'sixty_yard_dash',    5),
    ('RF', 'base_running',    null,                 5),
    ('RF', 'arm_accuracy',    null,                 5)
  ) as w(code, attr_key, drill_key, weight)
  join template_positions p on p.template_id = v_tpl and p.code = w.code
  left join template_attributes a on a.template_id = v_tpl and a.key = w.attr_key
  left join template_drills d on d.template_id = v_tpl and d.key = w.drill_key;
end
$seed_baseball$;

-- ============================================================
-- 9. DEFAULT ORG — migrate all v1 data (SPEC-V2 §8)
-- Owner = oldest is_admin profile (v1 has exactly one officer).
-- Other profiles, if any exist by migration day, become
-- evaluators, promotable afterward from the Account tab.
-- ============================================================

do $default_org$
declare
  v_org   uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_src   uuid;
  v_owner uuid;
begin
  insert into orgs (id, name) values (v_org, 'NCSU Club Flag Football');

  select id into v_src from templates
  where org_id = app.system_org_id() and sport = 'flag_football';
  perform app.copy_template(v_src, v_org);

  select id into v_owner from profiles where is_admin order by created_at asc limit 1;
  if v_owner is null then
    select id into v_owner from profiles order by created_at asc limit 1;
  end if;
  if v_owner is null then
    raise exception 'no profile found to attach as default org owner';
  end if;

  insert into memberships (org_id, user_id, role) values (v_org, v_owner, 'owner');
  insert into memberships (org_id, user_id, role)
  select v_org, id, 'evaluator' from profiles where id <> v_owner;

  insert into invite_codes (org_id, role, code) values
    (v_org, 'evaluator', app.generate_invite_code('evaluator')),
    (v_org, 'viewer',    app.generate_invite_code('viewer'));
end
$default_org$;

-- NOTE: is_admin is NOT dropped here. Three v1 policies
-- (delete_prospects, create_tryouts, update_tryouts) still reference
-- it, and Postgres refuses to drop a column those depend on. It is
-- dropped in section 12, immediately after every v1 policy is gone.

-- ============================================================
-- 10. org_id EVERYWHERE + backfill (SPEC-V2 §2.4, B6)
-- profiles is the one deliberate exception (global, cross-org).
-- ============================================================

alter table tryouts       add column org_id uuid references orgs(id) on delete cascade;
alter table prospects     add column org_id uuid references orgs(id) on delete cascade;
alter table ratings       add column org_id uuid references orgs(id) on delete cascade;
alter table drill_results add column org_id uuid references orgs(id) on delete cascade;
alter table selections    add column org_id uuid references orgs(id) on delete cascade;
alter table comments      add column org_id uuid references orgs(id) on delete cascade;

update tryouts       set org_id = '11111111-1111-4111-8111-111111111111';
update prospects     set org_id = '11111111-1111-4111-8111-111111111111';
update ratings       set org_id = '11111111-1111-4111-8111-111111111111';
update drill_results set org_id = '11111111-1111-4111-8111-111111111111';
update selections    set org_id = '11111111-1111-4111-8111-111111111111';
update comments      set org_id = '11111111-1111-4111-8111-111111111111';

alter table tryouts       alter column org_id set not null;
alter table prospects     alter column org_id set not null;
alter table ratings       alter column org_id set not null;
alter table drill_results alter column org_id set not null;
alter table selections    alter column org_id set not null;
alter table comments      alter column org_id set not null;

create index on prospects (org_id);
create index on ratings (org_id);
create index on drill_results (org_id);
create index on selections (org_id);
create index on comments (org_id);
create index on memberships (user_id);
create index on memberships (org_id);

-- tryouts bind to the org's template. Existing 'forty' drill_results
-- rows resolve against the seeded forty drill; no data rewrite.
alter table tryouts add column template_id uuid references templates(id);
update tryouts set template_id = (
  select id from templates
  where org_id = '11111111-1111-4111-8111-111111111111'
);
alter table tryouts alter column template_id set not null;

-- Derive-org triggers: org_id on child rows always comes from the
-- parent, overwriting whatever the client sent (SPEC-V2 §2.4).
create or replace function app.set_org_from_tryout()
returns trigger language plpgsql as
$$
begin
  select org_id into new.org_id from tryouts where id = new.tryout_id;
  if new.org_id is null then
    raise exception 'tryout % not found', new.tryout_id;
  end if;
  return new;
end
$$;

create or replace function app.set_org_from_prospect()
returns trigger language plpgsql as
$$
begin
  select org_id into new.org_id from prospects where id = new.prospect_id;
  if new.org_id is null then
    raise exception 'prospect % not found', new.prospect_id;
  end if;
  return new;
end
$$;

create trigger set_org before insert on prospects     for each row execute function app.set_org_from_tryout();
create trigger set_org before insert on selections    for each row execute function app.set_org_from_tryout();
create trigger set_org before insert on ratings       for each row execute function app.set_org_from_prospect();
create trigger set_org before insert on drill_results for each row execute function app.set_org_from_prospect();
create trigger set_org before insert on comments      for each row execute function app.set_org_from_prospect();

-- Forty-specific range dies (B8); per-drill ranges live on
-- template_drills, enforced in UI + server validation.
-- The v1 views read drill_results.value, and Postgres refuses to alter
-- the type of a column a view depends on. They are dropped here rather
-- than in section 11 for that reason; section 11 recreates both in
-- their v2 shape.
drop view if exists prospect_speed;
drop view if exists prospect_attribute_ratings;

-- v1 typed this numeric(4,2) for a 40 time, which caps at 99.99. A
-- baseball exit velocity reaches 130, so an insert would fail with a
-- numeric field overflow. The old CHECK goes first, then the widening,
-- then the v2 CHECK - altering the type under a `value < 20` constraint
-- would leave the column able to hold values the constraint still bans.
alter table drill_results drop constraint if exists drill_results_value_check;
alter table drill_results alter column value type numeric(6,2);
alter table drill_results add constraint drill_results_value_check check (value > 0);

-- Storage paths gain an {org_id}/ prefix (B21), because the storage
-- policies below authorize on the FIRST path segment. All existing
-- objects belong to the default org.
--
-- v1 paths are already {tryout_id}/{prospect_id}.jpg, so they contain
-- a slash - the guard is "does not already start with this org id",
-- NOT "has no slash". Getting that wrong leaves the tryout id in
-- segment one, which is a perfectly valid uuid that is not an org id,
-- so app.is_member() returns false and every headshot silently stops
-- loading with no error anywhere.
update storage.objects
set name = '11111111-1111-4111-8111-111111111111/' || name
where bucket_id = 'headshots'
  and name not like '11111111-1111-4111-8111-111111111111/%';

update prospects
set headshot_url = '11111111-1111-4111-8111-111111111111/' || headshot_url
where headshot_url is not null
  and headshot_url not like '11111111-1111-4111-8111-111111111111/%';

-- ============================================================
-- 11. VIEWS (SPEC-V2 §3.2, B9)
-- security_invoker on both, same reason as v1: without it the
-- views would bypass the RLS of the tables underneath.
-- ============================================================

drop view if exists prospect_speed;
drop view if exists prospect_attribute_ratings;

create view prospect_attribute_ratings
with (security_invoker = true) as
select
  r.prospect_id,
  r.org_id,
  r.attribute_key,
  percentile_cont(0.5) within group (order by r.value) as team_rating,
  count(*) as rater_count
from ratings r
group by r.prospect_id, r.org_id, r.attribute_key;

-- Generalized replacement for prospect_speed. One row per measured
-- (prospect, drill) pair. Direction-aware: best = min or max, and
-- percentile 0 = worst / 100 = best in class either way. Untimed
-- prospects stay excluded from the ranking window (ranked over
-- timed rows only), exactly as v1.
create view prospect_drill_stats
with (security_invoker = true) as
with timed as (
  select
    p.id         as prospect_id,
    p.tryout_id,
    p.org_id,
    d.drill_key,
    td.direction,
    case when td.direction = 'lower_is_better'
         then min(d.value) else max(d.value) end as best,
    avg(d.value) as avg_value,
    count(d.id)  as attempts
  from prospects p
  join tryouts t on t.id = p.tryout_id
  join drill_results d on d.prospect_id = p.id
  join template_drills td on td.template_id = t.template_id and td.key = d.drill_key
  group by p.id, p.tryout_id, p.org_id, d.drill_key, td.direction
),
ranked as (
  select
    timed.*,
    round((percent_rank() over (
      partition by tryout_id, drill_key
      order by
        case when direction = 'lower_is_better'  then best end desc,
        case when direction = 'higher_is_better' then best end asc
    ) * 100)::numeric, 0) as percentile
  from timed
),
pool as (
  select tryout_id, drill_key, count(*) as measured_count
  from timed
  group by tryout_id, drill_key
)
select
  r.prospect_id,
  r.tryout_id,
  r.org_id,
  r.drill_key,
  r.best,
  round(r.avg_value, 2) as avg_value,
  r.attempts,
  r.percentile,
  pool.measured_count
from ranked r
join pool using (tryout_id, drill_key);

-- ============================================================
-- 12. RLS REWRITE (SPEC-V2 §2.5, B6)
-- Drop every existing policy, then create the full v2 set fresh.
-- The v1 asymmetries survive inside the org, per role:
--   ratings/comments stay own-rows, drill times stay anyone-
--   can-correct (evaluator+ in the org), prospect delete stays
--   destruction (admin+), tryouts still have NO delete.
-- ============================================================

do $drop_policies$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
       or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$drop_policies$;

-- Safe only now that no policy references it. Three v1 policies did
-- (delete_prospects, create_tryouts, update_tryouts); admin is a
-- per-org role in v2, so the global flag has no meaning left.
alter table profiles drop column is_admin;

-- Flush the deferred sum-to-100 checks queued by the seed inserts and
-- the default org's template copy. ALTER TABLE refuses to touch a table
-- with pending trigger events (55006), and position_weights has them
-- until that constraint trigger fires.
--
-- Doing it here also validates every seeded position NOW, with a clear
-- error naming the position, instead of at COMMIT where it would be
-- reported after everything else had already succeeded.
set constraints all immediate;

alter table orgs                enable row level security;
alter table profiles            enable row level security;  -- already on from v1 (officers); harmless
alter table memberships         enable row level security;
alter table invite_codes        enable row level security;
alter table templates           enable row level security;
alter table template_positions  enable row level security;
alter table template_attributes enable row level security;
alter table template_drills     enable row level security;
alter table position_weights    enable row level security;
alter table ai_usage            enable row level security;

-- orgs: creation/deletion via RPC only.
create policy orgs_select on orgs for select to authenticated
  using (app.is_member(id));
create policy orgs_update on orgs for update to authenticated
  using (app.is_admin(id)) with check (app.is_admin(id));

-- profiles: own row + co-members.
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or app.shares_org_with(id));
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- memberships: INSERT and role UPDATE happen only through RPCs
-- (cross-row invariants RLS cannot express). DELETE covers
-- leave-org (owner blocked) and removal within tier.
create policy memberships_select on memberships for select to authenticated
  using (app.is_member(org_id));
create policy memberships_delete on memberships for delete to authenticated
  using (
    (user_id = auth.uid() and role <> 'owner')
    or (app.is_admin(org_id) and role in ('evaluator','viewer'))
    or (app.is_owner(org_id) and user_id <> auth.uid())
  );

-- invite_codes: admin+ read; rotation via RPC only (clients must
-- not choose their own code strings).
create policy invite_codes_select on invite_codes for select to authenticated
  using (app.is_admin(org_id));

-- tryouts: still NO delete policy — a season is the historical record.
create policy tryouts_select on tryouts for select to authenticated
  using (app.is_member(org_id));
create policy tryouts_insert on tryouts for insert to authenticated
  with check (app.is_admin(org_id));
create policy tryouts_update on tryouts for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));

-- prospects: evaluator+ add/edit, admin+ delete (destruction).
create policy prospects_select on prospects for select to authenticated
  using (app.is_member(org_id));
create policy prospects_insert on prospects for insert to authenticated
  with check (app.is_evaluator(org_id));
create policy prospects_update on prospects for update to authenticated
  using (app.is_evaluator(org_id)) with check (app.is_evaluator(org_id));
create policy prospects_delete on prospects for delete to authenticated
  using (app.is_admin(org_id));

-- ratings: one person's opinion — own rows only, no role override.
create policy ratings_select on ratings for select to authenticated
  using (app.is_member(org_id));
create policy ratings_insert on ratings for insert to authenticated
  with check (officer_id = auth.uid() and app.is_evaluator(org_id));
create policy ratings_update on ratings for update to authenticated
  using (officer_id = auth.uid() and app.is_evaluator(org_id))
  with check (officer_id = auth.uid() and app.is_evaluator(org_id));
create policy ratings_delete on ratings for delete to authenticated
  using (officer_id = auth.uid() and app.is_evaluator(org_id));

-- drill_results: a measurement anyone present can correct —
-- evaluator+ in the org, self-stamped on write.
create policy drills_select on drill_results for select to authenticated
  using (app.is_member(org_id));
create policy drills_insert on drill_results for insert to authenticated
  with check (recorded_by = auth.uid() and app.is_evaluator(org_id));
create policy drills_update on drill_results for update to authenticated
  using (app.is_evaluator(org_id))
  with check (recorded_by = auth.uid() and app.is_evaluator(org_id));
create policy drills_delete on drill_results for delete to authenticated
  using (app.is_evaluator(org_id));

-- selections: shared list, evaluator+ toggles, self-stamped adds.
create policy selections_select on selections for select to authenticated
  using (app.is_member(org_id));
create policy selections_insert on selections for insert to authenticated
  with check (selected_by = auth.uid() and app.is_evaluator(org_id));
create policy selections_delete on selections for delete to authenticated
  using (app.is_evaluator(org_id));

-- comments: one person's words — nobody else deletes them.
create policy comments_select on comments for select to authenticated
  using (app.is_member(org_id));
create policy comments_insert on comments for insert to authenticated
  with check (officer_id = auth.uid() and app.is_evaluator(org_id));
create policy comments_delete on comments for delete to authenticated
  using (officer_id = auth.uid());

-- template tables: members read, admin+ writes. System-org seed
-- rows are invisible to everyone (nobody is a member).
create policy templates_select on templates for select to authenticated
  using (app.is_member(org_id));
create policy templates_insert on templates for insert to authenticated
  with check (app.is_admin(org_id));
create policy templates_update on templates for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy templates_delete on templates for delete to authenticated
  using (app.is_admin(org_id));

create policy tpos_select on template_positions for select to authenticated
  using (app.is_member(org_id));
create policy tpos_insert on template_positions for insert to authenticated
  with check (app.is_admin(org_id));
create policy tpos_update on template_positions for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy tpos_delete on template_positions for delete to authenticated
  using (app.is_admin(org_id));

create policy tattr_select on template_attributes for select to authenticated
  using (app.is_member(org_id));
create policy tattr_insert on template_attributes for insert to authenticated
  with check (app.is_admin(org_id));
create policy tattr_update on template_attributes for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy tattr_delete on template_attributes for delete to authenticated
  using (app.is_admin(org_id));

create policy tdrill_select on template_drills for select to authenticated
  using (app.is_member(org_id));
create policy tdrill_insert on template_drills for insert to authenticated
  with check (app.is_admin(org_id));
create policy tdrill_update on template_drills for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy tdrill_delete on template_drills for delete to authenticated
  using (app.is_admin(org_id));

create policy pw_select on position_weights for select to authenticated
  using (app.is_member(org_id));
create policy pw_insert on position_weights for insert to authenticated
  with check (app.is_admin(org_id));
create policy pw_update on position_weights for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy pw_delete on position_weights for delete to authenticated
  using (app.is_admin(org_id));

-- ai_usage: server routes insert as the calling user; admins see
-- their org's usage. No update/delete.
create policy ai_usage_select on ai_usage for select to authenticated
  using (app.is_admin(org_id));
create policy ai_usage_insert on ai_usage for insert to authenticated
  with check (user_id = auth.uid() and app.is_member(org_id));

-- storage: org-scoped by the path's first segment. Upsert needs
-- INSERT + SELECT + UPDATE together (v1 trap).
create policy headshots_select on storage.objects for select to authenticated
  using (bucket_id = 'headshots'
         and app.is_member(app.path_org(name)));
create policy headshots_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'headshots'
              and app.is_evaluator(app.path_org(name)));
create policy headshots_update on storage.objects for update to authenticated
  using (bucket_id = 'headshots'
         and app.is_evaluator(app.path_org(name)))
  with check (bucket_id = 'headshots'
              and app.is_evaluator(app.path_org(name)));
create policy headshots_delete on storage.objects for delete to authenticated
  using (bucket_id = 'headshots'
         and app.is_evaluator(app.path_org(name)));

-- ============================================================
-- 13. RPCs (SPEC-V2 §2.6) — security definer, they trust nothing
-- from the caller and validate everything themselves.
-- ============================================================

create or replace function public.create_org(p_name text, p_template_slug text)
returns uuid language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org uuid;
  v_src uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not app.email_confirmed() then raise exception 'email not confirmed'; end if;
  if p_template_slug not in ('flag_football', 'baseball', 'scratch') then
    raise exception 'unknown template %', p_template_slug;
  end if;

  insert into orgs (name) values (p_name) returning id into v_org;

  if p_template_slug = 'scratch' then
    insert into templates (org_id, name, sport)
    values (v_org, p_name || ' Template', 'custom');
  else
    select id into v_src from templates
    where org_id = app.system_org_id() and sport = p_template_slug;
    perform app.copy_template(v_src, v_org);
  end if;

  insert into memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into invite_codes (org_id, role, code) values
    (v_org, 'evaluator', app.generate_invite_code('evaluator')),
    (v_org, 'viewer',    app.generate_invite_code('viewer'));

  return v_org;
end
$$;

create or replace function public.join_org(p_code text)
returns uuid language plpgsql volatile security definer set search_path = public as
$$
declare
  v_rec invite_codes%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not app.email_confirmed() then raise exception 'email not confirmed'; end if;

  select * into v_rec from invite_codes where code = upper(trim(p_code));
  if not found then raise exception 'invalid invite code'; end if;

  if exists (select 1 from memberships
             where org_id = v_rec.org_id and user_id = auth.uid()) then
    raise exception 'already a member of this org';
  end if;

  insert into memberships (org_id, user_id, role)
  values (v_rec.org_id, auth.uid(), v_rec.role);

  return v_rec.org_id;
end
$$;

create or replace function public.rotate_invite_code(p_org uuid, p_role text)
returns text language plpgsql volatile security definer set search_path = public as
$$
declare
  v_code text;
begin
  if not app.is_admin(p_org) then raise exception 'not authorized'; end if;
  v_code := app.generate_invite_code(p_role);
  update invite_codes set code = v_code, rotated_at = now()
  where org_id = p_org and role = p_role;
  if not found then raise exception 'no % code for this org', p_role; end if;
  return v_code;
end
$$;

create or replace function public.set_member_role(p_org uuid, p_member uuid, p_new_role text)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  caller_role text := app.org_role(p_org);
  target_role text;
begin
  if caller_role not in ('admin','owner') then raise exception 'not authorized'; end if;
  if p_member = auth.uid() then raise exception 'cannot change your own role'; end if;
  if p_new_role not in ('viewer','evaluator','admin') then
    raise exception 'invalid role %', p_new_role;
  end if;

  select role into target_role from memberships
  where org_id = p_org and user_id = p_member;
  if target_role is null then raise exception 'not a member'; end if;
  if target_role = 'owner' then raise exception 'cannot change the owner''s role'; end if;

  -- Admin is granted (and revoked) by the OWNER only.
  if caller_role = 'admin' and (target_role = 'admin' or p_new_role = 'admin') then
    raise exception 'only the owner may promote or demote admins';
  end if;

  update memberships set role = p_new_role
  where org_id = p_org and user_id = p_member;
end
$$;

create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
begin
  if not app.is_owner(p_org) then raise exception 'not authorized'; end if;
  if p_new_owner = auth.uid() then raise exception 'you are already the owner'; end if;
  if not exists (select 1 from memberships
                 where org_id = p_org and user_id = p_new_owner) then
    raise exception 'target is not a member of this org';
  end if;

  -- Demote first so the one-owner-per-org index never trips.
  update memberships set role = 'admin'
  where org_id = p_org and user_id = auth.uid();
  update memberships set role = 'owner'
  where org_id = p_org and user_id = p_new_owner;
end
$$;

create or replace function public.remove_member(p_org uuid, p_member uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  caller_role text := app.org_role(p_org);
  target_role text;
begin
  select role into target_role from memberships
  where org_id = p_org and user_id = p_member;
  if target_role is null then raise exception 'not a member'; end if;

  if p_member = auth.uid() then
    -- Leaving the org.
    if target_role = 'owner' then
      raise exception 'the owner must transfer ownership before leaving';
    end if;
  else
    if caller_role not in ('admin','owner') then raise exception 'not authorized'; end if;
    if target_role = 'owner' then raise exception 'the owner cannot be removed'; end if;
    if caller_role = 'admin' and target_role = 'admin' then
      raise exception 'only the owner may remove an admin';
    end if;
  end if;

  delete from memberships where org_id = p_org and user_id = p_member;
end
$$;

create or replace function public.delete_org(p_org uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
begin
  if not app.is_owner(p_org) then raise exception 'not authorized'; end if;
  if p_org = app.system_org_id() then raise exception 'cannot delete the system org'; end if;

  delete from storage.objects
  where bucket_id = 'headshots' and name like p_org::text || '/%';

  delete from orgs where id = p_org;  -- cascades everything else
end
$$;

-- ============================================================
-- 13b. TEMPLATE EDITING RPCs (SPEC-V2 section 3.1)
--
-- Three things the template editor needs that RLS alone cannot do:
--
--   * Replacing a position's weights ATOMICALLY. From the client library
--     each statement is its own transaction, so a delete-then-insert would
--     briefly leave the position at zero weight - and the sum-to-100 rule
--     could not be checked across the pair. Inside one function the
--     deferred constraint trigger fires once, at the end.
--
--   * Deleting an attribute or drill together with the RATINGS and DRILL
--     RESULTS recorded against it. Those tables key on the text
--     attribute_key / drill_key, so nothing cascades - and an admin cannot
--     delete another officer's rating (ratings_delete is own-rows-only, by
--     design). A security definer function is the only way to clear them,
--     and it re-checks admin rights itself.
-- ============================================================

create or replace function public.set_position_weights(
  p_position uuid,
  p_components jsonb
)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org uuid;
  v_tpl uuid;
  v_sum int;
begin
  select org_id, template_id into v_org, v_tpl
  from template_positions where id = p_position;

  if v_org is null then raise exception 'position not found'; end if;
  if not app.is_admin(v_org) then raise exception 'not authorized'; end if;

  delete from position_weights where position_id = p_position;

  -- A component key that does not resolve leaves BOTH ids null, which the
  -- num_nonnulls CHECK rejects - so a typo fails loudly instead of silently
  -- dropping a weighted input out of every rating at this position.
  insert into position_weights
    (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select
    v_tpl,
    v_org,
    p_position,
    case when c->>'kind' = 'attribute'
         then (select id from template_attributes
               where template_id = v_tpl and key = c->>'key') end,
    case when c->>'kind' = 'drill'
         then (select id from template_drills
               where template_id = v_tpl and key = c->>'key') end,
    (c->>'weight')::int
  from jsonb_array_elements(p_components) c;

  select coalesce(sum(weight), 0) into v_sum
  from position_weights where position_id = p_position;

  if v_sum <> 100 then
    raise exception 'weights must sum to 100, got %', v_sum;
  end if;
end
$$;

create or replace function public.delete_template_attribute(p_attribute uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org uuid;
  v_tpl uuid;
  v_key text;
begin
  select org_id, template_id, key into v_org, v_tpl, v_key
  from template_attributes where id = p_attribute;

  if v_org is null then raise exception 'attribute not found'; end if;
  if not app.is_admin(v_org) then raise exception 'not authorized'; end if;

  -- Must be unweighted everywhere FIRST. Deleting it here would cascade its
  -- position_weights rows, and the sum-to-100 trigger would then reject the
  -- whole transaction - so this would fail with a confusing weights error
  -- instead of a clear one. Making the admin remove it from each position
  -- deliberately is also the only way they consciously choose the weight
  -- that replaces it, rather than having the rating silently re-scale.
  if exists (select 1 from position_weights where attribute_id = p_attribute) then
    raise exception 'still weighted by % position(s)',
      (select count(*) from position_weights where attribute_id = p_attribute);
  end if;

  -- Ratings key on text, so nothing cascades. Leaving them would keep
  -- feeding a median for an attribute the template no longer has.
  delete from ratings r
  using prospects p, tryouts t
  where r.prospect_id = p.id
    and p.tryout_id = t.id
    and t.template_id = v_tpl
    and r.attribute_key = v_key;

  delete from template_attributes where id = p_attribute;
end
$$;

create or replace function public.delete_template_drill(p_drill uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org uuid;
  v_tpl uuid;
  v_key text;
begin
  select org_id, template_id, key into v_org, v_tpl, v_key
  from template_drills where id = p_drill;

  if v_org is null then raise exception 'drill not found'; end if;
  if not app.is_admin(v_org) then raise exception 'not authorized'; end if;

  -- Unweighted first, for the same reason as delete_template_attribute.
  if exists (select 1 from position_weights where drill_id = p_drill) then
    raise exception 'still weighted by % position(s)',
      (select count(*) from position_weights where drill_id = p_drill);
  end if;

  delete from drill_results d
  using prospects p, tryouts t
  where d.prospect_id = p.id
    and p.tryout_id = t.id
    and t.template_id = v_tpl
    and d.drill_key = v_key;

  delete from template_drills where id = p_drill;
end
$$;

/*
 * How many ratings / results a component deletion would take with it, so
 * the editor can warn with a real number instead of a vague caution.
 */
create or replace function public.component_usage(p_template uuid, p_key text)
returns TABLE (rating_count bigint, drill_count bigint)
language sql stable security definer set search_path = public as
$$
  select
    (select count(*) from ratings r
      join prospects p on p.id = r.prospect_id
      join tryouts t on t.id = p.tryout_id
     where t.template_id = p_template and r.attribute_key = p_key),
    (select count(*) from drill_results d
      join prospects p on p.id = d.prospect_id
      join tryouts t on t.id = p.tryout_id
     where t.template_id = p_template and d.drill_key = p_key)
$$;

/*
 * AI usage counters for the rate limiter (SPEC-V2 section 6.5).
 *
 * security definer on purpose, and it is REQUIRED rather than an
 * optimization: ai_usage SELECT is admin-only, so an evaluator
 * counting their own calls through RLS would always read zero and
 * the per-user cap would never fire. The global figure cannot be
 * read through RLS by anyone, since it spans orgs.
 *
 * Returns only two integers about the caller's own day and the
 * system total - no rows, no other user's activity.
 */
create or replace function public.ai_usage_today()
returns TABLE (mine bigint, total bigint)
language sql stable security definer set search_path = public as
$$
  select
    (select count(*) from ai_usage
      where user_id = auth.uid()
        and created_at >= date_trunc('day', now() at time zone 'utc')),
    (select count(*) from ai_usage
      where created_at >= date_trunc('day', now() at time zone 'utc'))
$$;

-- ============================================================
-- 14. GRANTS
-- app helpers run inside policies as the querying user, so
-- authenticated needs EXECUTE. Everything is revoked from anon.
-- ============================================================

revoke all on all functions in schema app from public, anon;
grant execute on function
  app.system_org_id(),
  app.org_role(uuid),
  app.is_member(uuid),
  app.is_evaluator(uuid),
  app.is_admin(uuid),
  app.is_owner(uuid),
  app.shares_org_with(uuid),
  app.email_confirmed(),
  app.path_org(text)
to authenticated;

revoke all on function public.create_org(text, text)              from public, anon;
revoke all on function public.join_org(text)                      from public, anon;
revoke all on function public.rotate_invite_code(uuid, text)      from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text)   from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid)      from public, anon;
revoke all on function public.remove_member(uuid, uuid)           from public, anon;
revoke all on function public.delete_org(uuid)                    from public, anon;
revoke all on function public.set_position_weights(uuid, jsonb)   from public, anon;
revoke all on function public.delete_template_attribute(uuid)     from public, anon;
revoke all on function public.delete_template_drill(uuid)         from public, anon;
revoke all on function public.component_usage(uuid, text)         from public, anon;
revoke all on function public.ai_usage_today()                     from public, anon;
grant execute on function
  public.create_org(text, text),
  public.join_org(text),
  public.rotate_invite_code(uuid, text),
  public.set_member_role(uuid, uuid, text),
  public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid, uuid),
  public.delete_org(uuid),
  public.set_position_weights(uuid, jsonb),
  public.delete_template_attribute(uuid),
  public.delete_template_drill(uuid),
  public.component_usage(uuid, text),
  public.ai_usage_today()
to authenticated;

commit;

-- ============================================================
-- 15. LIFECYCLE CLEANUP (SPEC-V2 §7) — outside the transaction.
-- Nightly at 09:10 UTC: delete unconfirmed auth users older than
-- 7 days, and confirmed users with zero memberships older than
-- 30 days. Never touches anyone holding a membership. Runs are
-- auditable in cron.job_run_details.
-- ============================================================

create extension if not exists pg_cron;

create or replace function app.cleanup_stale_users()
returns void language plpgsql volatile security definer set search_path = public as
$$
begin
  delete from auth.users u
  where u.email_confirmed_at is null
    and u.created_at < now() - interval '7 days';

  delete from auth.users u
  where u.email_confirmed_at is not null
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from memberships m where m.user_id = u.id);
end
$$;

revoke all on function app.cleanup_stale_users() from public, anon, authenticated;

select cron.schedule(
  'cleanup-stale-users',
  '10 9 * * *',
  'select app.cleanup_stale_users()'
);
