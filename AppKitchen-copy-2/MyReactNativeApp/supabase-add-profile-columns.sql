-- =============================================================================
-- RUN THIS IN SUPABASE IF PROFILE SAVE FAILS ("column not found")
-- =============================================================================
-- 1. Open your Supabase project at https://supabase.com/dashboard
-- 2. Go to: SQL Editor
-- 3. Click "New query"
-- 4. Copy and paste the lines below, then click "Run"
-- =============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_color text;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by_id uuid;

-- Backfill first/last from display_name (or employee_name) for existing rows.
UPDATE profiles
SET
  first_name = COALESCE(
    NULLIF(trim(first_name), ''),
    NULLIF(split_part(COALESCE(NULLIF(trim(display_name), ''), NULLIF(trim(employee_name), '')), ' ', 1), '')
  ),
  last_name = COALESCE(
    NULLIF(trim(last_name), ''),
    NULLIF(regexp_replace(COALESCE(NULLIF(trim(display_name), ''), NULLIF(trim(employee_name), '')), '^\S+\s*', ''), '')
  )
WHERE COALESCE(NULLIF(trim(display_name), ''), NULLIF(trim(employee_name), '')) IS NOT NULL;

-- Ensure display_name is populated from first/last when available.
UPDATE profiles
SET display_name = NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), '')
WHERE NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), '') IS NOT NULL;

-- Refresh PostgREST schema cache immediately.
SELECT pg_notify('pgrst', 'reload schema');

-- Backfill announcement creator UUID from profile aliases.
UPDATE announcements a
SET created_by_id = p.id
FROM profiles p
WHERE coalesce(a.org_id::text, '') = coalesce(p.org_id::text, '')
  AND a.created_by_id IS NULL
  AND (
    lower(trim(coalesce(a.created_by, ''))) = lower(trim(coalesce(p.display_name, '')))
    OR lower(trim(coalesce(a.created_by, ''))) = lower(trim(coalesce(p.employee_name, '')))
    OR lower(trim(coalesce(a.created_by, ''))) = lower(split_part(coalesce(p.email, ''), '@', 1))
    OR lower(regexp_replace(trim(coalesce(a.created_by, '')), '[^a-z0-9]', '', 'g'))
       = lower(regexp_replace(trim(coalesce(p.display_name, '')), '[^a-z0-9]', '', 'g'))
    OR lower(regexp_replace(trim(coalesce(a.created_by, '')), '[^a-z0-9]', '', 'g'))
       = lower(regexp_replace(trim(coalesce(p.employee_name, '')), '[^a-z0-9]', '', 'g'))
  );

-- Normalize legacy sender labels once identity is known.
UPDATE messages m
SET sender = COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), ''), m.sender)
FROM profiles p
WHERE m.employee_id = p.id
  AND (
    coalesce(m.org_id::text, '') = coalesce(p.org_id::text, '')
    OR m.org_id IS NULL
    OR p.org_id IS NULL
  )
  AND COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')) IS NOT NULL;

UPDATE announcements a
SET created_by = COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), ''), a.created_by)
FROM profiles p
WHERE a.created_by_id = p.id
  AND COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')) IS NOT NULL;

-- Allow authenticated org members to read profiles in their own org
-- so mobile DM employee picker can resolve UUID-linked staff.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_self_select_or_admin" ON profiles;
CREATE POLICY "profiles_self_select_or_admin"
ON profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = profiles.org_id
  )
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

-- Recipes visibility/write for org members and admins.
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_select" ON recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_insert" ON recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_update" ON recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_delete" ON recipes;

CREATE POLICY "recipes_org_member_or_admin_select"
ON recipes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = recipes.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "recipes_org_member_or_admin_insert"
ON recipes
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = recipes.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "recipes_org_member_or_admin_update"
ON recipes
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = recipes.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = recipes.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "recipes_org_member_or_admin_delete"
ON recipes
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = recipes.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);
