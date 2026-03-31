-- =============================================================================
-- Mobile DM picker: show coworkers without depending only on org_members
-- =============================================================================
-- If "No other employees found" persists after backfilling org_members, or you
-- see "stack depth limit exceeded" on profiles queries, add this policy.
--
-- Effect: any authenticated user who has a profiles row in org X can SELECT all
-- profiles rows for org X (same restaurant roster). This matches internal staff apps.
--
-- Run in Supabase → SQL Editor (safe to re-run).
-- =============================================================================

DROP POLICY IF EXISTS "profiles_same_org_roster_select" ON public.profiles;

CREATE POLICY "profiles_same_org_roster_select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles me
    WHERE me.user_id = auth.uid()
      AND me.org_id = profiles.org_id
  )
);

-- Optional: verify policies on profiles
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles';
