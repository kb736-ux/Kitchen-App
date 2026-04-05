-- ============================================================================
-- FIX: RLS recursion causing "stack depth limit exceeded" and timeouts
-- 
-- Root cause: profiles policy subqueries org_members, and old org_members
-- policies subquery profiles back → infinite recursion → all queries fail.
--
-- Run this ENTIRE script in Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste all → Run
-- ============================================================================


-- ─── 1. BREAK THE RECURSION: Fix org_members ───────────────────────────────
-- Drop ALL existing policies on org_members (including old recursive ones)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'org_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.org_members;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.org_members ENABLE ROW LEVEL SECURITY;

-- Simple non-recursive policy: only references admin_users (which has NO RLS)
CREATE POLICY "org_members_select_own"
ON public.org_members
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "org_members_insert_own"
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "org_members_update_own"
ON public.org_members
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "org_members_delete_own"
ON public.org_members
FOR DELETE
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);


-- ─── 2. Fix profiles policies (remove potential recursion) ──────────────────
-- The existing profiles policy is fine — it references org_members,
-- and now org_members no longer references profiles. But let's ensure
-- it exists and is correct.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_for_org_or_admin"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid() AND om.org_id = profiles.org_id
  )
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_insert_for_org_or_admin"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "profiles_update_for_org_or_admin"
ON public.profiles FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);


-- ─── 3. Fix shifts policies ─────────────────────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shifts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.shifts;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shifts_select_self_org_or_admin"
ON public.shifts
FOR SELECT
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "shifts_insert_self_org_or_admin"
ON public.shifts
FOR INSERT
TO authenticated
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND p_org.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "shifts_update_self_org_or_admin"
ON public.shifts
FOR UPDATE
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND p_org.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND p_org.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "shifts_delete_self_org_or_admin"
ON public.shifts
FOR DELETE
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND p_org.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);


-- ─── 4. Allow shift_requests.shift_id to be NULL ────────────────────────────
-- Time-off requests from the calendar don't reference a specific shift.
ALTER TABLE IF EXISTS public.shift_requests
  ALTER COLUMN shift_id DROP NOT NULL;

-- Approved calendar time off: date range blocks scheduling on web after approval
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_start_date date;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_end_date date;

-- ─── 5. Ensure shift_requests RLS uses SECURITY DEFINER helper ──────────────
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'shift_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.shift_requests;', pol.policyname);
    END LOOP;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.shift_requests ENABLE ROW LEVEL SECURITY;

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

-- ─── 6. Fix tasks table — RLS enabled but ZERO policies ─────────────────────
-- This is why task inserts from the web silently fail and mobile sees no tasks.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tasks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tasks;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select_org_member"
ON public.tasks FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_insert_org_member"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_update_org_member"
ON public.tasks FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_delete_org_member"
ON public.tasks FOR DELETE TO authenticated
USING (public.kk_auth_can_access_org(org_id));


-- ─── 7. Fix task_ingredients — same issue ───────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_ingredients'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.task_ingredients;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.task_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_ingredients_select_org_member"
ON public.task_ingredients FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_insert_org_member"
ON public.task_ingredients FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_update_org_member"
ON public.task_ingredients FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_delete_org_member"
ON public.task_ingredients FOR DELETE TO authenticated
USING (public.kk_auth_can_access_org(org_id));


-- ─── 8. Fix inventory_txns — same issue ─────────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inventory_txns'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.inventory_txns;', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.inventory_txns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_txns_select_org_member"
ON public.inventory_txns FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "inventory_txns_insert_org_member"
ON public.inventory_txns FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "inventory_txns_update_org_member"
ON public.inventory_txns FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));


-- ─── 9. Verification ────────────────────────────────────────────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('org_members', 'shifts', 'profiles', 'shift_requests', 'tasks', 'task_ingredients', 'inventory_txns')
ORDER BY tablename, policyname;
