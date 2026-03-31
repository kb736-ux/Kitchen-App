-- =============================================================================
-- Fix: "stack depth limit exceeded" on mobile (Schedule shift transfer / time off,
--      Tasks task transfer) + restaurant name stuck as "Restaurant"
-- =============================================================================
-- Cause: RLS policies that use EXISTS (SELECT … FROM profiles / org_members)
--        re-enter RLS and recurse → stack depth exceeded on INSERT to
--        shift_requests, task_transfer_requests, notifications.
--        Same recursion breaks SELECT on orgs → app cannot load orgs.name.
--
-- Fix: SECURITY DEFINER helper kk_auth_can_access_org() reads membership
--      without applying RLS, then policies call that function only.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.
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

REVOKE ALL ON FUNCTION public.kk_auth_can_access_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO service_role;

-- orgs: SELECT (mobile Home header loads orgs.name — was failing silently → "Restaurant")
DROP POLICY IF EXISTS "orgs_member_or_admin_select" ON public.orgs;
CREATE POLICY "orgs_member_or_admin_select"
ON public.orgs
FOR SELECT
TO authenticated
USING (public.kk_auth_can_access_org(id));

-- shift_requests (Schedule: "Request Transfer" / "Send to …", time off — NOT task_transfer_requests)
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

-- notifications (insert after shift_requests / task_transfer_requests)
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

-- task_transfer_requests
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
