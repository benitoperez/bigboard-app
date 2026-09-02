-- ============================================================
-- BIG BOARD v2.1
-- Applied ON TOP of migration-v2.sql. Never edit that file — it
-- has already run against the live database.
--
-- Adds: reset one position's weights to the seeded defaults.
-- ============================================================

begin;

/*
 * Restore a position's weights to the seed template's defaults.
 *
 * security definer for a specific reason: the seed templates live in
 * the system org, and NOBODY is a member of that org. The RLS policy
 * on templates restricts SELECT to members, so an admin editing their
 * own template genuinely cannot read the defaults they started from.
 * This function is the only path to them.
 *
 * It is also the only way to do the swap atomically. The sum-to-100
 * constraint trigger is deferred to end of transaction; from the
 * client library the delete and the insert would be two separate
 * transactions, so the delete alone would have to satisfy the trigger.
 *
 * Matching is by CODE and KEY, not by id — the caller's template is a
 * copy, so every id differs from the seed's.
 */
create or replace function public.reset_position_weights(p_position uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$
declare
  v_org      uuid;
  v_tpl      uuid;
  v_code     text;
  v_sport    text;
  v_seed_tpl uuid;
  v_seed_pos uuid;
  v_missing  text;
  v_sum      int;
begin
  select tp.org_id, tp.template_id, tp.code, t.sport
    into v_org, v_tpl, v_code, v_sport
  from template_positions tp
  join templates t on t.id = tp.template_id
  where tp.id = p_position;

  if v_org is null then raise exception 'position not found'; end if;
  if not app.is_admin(v_org) then raise exception 'not authorized'; end if;

  -- A from-scratch template was never seeded, so it has no defaults to
  -- go back to. Saying so is better than silently doing nothing.
  select id into v_seed_tpl
  from templates
  where org_id = app.system_org_id() and sport = v_sport;

  if v_seed_tpl is null then
    raise exception 'this template has no built-in defaults';
  end if;

  select id into v_seed_pos
  from template_positions
  where template_id = v_seed_tpl and code = v_code;

  if v_seed_pos is null then
    raise exception '% is not a position in the built-in defaults', v_code;
  end if;

  -- The defaults can reference an attribute or drill this org has since
  -- deleted. Inserting anyway would leave both component ids null and
  -- trip the num_nonnulls CHECK with an opaque message, so the missing
  -- pieces are named instead.
  select string_agg(key, ', ') into v_missing
  from (
    select coalesce(sa.key, sd.key) as key
    from position_weights w
    left join template_attributes sa on sa.id = w.attribute_id
    left join template_drills     sd on sd.id = w.drill_id
    where w.position_id = v_seed_pos
      and not exists (
        select 1 from template_attributes a
        where a.template_id = v_tpl and a.key = sa.key
      )
      and not exists (
        select 1 from template_drills d
        where d.template_id = v_tpl and d.key = sd.key
      )
  ) missing;

  if v_missing is not null then
    raise exception 'defaults need %, which this template no longer has', v_missing;
  end if;

  delete from position_weights where position_id = p_position;

  insert into position_weights
    (template_id, org_id, position_id, attribute_id, drill_id, weight)
  select
    v_tpl,
    v_org,
    p_position,
    (select a.id from template_attributes a
      where a.template_id = v_tpl and a.key = sa.key),
    (select d.id from template_drills d
      where d.template_id = v_tpl and d.key = sd.key),
    w.weight
  from position_weights w
  left join template_attributes sa on sa.id = w.attribute_id
  left join template_drills     sd on sd.id = w.drill_id
  where w.position_id = v_seed_pos;

  select coalesce(sum(weight), 0) into v_sum
  from position_weights where position_id = p_position;

  if v_sum <> 100 then
    raise exception 'restored weights sum to %, not 100', v_sum;
  end if;
end
$$;

revoke all on function public.reset_position_weights(uuid) from public, anon;
grant execute on function public.reset_position_weights(uuid) to authenticated;

/*
 * Does this position have defaults to restore?
 *
 * The editor asks before rendering the button, for the same reason the
 * function raises rather than no-ops: a button that always fails on a
 * from-scratch template is worse than no button.
 */
create or replace function public.position_has_defaults(p_position uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1
    from template_positions tp
    join templates t   on t.id = tp.template_id
    join templates seed on seed.org_id = app.system_org_id()
                       and seed.sport = t.sport
    join template_positions sp on sp.template_id = seed.id and sp.code = tp.code
    where tp.id = p_position
  )
$$;

revoke all on function public.position_has_defaults(uuid) from public, anon;
grant execute on function public.position_has_defaults(uuid) to authenticated;

commit;
