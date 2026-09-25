-- =============================================================================
-- Sheek clock in/out v1
-- Run in Supabase → SQL Editor. Safe to re-run.
-- =============================================================================
-- Design (subtract first):
--   Reuse orgs (feature flag), profiles / org_members (identity + RLS),
--   shifts (scheduled start), admin_users / kk_auth_* (manager checks).
--   New table is unavoidable: nothing stores punches today.
--   No RPC: early-punch block lives in shared JS (unit-tested) and the
--   client refuses the insert. RLS only gates who can write/read rows.
-- =============================================================================

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS clock_in_out_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orgs.clock_in_out_enabled IS
  'Opt-in Sheek clock in/out. Off by default. Staff punch UI stays hidden until a manager enables this.';

CREATE TABLE IF NOT EXISTS public.time_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id uuid,
  employee_name text,
  punch_type text NOT NULL CHECK (punch_type IN ('in', 'out')),
  punched_at timestamptz NOT NULL DEFAULT now(),
  shift_id uuid,
  scheduled_start timestamptz,
  is_early boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_punches_org_punched_at_idx
  ON public.time_punches (org_id, punched_at DESC);

CREATE INDEX IF NOT EXISTS time_punches_org_user_punched_at_idx
  ON public.time_punches (org_id, user_id, punched_at DESC);

ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;

-- Helpers already exist from prior migrations; recreate so this file is runnable alone.
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

CREATE OR REPLACE FUNCTION public.kk_auth_is_org_manager(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.org_members m
      WHERE m.org_id = p_org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('manager', 'owner')
    )
    OR EXISTS (
      SELECT 1
      FROM public.admin_users au
      WHERE au.user_id = auth.uid()
        AND coalesce(au.is_admin, false) = true
    )
  );
$$;

REVOKE ALL ON FUNCTION public.kk_auth_can_access_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_can_access_org(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.kk_auth_is_org_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_auth_is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_is_org_manager(uuid) TO service_role;

DROP POLICY IF EXISTS "time_punches_select" ON public.time_punches;
CREATE POLICY "time_punches_select"
ON public.time_punches
FOR SELECT
TO authenticated
USING (
  public.kk_auth_can_access_org(org_id)
  AND (
    user_id = auth.uid()
    OR public.kk_auth_is_org_manager(org_id)
  )
);

DROP POLICY IF EXISTS "time_punches_insert" ON public.time_punches;
CREATE POLICY "time_punches_insert"
ON public.time_punches
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.kk_auth_can_access_org(org_id)
  AND EXISTS (
    SELECT 1
    FROM public.orgs o
    WHERE o.id = time_punches.org_id
      AND o.clock_in_out_enabled = true
  )
);

-- No staff UPDATE/DELETE. Managers can correct a punch (pencil on the timesheet)
-- and remove a mistaken one. No new tables: these policies write time_punches.
DROP POLICY IF EXISTS "time_punches_manager_delete" ON public.time_punches;
CREATE POLICY "time_punches_manager_delete"
ON public.time_punches
FOR DELETE
TO authenticated
USING (public.kk_auth_is_org_manager(org_id));

DROP POLICY IF EXISTS "time_punches_manager_update" ON public.time_punches;
CREATE POLICY "time_punches_manager_update"
ON public.time_punches
FOR UPDATE
TO authenticated
USING (public.kk_auth_is_org_manager(org_id))
WITH CHECK (public.kk_auth_is_org_manager(org_id));

DROP POLICY IF EXISTS "time_punches_manager_insert" ON public.time_punches;
CREATE POLICY "time_punches_manager_insert"
ON public.time_punches
FOR INSERT
TO authenticated
WITH CHECK (
  public.kk_auth_is_org_manager(org_id)
  AND EXISTS (
    SELECT 1
    FROM public.orgs o
    WHERE o.id = time_punches.org_id
      AND o.clock_in_out_enabled = true
  )
);

SELECT pg_notify('pgrst', 'reload schema');
