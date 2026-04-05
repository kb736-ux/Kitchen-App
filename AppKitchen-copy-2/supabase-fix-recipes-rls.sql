-- Fix: recipes INSERT/UPDATE blocked for dashboard admins (only org_members + admin_users were allowed).
-- Run this in Supabase SQL Editor once.

DROP POLICY IF EXISTS "recipes_org_member_or_admin_select" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_insert" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_update" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_delete" ON public.recipes;

CREATE POLICY "recipes_org_member_or_admin_select"
ON public.recipes FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid() AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id AND p.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_insert"
ON public.recipes FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid() AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id AND p.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_update"
ON public.recipes FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid() AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id AND p.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid() AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id AND p.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_delete"
ON public.recipes FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid() AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id AND p.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
    )
);
