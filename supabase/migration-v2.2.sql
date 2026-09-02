-- ============================================================
-- BIG BOARD v2.2
-- Applied ON TOP of migration-v2.1.sql. Migrations are
-- append-only; the earlier files have already run.
--
-- Adds: atomic roster import (SPEC-V2 section 10b.6).
-- ============================================================

begin;

/*
 * Commit a reviewed roster in ONE transaction.
 *
 * SECURITY INVOKER on purpose - this is the rare case where that
 * is the point rather than the default. Every statement below is
 * still checked against the caller's own RLS policies, so an
 * evaluator can only write into an org they belong to and a
 * viewer cannot call it at all. What the function adds is a
 * single transaction boundary.
 *
 * That boundary is why this exists. v1 imported from the client
 * in three steps and, if a later one failed, DELETED the
 * prospects it had just inserted to unwind. prospects_delete is
 * admin-only. Now that import is evaluator+, that rollback path
 * is closed to exactly the people most likely to use the
 * feature - an evaluator hitting a failure would have been left
 * with half a roster and no way to undo it. Here, a failure
 * rolls the whole thing back for everyone, with no delete
 * permission needed.
 *
 * p_rows is the reviewed table, already validated client-side
 * and re-validated by the caller. Each element:
 *
 *   {
 *     "first_name": "...", "last_name": "...",
 *     "jersey_number": 17,
 *     "primary_position": "WR",
 *     "secondary_positions": ["DB"],
 *     "selected": true,
 *     "mode": "insert" | "overwrite",
 *     "drills": { "forty": [4.61, null] }
 *   }
 *
 * Rows the user chose to skip are simply absent - the decision
 * is made in the review table, not here.
 */
create or replace function public.import_roster(
  p_tryout uuid,
  p_rows   jsonb
)
returns TABLE (inserted int, overwritten int, results int, selections int)
language plpgsql volatile
set search_path = public as
$$
declare
  v_org         uuid;
  v_row         jsonb;
  v_prospect    uuid;
  v_jersey      int;
  v_mode        text;
  v_drill       text;
  v_attempt     int;
  v_value       numeric;
  v_inserted    int := 0;
  v_overwritten int := 0;
  v_results     int := 0;
  v_selections  int := 0;
begin
  select org_id into v_org from tryouts where id = p_tryout;
  if v_org is null then
    raise exception 'tryout not found';
  end if;

  -- A courtesy check that produces a readable message. The RLS
  -- policies below are the actual enforcement, and they do not
  -- trust this.
  if not app.is_evaluator(v_org) then
    raise exception 'not authorized to import into this organization';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_jersey := (v_row->>'jersey_number')::int;
    v_mode   := coalesce(v_row->>'mode', 'insert');

    if v_mode = 'overwrite' then
      update prospects
      set first_name          = v_row->>'first_name',
          last_name           = v_row->>'last_name',
          primary_position    = v_row->>'primary_position',
          secondary_positions = coalesce(
            (select array_agg(value::text)
             from jsonb_array_elements_text(v_row->'secondary_positions')),
            '{}'
          )
      where tryout_id = p_tryout and jersey_number = v_jersey
      returning id into v_prospect;

      if v_prospect is null then
        raise exception 'jersey % was marked overwrite but no longer exists', v_jersey;
      end if;
      v_overwritten := v_overwritten + 1;

    else
      insert into prospects
        (tryout_id, jersey_number, first_name, last_name,
         primary_position, secondary_positions)
      values (
        p_tryout,
        v_jersey,
        v_row->>'first_name',
        v_row->>'last_name',
        v_row->>'primary_position',
        coalesce(
          (select array_agg(value::text)
           from jsonb_array_elements_text(v_row->'secondary_positions')),
          '{}'
        )
      )
      returning id into v_prospect;
      v_inserted := v_inserted + 1;
    end if;

    -- Drill results. An overwrite replaces what was there for the
    -- drills this import carries, and leaves other drills alone:
    -- re-importing a sheet that only has 40 times should not wipe
    -- exit velocities somebody measured separately.
    for v_drill in
      select jsonb_object_keys(coalesce(v_row->'drills', '{}'::jsonb))
    loop
      delete from drill_results
      where prospect_id = v_prospect and drill_key = v_drill;

      v_attempt := 0;
      for v_value in
        select nullif(value, 'null')::text::numeric
        from jsonb_array_elements(v_row->'drills'->v_drill)
      loop
        v_attempt := v_attempt + 1;
        if v_value is not null then
          insert into drill_results
            (prospect_id, drill_key, attempt_number, value, recorded_by)
          values (v_prospect, v_drill, v_attempt, v_value, auth.uid());
          v_results := v_results + 1;
        end if;
      end loop;
    end loop;

    -- Selections are one shared list, unique on (tryout, prospect).
    -- An import never REMOVES someone from it: the sheet says who to
    -- add, not who the staff has since decided against.
    if coalesce((v_row->>'selected')::boolean, false) then
      insert into selections (tryout_id, prospect_id, selected_by)
      values (p_tryout, v_prospect, auth.uid())
      on conflict (tryout_id, prospect_id) do nothing;
      v_selections := v_selections + 1;
    end if;
  end loop;

  return query select v_inserted, v_overwritten, v_results, v_selections;
end
$$;

revoke all on function public.import_roster(uuid, jsonb) from public, anon;
grant execute on function public.import_roster(uuid, jsonb) to authenticated;

commit;
