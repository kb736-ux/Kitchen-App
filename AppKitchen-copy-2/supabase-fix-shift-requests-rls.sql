-- Fix shift_requests: RLS enabled but missing policies → mobile inserts fail,
-- web dashboard shows "No pending shift requests" even after employees submit.
-- Also drops NOT NULL on shift_id (time-off requests may have no specific shift).
-- Requires kk_auth_can_access_org() (from supabase-migrate-to-uuid.sql).
-- Run in Supabase → SQL Editor.

-- 1. Allow shift_id to be NULL (time-off without a specific shift)
ALTER TABLE IF EXISTS public.shift_requests
  ALTER COLUMN shift_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_start_date date;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_end_date date;

-- 2. Drop all existing shift_requests policies to avoid duplicates
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_requests'
    LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.shift_requests;', pol.policyname); END LOOP;
  END IF;
END $$;

-- 3. Ensure RLS is enabled
ALTER TABLE IF EXISTS public.shift_requests ENABLE ROW LEVEL SECURITY;

-- 4. Create policies using the SECURITY DEFINER helper
CREATE POLICY "shift_requests_select_org_member"
ON public.shift_requests FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "shift_requests_insert_org_member"
ON public.shift_requests FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "shift_requests_update_org_member"
ON public.shift_requests FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "shift_requests_delete_org_member"
ON public.shift_requests FOR DELETE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

-- 5. Verify
SELECT 'shift_requests policies applied OK' AS status;
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_requests';
