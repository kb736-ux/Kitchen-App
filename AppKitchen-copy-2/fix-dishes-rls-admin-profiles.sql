-- Run in Supabase SQL Editor if:
--   • GET /dishes returns 400 (often missing columns) — fix schema + redeploy web app
--   • POST /dishes returns 403 Forbidden — RLS blocked INSERT (this script fixes that)
--   • You can read recipes but not dishes / cannot create dishes
--
-- Aligns `dishes` RLS with `recipes`: org_members OR profiles(same org) OR admin_profiles OR admin_users.
--
-- After running, verify policies exist:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'dishes';
--
-- If 403 persists, your user must appear in at least one of:
--   org_members (this org), profiles (this org + auth.uid()), admin_profiles, admin_users.

DROP POLICY IF EXISTS "dishes_org_member_or_admin_select" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_insert" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_update" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_delete" ON public.dishes;

CREATE POLICY "dishes_org_member_or_admin_select"
ON public.dishes FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.org_members om WHERE om.user_id = auth.uid() AND om.org_id = dishes.org_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.org_id = dishes.org_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true)
);

CREATE POLICY "dishes_org_member_or_admin_insert"
ON public.dishes FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM public.org_members om WHERE om.user_id = auth.uid() AND om.org_id = dishes.org_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.org_id = dishes.org_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true)
);

CREATE POLICY "dishes_org_member_or_admin_update"
ON public.dishes FOR UPDATE TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.org_members om WHERE om.user_id = auth.uid() AND om.org_id = dishes.org_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.org_id = dishes.org_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.org_members om WHERE om.user_id = auth.uid() AND om.org_id = dishes.org_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.org_id = dishes.org_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true)
);

CREATE POLICY "dishes_org_member_or_admin_delete"
ON public.dishes FOR DELETE TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.org_members om WHERE om.user_id = auth.uid() AND om.org_id = dishes.org_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.org_id = dishes.org_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true)
);
