-- ============================================================
-- BIG BOARD - SEED
--
-- Run AFTER migration.sql, in the Supabase SQL editor.
--
-- BEFORE YOU RUN THIS, DO TWO THINGS:
--
--   1. Create your own account first.
--      Supabase Dashboard > Authentication > Users > Add user.
--      Use email + password. There is no signup flow in this app
--      (SPEC.md section 11), so every officer is created by hand.
--
--   2. Copy that user's UUID and replace the placeholder below.
--      It is the `id` column in the Authentication > Users table.
--
-- The officers.id column is a foreign key onto auth.users(id).
-- If the UUID does not match a real auth user, this script fails
-- with a foreign key violation - which is the intended behavior,
-- not a bug to work around.
-- ============================================================


-- ---- One active tryout ----------------------------------------
-- SPEC.md section 10.5 has an active tryout selector on the Account
-- screen. is_active drives which tryout the app loads by default.

insert into tryouts (name, tryout_date, is_active)
values ('2025 Fall Tryouts', '2025-09-13', true);


-- ---- One officer ----------------------------------------------
-- REPLACE THE UUID BELOW WITH YOUR OWN FROM auth.users.
-- is_admin = true unlocks CSV import and tryout creation
-- (SPEC.md section 10.5).

insert into officers (id, display_name, is_admin)
values (
  '00000000-0000-0000-0000-000000000000',  -- <<< REPLACE ME
  'Benito Perez',
  true
);


-- ---- Verify ---------------------------------------------------
-- Both of these should return exactly one row.

-- select id, name, tryout_date, is_active from tryouts where is_active;
-- select id, display_name, is_admin from officers;
