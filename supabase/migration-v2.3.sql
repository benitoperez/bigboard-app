-- ============================================================
-- BIG BOARD v2.3
-- Applied ON TOP of migration-v2.2.sql. Migrations are
-- append-only; the earlier files have already run.
--
-- Adds: Volleyball and Track seed templates, and opens both to
-- create_org. No table, policy or RLS change.
-- ============================================================

begin;

-- ---------- Seed 3: Volleyball ----------
-- Indoor six-a-side. Vertical jump is the one measured drill; it is
-- weighted heaviest at the net (MB, OPP) and not at all for the
-- libero, who never attacks or blocks.
do $seed_volleyball$
declare
  v_sys uuid := app.system_org_id();
  v_tpl uuid;
begin
  insert into templates (org_id, name, sport, min_ratings_for_display)
  values (v_sys, 'Volleyball', 'volleyball', 3)
  returning id into v_tpl;

  insert into template_attributes (template_id, org_id, key, label, short) values
    (v_tpl, v_sys, 'serving',   'Serving',   'SRV'),
    (v_tpl, v_sys, 'passing',   'Passing',   'PAS'),
    (v_tpl, v_sys, 'setting',   'Setting',   'SET'),
    (v_tpl, v_sys, 'attacking', 'Attacking', 'ATK'),
    (v_tpl, v_sys, 'blocking',  'Blocking',  'BLK'),
    (v_tpl, v_sys, 'digging',   'Digging',   'DIG'),
    (v_tpl, v_sys, 'court_iq',  'Court IQ',  'IQ');

  insert into template_drills (template_id, org_id, key, label, unit, direction,
                               max_attempts, min_timed_for_percentile,
                               value_min, value_max, decimals) values
    (v_tpl, v_sys, 'vertical_jump', 'Vertical Jump', 'in', 'higher_is_better', 3, 10, 0, 60, 1);

  insert into template_positions (template_id, org_id, code, label, sort_order) values
    (v_tpl, v_sys, 'OH',  'Outside Hitter',  1),
    (v_tpl, v_sys, 'OPP', 'Opposite',        2),
    (v_tpl, v_sys, 'MB',  'Middle Blocker',  3),
    (v_tpl, v_sys, 'S',   'Setter',          4),
    (v_tpl, v_sys, 'L',   'Libero',          5);

  -- Every position sums to 100.
  insert into position_weights (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select v_tpl, v_sys, p.id, a.id, d.id, w.weight
  from (values
    ('OH',  'attacking', null,            25),
    ('OH',  'passing',   null,            20),
    ('OH',  null,        'vertical_jump', 15),
    ('OH',  'serving',   null,            10),
    ('OH',  'digging',   null,            10),
    ('OH',  'blocking',  null,            10),
    ('OH',  'court_iq',  null,            10),
    ('OPP', 'attacking', null,            30),
    ('OPP', 'blocking',  null,            20),
    ('OPP', null,        'vertical_jump', 20),
    ('OPP', 'serving',   null,            10),
    ('OPP', 'digging',   null,            10),
    ('OPP', 'court_iq',  null,            10),
    ('MB',  'blocking',  null,            30),
    ('MB',  'attacking', null,            25),
    ('MB',  null,        'vertical_jump', 25),
    ('MB',  'serving',   null,            10),
    ('MB',  'court_iq',  null,            10),
    ('S',   'setting',   null,            40),
    ('S',   'court_iq',  null,            20),
    ('S',   'serving',   null,            10),
    ('S',   'digging',   null,            10),
    ('S',   'blocking',  null,            10),
    ('S',   null,        'vertical_jump', 10),
    ('L',   'passing',   null,            35),
    ('L',   'digging',   null,            35),
    ('L',   'court_iq',  null,            15),
    ('L',   'setting',   null,            10),
    ('L',   'serving',   null,             5)
  ) as w(code, attr_key, drill_key, weight)
  join template_positions p on p.template_id = v_tpl and p.code = w.code
  left join template_attributes a on a.template_id = v_tpl and a.key = w.attr_key
  left join template_drills d on d.template_id = v_tpl and d.key = w.drill_key;
end
$seed_volleyball$;

-- ---------- Seed 4: Track ----------
-- A "position" is an event, and an event is ranked on its time.
-- The only judged input is acceleration, at 10 on the two short
-- sprints, where the start decides the race.
--
-- min_ratings_for_display is 0: a pure time event has no officer
-- ratings at all, so any higher floor would gate it forever. The
-- coverage half of the gate still applies - no time, no rating.
--
-- min_timed_for_percentile is 5, not 15: a club tryout rarely puts
-- fifteen people in the 3200. Times past a minute are entered and
-- shown as m:ss but stored in seconds, which the ranges below use.
do $seed_track$
declare
  v_sys uuid := app.system_org_id();
  v_tpl uuid;
begin
  insert into templates (org_id, name, sport, min_ratings_for_display)
  values (v_sys, 'Track', 'track', 0)
  returning id into v_tpl;

  insert into template_attributes (template_id, org_id, key, label, short) values
    (v_tpl, v_sys, 'acceleration', 'Acceleration', 'ACL');

  insert into template_drills (template_id, org_id, key, label, unit, direction,
                               max_attempts, min_timed_for_percentile,
                               value_min, value_max, decimals) values
    (v_tpl, v_sys, 'run_60m',   '60m',   's', 'lower_is_better', 2, 5, 0, 15,   2),
    (v_tpl, v_sys, 'run_100m',  '100m',  's', 'lower_is_better', 2, 5, 0, 25,   2),
    (v_tpl, v_sys, 'run_200m',  '200m',  's', 'lower_is_better', 2, 5, 0, 50,   2),
    (v_tpl, v_sys, 'run_400m',  '400m',  's', 'lower_is_better', 2, 5, 0, 120,  2),
    (v_tpl, v_sys, 'run_800m',  '800m',  's', 'lower_is_better', 1, 5, 0, 300,  1),
    (v_tpl, v_sys, 'run_1600m', '1600m', 's', 'lower_is_better', 1, 5, 0, 600,  1),
    (v_tpl, v_sys, 'run_3200m', '3200m', 's', 'lower_is_better', 1, 5, 0, 1200, 1);

  insert into template_positions (template_id, org_id, code, label, sort_order) values
    (v_tpl, v_sys, '60',   '60 Meters',   1),
    (v_tpl, v_sys, '100',  '100 Meters',  2),
    (v_tpl, v_sys, '200',  '200 Meters',  3),
    (v_tpl, v_sys, '400',  '400 Meters',  4),
    (v_tpl, v_sys, '800',  '800 Meters',  5),
    (v_tpl, v_sys, '1600', '1600 Meters', 6),
    (v_tpl, v_sys, '3200', '3200 Meters', 7);

  insert into position_weights (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select v_tpl, v_sys, p.id, a.id, d.id, w.weight
  from (values
    ('60',   null,           'run_60m',   90),
    ('60',   'acceleration', null,        10),
    ('100',  null,           'run_100m',  90),
    ('100',  'acceleration', null,        10),
    ('200',  null,           'run_200m',  100),
    ('400',  null,           'run_400m',  100),
    ('800',  null,           'run_800m',  100),
    ('1600', null,           'run_1600m', 100),
    ('3200', null,           'run_3200m', 100)
  ) as w(code, attr_key, drill_key, weight)
  join template_positions p on p.template_id = v_tpl and p.code = w.code
  left join template_attributes a on a.template_id = v_tpl and a.key = w.attr_key
  left join template_drills d on d.template_id = v_tpl and d.key = w.drill_key;
end
$seed_track$;

-- ---------- create_org: accept the new seeds ----------
-- Body identical to migration-v2.sql except the slug list.
-- CREATE OR REPLACE keeps the existing grants.
create or replace function public.create_org(p_name text, p_template_slug text)
returns uuid language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org uuid;
  v_src uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not app.email_confirmed() then raise exception 'email not confirmed'; end if;
  if p_template_slug not in ('flag_football', 'baseball', 'volleyball', 'track', 'scratch') then
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

commit;
