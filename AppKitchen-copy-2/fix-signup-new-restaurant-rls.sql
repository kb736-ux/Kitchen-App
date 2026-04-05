-- =============================================================================
-- SELF-SERVE: Create a new restaurant from the web app (signup flow)
-- =============================================================================
-- Run in Supabase → SQL Editor (as postgres).
--
-- Adds RLS policies so a brand-new authenticated user (with NO org_members row
-- yet) can INSERT one org, then add themselves as the first org_member
-- (founder).
--
-- Does NOT allow users who already belong to an org to create additional orgs
-- via this path (avoids accidental multi-tenant spam on the same account).
-- =============================================================================

-- 1) Orgs: allow first-time tenant creation
DROP POLICY IF EXISTS "orgs_bootstrap_insert_no_membership_yet" ON public.orgs;
CREATE POLICY "orgs_bootstrap_insert_no_membership_yet"
ON public.orgs
FOR INSERT
TO authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid()
  )
);

-- 2) Org members: allow inserting YOURSELF as the first member of an org
DROP POLICY IF EXISTS "org_members_founder_self_insert" ON public.org_members;
CREATE POLICY "org_members_founder_self_insert"
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members om2
    WHERE om2.org_id = org_members.org_id
  )
);

-- 3) Optional: let users read their own org_members rows (needed for manager check + mobile)
DROP POLICY IF EXISTS "org_members_self_select" ON public.org_members;
CREATE POLICY "org_members_self_select"
ON public.org_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Reload PostgREST schema cache (optional but harmless)
SELECT pg_notify('pgrst', 'reload schema');
