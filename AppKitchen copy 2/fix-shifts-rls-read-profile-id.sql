-- =============================================================================
-- Fix: shifts invisible on mobile after RLS hardening
-- =============================================================================
-- kk_auth_can_read_shift_row used to treat shifts.employee_id = auth.uid().
-- In this app, employee_id is usually profiles.id (not Supabase Auth uid), so
-- employees only matched the name branch — easy to miss rows after reload.
--
-- Run in Supabase SQL Editor after fix-rls-stack-depth-recursion.sql (replaces
-- only the helper function; shifts policies keep calling it).
-- =============================================================================

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
