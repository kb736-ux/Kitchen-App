-- Run this in Supabase → SQL Editor (whole file) to fix:
--   "Could not find the table 'public.task_transfer_requests' in the schema cache"
--
-- Requires public.kk_auth_can_access_org(org_id) (from rls-fix-org-members-shifts.sql /
-- supabase-migrate-to-uuid.sql). If policies fail, create the table only, then run:
--   AppKitchen copy 2/fix-task-transfer-stack-depth.sql
--
CREATE TABLE IF NOT EXISTS public.task_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  from_employee_name text NOT NULL,
  to_employee_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_transfer_to_employee
  ON public.task_transfer_requests(to_employee_name, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_task_transfer_org
  ON public.task_transfer_requests(org_id);

ALTER TABLE public.task_transfer_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'task_transfer_requests'
  ) THEN
    RETURN;
  END IF;

  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_transfer_requests'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.task_transfer_requests;', pol.policyname);
  END LOOP;

  EXECUTE $sql$
    CREATE POLICY "ttr_select_org_member"
    ON public.task_transfer_requests FOR SELECT TO authenticated
    USING (public.kk_auth_can_access_org(org_id));
  $sql$;
  EXECUTE $sql$
    CREATE POLICY "ttr_insert_org_member"
    ON public.task_transfer_requests FOR INSERT TO authenticated
    WITH CHECK (public.kk_auth_can_access_org(org_id));
  $sql$;
  EXECUTE $sql$
    CREATE POLICY "ttr_update_org_member"
    ON public.task_transfer_requests FOR UPDATE TO authenticated
    USING (public.kk_auth_can_access_org(org_id));
  $sql$;
END $$;

SELECT 'task_transfer_requests ready' AS status;
