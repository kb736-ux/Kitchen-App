-- =============================================================================
-- FIX: "stack depth limit exceeded" + "canceling statement due to statement timeout"
-- =============================================================================
-- Cause: Row Level Security policies that subquery `profiles` / `org_members`
--        re-enter RLS on the same tables (infinite recursion) in PostgreSQL.
--
-- Fix: SECURITY DEFINER helper functions read membership tables WITHOUT applying
--      RLS (owner bypass), then policies call those functions only.
--
-- Run in Supabase → SQL Editor (once). Safe to re-run (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.kk_auth_can_access_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_org_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.org_members m
        WHERE m.org_id = p_org_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.org_id = p_org_id
          AND (
            p.user_id = auth.uid()
            OR lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.kk_auth_can_read_shift_row(
  p_org_id uuid,
  p_shift_employee_id uuid,
  p_shift_employee_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Legacy: some rows stored auth user id in employee_id
    (p_shift_employee_id IS NOT NULL AND p_shift_employee_id = auth.uid())
    OR (
      p_shift_employee_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_shift_employee_id
          AND p.org_id = p_org_id
          AND (
            p.user_id = auth.uid()
            OR lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.org_id = p_org_id
        AND p.user_id = auth.uid()
        AND lower(trim(coalesce(p.employee_name, ''))) = lower(trim(coalesce(p_shift_employee_name, '')))
    )
    OR public.kk_auth_can_access_org(p_org_id);
$$;

REVOKE ALL ON FUNCTION public.kk_auth_can_access_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kk_auth_can_read_shift_row(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_read_shift_row(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_read_shift_row(uuid, uuid, text) TO service_role;

-- ── orgs: SELECT (getRestaurantName, org picker) ────────────────────────────
DROP POLICY IF EXISTS "orgs_member_or_admin_select" ON public.orgs;
CREATE POLICY "orgs_member_or_admin_select"
ON public.orgs
FOR SELECT
TO authenticated
USING (public.kk_auth_can_access_org(id));

-- ── profiles: replace SELECT (Chat loadEmployees, task name resolution) ─────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_sd"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.kk_auth_can_access_org(org_id)
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

CREATE POLICY "profiles_insert_sd"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members m
    WHERE m.org_id = profiles.org_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_update_sd"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members m
    WHERE m.org_id = profiles.org_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members m
    WHERE m.org_id = profiles.org_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_delete_sd"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
);

-- ── notifications ────────────────────────────────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "notifications_select_sd"
ON public.notifications FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "notifications_insert_sd"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "notifications_update_sd"
ON public.notifications FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

-- ── task_transfer_requests (SKIP entire block if table missing — create it first:
--     MyReactNativeApp/supabase-task-transfer-requests.sql)
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'task_transfer_requests') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'task_transfer_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.task_transfer_requests;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "ttr_select_sd" ON public.task_transfer_requests FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "ttr_insert_sd" ON public.task_transfer_requests FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "ttr_update_sd" ON public.task_transfer_requests FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

-- ── shift_requests (Schedule: shift transfer / time off — inserts + notifications) ──
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
    EXECUTE $sql$
      CREATE POLICY "shift_requests_select_sd" ON public.shift_requests FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shift_requests_insert_sd" ON public.shift_requests FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shift_requests_update_sd" ON public.shift_requests FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

-- ── shifts (mobile schedule + home) ─────────────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shifts') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'shifts'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.shifts;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "shifts_select_sd" ON public.shifts FOR SELECT TO authenticated
      USING (public.kk_auth_can_read_shift_row(org_id, employee_id, employee_name));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shifts_insert_sd" ON public.shifts FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shifts_update_sd" ON public.shifts FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id))
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shifts_delete_sd" ON public.shifts FOR DELETE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

-- ── tasks (mobile Tasks tab — common source of timeouts) ───────────────────
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tasks') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'tasks'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.tasks;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "tasks_select_sd" ON public.tasks FOR SELECT TO authenticated
      USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "tasks_insert_sd" ON public.tasks FOR INSERT TO authenticated
      WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "tasks_update_sd" ON public.tasks FOR UPDATE TO authenticated
      USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id))
      WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "tasks_delete_sd" ON public.tasks FOR DELETE TO authenticated
      USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

-- ── employee_positions (top of migrate file used subquery on profiles) ─────
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'employee_positions') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'employee_positions'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.employee_positions;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "employee_positions_select_sd" ON public.employee_positions FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "employee_positions_insert_sd" ON public.employee_positions FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.admin_users au
          WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
        )
      );
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "employee_positions_update_sd" ON public.employee_positions FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.admin_users au
          WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
        )
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.admin_users au
          WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
        )
      );
    $sql$;
  END IF;
END $$;

-- ── recipes + dishes (mobile Menu & Recipes + web dashboard) ─────────────────
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'recipes') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'recipes'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.recipes;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "recipes_select_sd" ON public.recipes FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "recipes_insert_sd" ON public.recipes FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "recipes_update_sd" ON public.recipes FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id))
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "recipes_delete_sd" ON public.recipes FOR DELETE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dishes') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'dishes'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.dishes;', pol.policyname);
    END LOOP;
    EXECUTE $sql$
      CREATE POLICY "dishes_select_sd" ON public.dishes FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "dishes_insert_sd" ON public.dishes FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "dishes_update_sd" ON public.dishes FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id))
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "dishes_delete_sd" ON public.dishes FOR DELETE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
