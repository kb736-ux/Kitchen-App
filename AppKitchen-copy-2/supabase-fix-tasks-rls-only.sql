-- Quick fix: tasks / task_ingredients / inventory_txns had RLS ON with NO policies
-- → inserts fail silently on web, mobile Tasks tab empty.
-- Requires kk_auth_can_access_org() (from supabase-migrate-to-uuid.sql).
-- Run in Supabase → SQL Editor.

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tasks') THEN
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks'
    LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.tasks;', pol.policyname); END LOOP;
  END IF;
END $$;

CREATE POLICY "tasks_org_member_select"
ON public.tasks FOR SELECT TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_org_member_insert"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_org_member_update"
ON public.tasks FOR UPDATE TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id))
WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "tasks_org_member_delete"
ON public.tasks FOR DELETE TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

SELECT 'tasks policies OK' AS status;
