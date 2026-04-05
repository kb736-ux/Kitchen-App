-- =============================================================================
-- OPTION A: Mobile "New message" needs org_members (RLS on profiles)
-- =============================================================================
-- Symptom: Staff only see themselves under Messages → "+" → employees list.
-- Cause:   profiles SELECT allows (a) own row, OR (b) org_members of same org, OR admins.
-- Fix:     Ensure every profile with a linked auth user has a row in org_members.
--
-- Run in:  Supabase → SQL Editor (runs as postgres; bypasses RLS).
--
-- After:   Have each user fully quit + reopen the mobile app (or pull to refresh).
-- =============================================================================

-- 0) If INSERT fails with "invalid input value for enum", list allowed labels:
-- SELECT e.enumlabel
-- FROM pg_enum e
-- JOIN pg_type t ON e.enumtypid = t.oid
-- WHERE t.typname = 'role_type'
-- ORDER BY e.enumsortorder;

-- 1) Backfill: one org_members row per (org_id, user_id) from profiles
--    `role` is enum public.role_type — cast literals (not ::text).
--    If this errors on unknown column `position`, remove `, position` and `, NULL::text` from both lines below.
INSERT INTO public.org_members (org_id, user_id, role, position)
SELECT DISTINCT
  p.org_id,
  p.user_id,
  'employee'::public.role_type,
  NULL::text
FROM public.profiles p
WHERE p.user_id IS NOT NULL
  AND p.org_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.org_id = p.org_id
      AND om.user_id = p.user_id
  );

-- 2) Optional: mark users who are global admins as manager on their membership
UPDATE public.org_members om
SET role = 'manager'::public.role_type
FROM public.admin_users au
WHERE om.user_id = au.user_id
  AND coalesce(au.is_admin, false) = true;

-- 3) Verify (optional): counts — org_members rows should cover all linked profiles
-- SELECT
--   (SELECT count(*) FROM public.profiles WHERE user_id IS NOT NULL AND org_id IS NOT NULL) AS profiles_with_auth,
--   (SELECT count(*) FROM public.org_members) AS org_member_rows;

-- If your org_members table uses different column names, adjust the INSERT list.
-- Common alternatives: omit `position` if the column does not exist.
-- If INSERT fails with "column does not exist", inspect:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'org_members'
--   ORDER BY ordinal_position;
