-- ============================================================================
-- QUICK FIX: Run this block FIRST to fix profiles + employee_positions RLS
-- so the admin can see all employees and profiles in their org.
-- ============================================================================

-- 1) Reset profiles policies so admin can see ALL profiles
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_for_org_or_admin"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = auth.uid() AND om.org_id = profiles.org_id
  )
  OR (
    lower(coalesce(email, '')) <> ''
    AND lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_insert_for_org_or_admin"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "profiles_update_for_org_or_admin"
ON public.profiles FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

-- 2) Fix employee_positions: RLS is on but has NO policies → 403 on every query
ALTER TABLE IF EXISTS public.employee_positions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employee_positions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.employee_positions;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "employee_positions_select_org_or_admin"
ON public.employee_positions FOR SELECT TO authenticated
USING (
  org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "employee_positions_insert_org_or_admin"
ON public.employee_positions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "employee_positions_update_org_or_admin"
ON public.employee_positions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND coalesce(au.is_admin, false) = true
  )
);

-- ============================================================================
-- END QUICK FIX
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  employee_name text NOT NULL,
  token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, employee_name)
);

-- Add employee_id to all relevant tables
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_start_date date;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_end_date date;
ALTER TABLE IF EXISTS public.dishes ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE IF EXISTS public.dishes ADD COLUMN IF NOT EXISTS allergens text[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.recipes ADD COLUMN IF NOT EXISTS allergens text[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.admin_profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE IF EXISTS public.announcements ADD COLUMN IF NOT EXISTS created_by_id uuid;

-- Ensure admin_profiles has a row synced from profiles for admin users.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_profiles')
       AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles')
       AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_users') THEN
        -- Update existing admin_profiles rows from matching profiles rows.
        UPDATE public.admin_profiles ap
        SET
            display_name = COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), ''), ap.display_name),
            first_name = COALESCE(NULLIF(trim(ap.first_name), ''), split_part(COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')), ' ', 1)),
            last_name = COALESCE(
                NULLIF(trim(ap.last_name), ''),
                NULLIF(regexp_replace(COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')), '^\S+\s*', ''), '')
            ),
            avatar_url = COALESCE(NULLIF(trim(p.avatar_url), ''), ap.avatar_url),
            updated_at = now()
        FROM public.profiles p
        JOIN public.admin_users au ON au.user_id = p.user_id AND coalesce(au.is_admin, false) = true
        WHERE ap.user_id = p.user_id;

        -- Insert missing admin_profiles rows from profiles for admins.
        INSERT INTO public.admin_profiles (user_id, first_name, last_name, display_name, avatar_url, updated_at)
        SELECT
            p.user_id,
            split_part(COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')), ' ', 1) AS first_name,
            NULLIF(regexp_replace(COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')), '^\S+\s*', ''), '') AS last_name,
            COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')) AS display_name,
            NULLIF(trim(p.avatar_url), '') AS avatar_url,
            now()
        FROM public.profiles p
        JOIN public.admin_users au ON au.user_id = p.user_id AND coalesce(au.is_admin, false) = true
        WHERE p.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.admin_profiles ap
            WHERE ap.user_id = p.user_id
          );
    END IF;
END $$;

-- Backfill existing data
UPDATE public.shifts s
SET employee_id = p.id
FROM public.employee_positions p
WHERE coalesce(s.org_id::text, '') = coalesce(p.org_id::text, '')
  AND s.employee_name = p.employee_name
  AND s.employee_id IS NULL;

-- Backfill announcement creator UUID from profile aliases.
UPDATE public.announcements a
SET created_by_id = p.id
FROM public.profiles p
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

-- Normalize legacy message/announcement sender labels when UUID identity exists.
UPDATE public.messages m
SET sender = COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), ''), m.sender)
FROM public.profiles p
WHERE m.employee_id = p.id
  AND (
    coalesce(m.org_id::text, '') = coalesce(p.org_id::text, '')
    OR m.org_id IS NULL
    OR p.org_id IS NULL
  )
  AND COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')) IS NOT NULL;

UPDATE public.announcements a
SET created_by = COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), ''), a.created_by)
FROM public.profiles p
WHERE a.created_by_id = p.id
  AND COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.employee_name), '')) IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name = 'employee_name'
    ) THEN
        EXECUTE '
            UPDATE public.tasks t
            SET employee_id = p.id
            FROM public.employee_positions p
            WHERE coalesce(t.org_id::text, '''') = coalesce(p.org_id::text, '''')
              AND t.employee_name = p.employee_name
              AND t.employee_id IS NULL;
        ';
    END IF;
END $$;

-- ============================================================================
-- UUID identity cleanup (chat/profile consistency)
-- ============================================================================
-- 1) Ensure profiles has UUID identity and first/last name
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text;

-- Backfill first/last from display_name (or employee_name) for existing rows.
UPDATE public.profiles
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

-- Keep display_name aligned with first/last when present.
UPDATE public.profiles
SET display_name = NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), '')
WHERE NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), '') IS NOT NULL;

-- Backfill any null IDs
UPDATE public.profiles
SET id = gen_random_uuid()
WHERE id IS NULL;

-- 2) Backfill employee_id from profiles.id (authoritative identity table)
UPDATE public.shifts s
SET employee_id = p.id
FROM public.profiles p
WHERE coalesce(s.org_id::text, '') = coalesce(p.org_id::text, '')
  AND lower(coalesce(s.employee_name, '')) = lower(coalesce(p.employee_name, ''))
  AND s.employee_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name = 'employee_name'
    ) THEN
        EXECUTE '
            UPDATE public.tasks t
            SET employee_id = p.id
            FROM public.profiles p
            WHERE coalesce(t.org_id::text, '''') = coalesce(p.org_id::text, '''')
              AND lower(coalesce(t.employee_name, '''')) = lower(coalesce(p.employee_name, ''''))
              AND t.employee_id IS NULL;
        ';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
          AND column_name = 'employee_name'
    ) THEN
        UPDATE public.notifications n
        SET employee_id = p.id
        FROM public.profiles p
        WHERE coalesce(n.org_id::text, '') = coalesce(p.org_id::text, '')
          AND lower(coalesce(n.employee_name, '')) = lower(coalesce(p.employee_name, ''))
          AND n.employee_id IS NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'push_tokens'
          AND column_name = 'employee_name'
    ) THEN
        UPDATE public.push_tokens pt
        SET employee_id = p.id
        FROM public.profiles p
        WHERE coalesce(pt.org_id::text, '') = coalesce(p.org_id::text, '')
          AND lower(coalesce(pt.employee_name, '')) = lower(coalesce(p.employee_name, ''))
          AND pt.employee_id IS NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'shift_requests'
              AND column_name = 'employee_name'
        ) THEN
            UPDATE public.shift_requests sr
            SET employee_id = p.id
            FROM public.profiles p
            WHERE coalesce(sr.org_id::text, '') = coalesce(p.org_id::text, '')
              AND lower(coalesce(sr.employee_name, '')) = lower(coalesce(p.employee_name, ''))
              AND sr.employee_id IS NULL;
        END IF;
    END IF;
END $$;

-- 3) Optional cleanup: remove legacy non-UUID/stale profile aliases.
--    KEEP THIS COMMENTED until you've verified who each row belongs to.
-- DELETE FROM public.profiles
-- WHERE org_id = 'f4121c7b-53ed-45b3-9966-57af9b40cb5d'
--   AND lower(coalesce(display_name, '')) = 'dudu'
--   AND lower(coalesce(employee_name, '')) <> 'dudu';

-- 4) Normalize DM channel IDs to UUID-backed format: dm-u:<profile_uuid>
--    This keeps old messages but canonicalizes thread identity.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'messages') THEN
        -- Legacy "dm-<name>" -> "dm-u:<id>" when <name> matches a profile employee/display name.
        UPDATE public.messages m
        SET channel_id = 'dm-u:' || p.id::text
        FROM public.profiles p
        WHERE coalesce(m.org_id::text, '') = coalesce(p.org_id::text, '')
          AND m.channel_id LIKE 'dm-%'
          AND m.channel_id NOT LIKE 'dm-u:%'
          AND lower(trim(substr(m.channel_id, 4))) IN (
              lower(trim(coalesce(p.employee_name, ''))),
              lower(trim(coalesce(p.display_name, '')))
          );
    END IF;
END $$;

-- ============================================================================
-- Chat RLS policy fix (required for DM sync web <-> mobile)
-- ============================================================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_any_member_select" ON public.messages;
DROP POLICY IF EXISTS "messages_select_privacy" ON public.messages;
DROP POLICY IF EXISTS "messages_any_member_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_privacy" ON public.messages;

-- Group channels: any member with a profile in the org.
-- DMs (dm:uuid:uuid): only the two participants (profile ids in channel_id).
CREATE POLICY "messages_select_privacy"
ON public.messages
FOR SELECT
TO authenticated
USING (
  org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.user_id = auth.uid())
  AND (
    channel_id LIKE 'group-%'
    OR (
      channel_id LIKE 'dm:%:%'
      AND split_part(channel_id, ':', 1) = 'dm'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.org_id = messages.org_id
          AND (
            p.id::text = split_part(channel_id, ':', 2)
            OR p.id::text = split_part(channel_id, ':', 3)
          )
      )
    )
  )
);

CREATE POLICY "messages_insert_privacy"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.user_id = auth.uid())
  AND (
    channel_id LIKE 'group-%'
    OR (
      channel_id LIKE 'dm:%:%'
      AND split_part(channel_id, ':', 1) = 'dm'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.org_id = messages.org_id
          AND (
            p.id::text = split_part(channel_id, ':', 2)
            OR p.id::text = split_part(channel_id, ':', 3)
          )
      )
    )
  )
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
          AND column_name = 'employee_name'
    ) THEN
        UPDATE public.notifications n
        SET employee_id = p.id
        FROM public.employee_positions p
        WHERE coalesce(n.org_id::text, '') = coalesce(p.org_id::text, '')
          AND n.employee_name = p.employee_name
          AND n.employee_id IS NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'push_tokens'
          AND column_name = 'employee_name'
    ) THEN
        UPDATE public.push_tokens pt
        SET employee_id = p.id
        FROM public.employee_positions p
        WHERE coalesce(pt.org_id::text, '') = coalesce(p.org_id::text, '')
          AND pt.employee_name = p.employee_name
          AND pt.employee_id IS NULL;
    END IF;
END $$;

-- Only run if shift_requests exists (ignore error if it doesn't)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'shift_requests'
              AND column_name = 'employee_name'
        ) THEN
            UPDATE public.shift_requests sr
            SET employee_id = p.id
            FROM public.employee_positions p
            WHERE coalesce(sr.org_id::text, '') = coalesce(p.org_id::text, '')
              AND sr.employee_name = p.employee_name
              AND sr.employee_id IS NULL;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- Security hardening: enable RLS on inventory_items (Supabase advisor warning)
-- ============================================================================
ALTER TABLE IF EXISTS public.inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_items_org_member_select" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_org_member_insert" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_org_member_update" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_items_org_member_delete" ON public.inventory_items;

CREATE POLICY "inventory_items_org_member_select"
ON public.inventory_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = inventory_items.org_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "inventory_items_org_member_insert"
ON public.inventory_items
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = inventory_items.org_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "inventory_items_org_member_update"
ON public.inventory_items
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = inventory_items.org_id
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
          AND om.org_id = inventory_items.org_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "inventory_items_org_member_delete"
ON public.inventory_items
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = inventory_items.org_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

-- Recipes policies (manager dashboard + mobile recipes)
DROP POLICY IF EXISTS "recipes_org_member_or_admin_select" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_insert" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_update" ON public.recipes;
DROP POLICY IF EXISTS "recipes_org_member_or_admin_delete" ON public.recipes;

CREATE POLICY "recipes_org_member_or_admin_select"
ON public.recipes
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_insert"
ON public.recipes
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_update"
ON public.recipes
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "recipes_org_member_or_admin_delete"
ON public.recipes
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = recipes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = recipes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

-- ============================================================================
-- Enable RLS on tables that have policies but RLS was off (Security Advisor)
-- ============================================================================
ALTER TABLE IF EXISTS public.inventory_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shift_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.task_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dishes ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SECURITY DEFINER helper — avoids RLS recursion ("stack depth limit exceeded")
-- when policies subquery profiles/org_members (orgs SELECT, shift_requests, etc.)
-- ============================================================================
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

-- ============================================================================
-- tasks / task_ingredients / inventory_txns — RLS was enabled above with NO policies
-- (inserts/selects were fully blocked → web + mobile saw no tasks)
-- ============================================================================
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tasks') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'tasks'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.tasks;', pol.policyname);
    END LOOP;
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

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'task_ingredients') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'task_ingredients'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.task_ingredients;', pol.policyname);
    END LOOP;
  END IF;
END $$;

CREATE POLICY "task_ingredients_org_member_select"
ON public.task_ingredients FOR SELECT TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_org_member_insert"
ON public.task_ingredients FOR INSERT TO authenticated
WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_org_member_update"
ON public.task_ingredients FOR UPDATE TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id))
WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "task_ingredients_org_member_delete"
ON public.task_ingredients FOR DELETE TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'inventory_txns') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'inventory_txns'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.inventory_txns;', pol.policyname);
    END LOOP;
  END IF;
END $$;

CREATE POLICY "inventory_txns_org_member_select"
ON public.inventory_txns FOR SELECT TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "inventory_txns_org_member_insert"
ON public.inventory_txns FOR INSERT TO authenticated
WITH CHECK (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

CREATE POLICY "inventory_txns_org_member_update"
ON public.inventory_txns FOR UPDATE TO authenticated
USING (org_id IS NOT NULL AND public.kk_auth_can_access_org(org_id));

-- ============================================================================
-- Explicit RLS policies for profiles/admin_profiles/dishes/time_off_requests
-- ============================================================================

DROP POLICY IF EXISTS "orgs_member_or_admin_select" ON public.orgs;
DROP POLICY IF EXISTS "orgs_member_or_admin_update" ON public.orgs;
DROP POLICY IF EXISTS "orgs_member_or_admin_insert" ON public.orgs;

CREATE POLICY "orgs_member_or_admin_select"
ON public.orgs
FOR SELECT
TO authenticated
USING (public.kk_auth_can_access_org(id));

CREATE POLICY "orgs_member_or_admin_update"
ON public.orgs
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = orgs.id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = orgs.id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "orgs_member_or_admin_insert"
ON public.orgs
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

-- shift_requests (mobile Schedule: time off + shift transfer to coworker)
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'shift_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.shift_requests;', pol.policyname);
    END LOOP;

    EXECUTE $sql$
      CREATE POLICY "shift_requests_select_org_member"
      ON public.shift_requests FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shift_requests_insert_org_member"
      ON public.shift_requests FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shift_requests_update_org_member"
      ON public.shift_requests FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "shift_requests_delete_org_member"
      ON public.shift_requests FOR DELETE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;

DROP POLICY IF EXISTS "profiles_org_member_or_admin_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_org_member_or_admin_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_org_member_or_admin_update" ON public.profiles;

CREATE POLICY "profiles_org_member_or_admin_select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = profiles.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "profiles_org_member_or_admin_insert"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = profiles.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "profiles_org_member_or_admin_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = profiles.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = profiles.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

DROP POLICY IF EXISTS "admin_profiles_self_or_admin_select" ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_self_or_admin_insert" ON public.admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_self_or_admin_update" ON public.admin_profiles;

CREATE POLICY "admin_profiles_self_or_admin_select"
ON public.admin_profiles
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "admin_profiles_self_or_admin_insert"
ON public.admin_profiles
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "admin_profiles_self_or_admin_update"
ON public.admin_profiles
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

DROP POLICY IF EXISTS "dishes_org_member_or_admin_select" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_insert" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_update" ON public.dishes;
DROP POLICY IF EXISTS "dishes_org_member_or_admin_delete" ON public.dishes;

CREATE POLICY "dishes_org_member_or_admin_select"
ON public.dishes
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = dishes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = dishes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "dishes_org_member_or_admin_insert"
ON public.dishes
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = dishes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = dishes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "dishes_org_member_or_admin_update"
ON public.dishes
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = dishes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = dishes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = dishes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = dishes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "dishes_org_member_or_admin_delete"
ON public.dishes
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = dishes.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.org_id = dishes.org_id
          AND p.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

DROP POLICY IF EXISTS "time_off_requests_org_member_or_admin_select" ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_requests_org_member_or_admin_insert" ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_requests_org_member_or_admin_update" ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_requests_org_member_or_admin_delete" ON public.time_off_requests;

CREATE POLICY "time_off_requests_org_member_or_admin_select"
ON public.time_off_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = time_off_requests.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "time_off_requests_org_member_or_admin_insert"
ON public.time_off_requests
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = time_off_requests.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "time_off_requests_org_member_or_admin_update"
ON public.time_off_requests
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = time_off_requests.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = time_off_requests.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

CREATE POLICY "time_off_requests_org_member_or_admin_delete"
ON public.time_off_requests
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = time_off_requests.org_id
    )
    OR EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND coalesce(au.is_admin, false) = true
    )
);

-- ============================================================================
-- Hard reset profiles RLS policies (mobile profile save fix)
-- ============================================================================
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_self_select_or_admin"
ON public.profiles
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
  OR EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_self_insert_or_admin"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
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
  OR EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_self_update_or_admin"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
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
  OR EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
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
  OR EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

CREATE POLICY "profiles_self_delete_or_admin"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
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
  OR EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
  )
);

-- ============================================================================
-- Hard reset shifts RLS policies (web scheduler + mobile calendar sync)
-- ============================================================================
ALTER TABLE IF EXISTS public.shifts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shifts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.shifts;', pol.policyname);
  END LOOP;
END $$;

-- Read own shifts, or org shifts if member/admin.
CREATE POLICY "shifts_select_self_org_or_admin"
ON public.shifts
FOR SELECT
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.org_id = shifts.org_id
      AND p.user_id = auth.uid()
      AND lower(coalesce(p.employee_name, '')) = lower(coalesce(shifts.employee_name, ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

-- Managers/admins can create shifts; employees can create only their own.
CREATE POLICY "shifts_insert_self_org_or_admin"
ON public.shifts
FOR INSERT
TO authenticated
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.org_id = shifts.org_id
      AND p.user_id = auth.uid()
      AND lower(coalesce(p.employee_name, '')) = lower(coalesce(shifts.employee_name, ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

-- Managers/admins can edit org shifts; employees can edit only their own rows.
CREATE POLICY "shifts_update_self_org_or_admin"
ON public.shifts
FOR UPDATE
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.org_id = shifts.org_id
      AND p.user_id = auth.uid()
      AND lower(coalesce(p.employee_name, '')) = lower(coalesce(shifts.employee_name, ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
)
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.org_id = shifts.org_id
      AND p.user_id = auth.uid()
      AND lower(coalesce(p.employee_name, '')) = lower(coalesce(shifts.employee_name, ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

CREATE POLICY "shifts_delete_self_org_or_admin"
ON public.shifts
FOR DELETE
TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.org_id = shifts.org_id
      AND p.user_id = auth.uid()
      AND lower(coalesce(p.employee_name, '')) = lower(coalesce(shifts.employee_name, ''))
  )
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = auth.uid()
      AND om.org_id = shifts.org_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p_org
    WHERE p_org.org_id = shifts.org_id
      AND (
        p_org.user_id = auth.uid()
        OR lower(coalesce(p_org.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

-- ============================================================
-- Normalize DM channel IDs: dm-u:<recipient> → dm:<sorted_pair>
-- Both participants compute the same channel_id so alias handling
-- disappears entirely.
-- ============================================================

-- Convert dm-u:<recipient> rows that have employee_id (sender UUID)
UPDATE public.messages
SET channel_id = CASE
    WHEN lower(employee_id::text) < lower(substring(channel_id FROM 6))
    THEN 'dm:' || lower(employee_id::text) || ':' || lower(substring(channel_id FROM 6))
    ELSE 'dm:' || lower(substring(channel_id FROM 6)) || ':' || lower(employee_id::text)
END
WHERE channel_id LIKE 'dm-u:%'
  AND employee_id IS NOT NULL;

-- Remove orphaned dm-u: rows that lack a sender UUID (unmigrateable)
DELETE FROM public.messages
WHERE channel_id LIKE 'dm-u:%'
  AND employee_id IS NULL;

-- ============================================================================
-- RLS for notifications (required: table has RLS enabled but zero policies)
-- Without these policies, ALL notification reads/writes fail for authenticated users.
-- ============================================================================
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications;', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "notifications_select_org_member_or_admin"
ON public.notifications FOR SELECT TO authenticated
USING (public.kk_auth_can_access_org(org_id));

CREATE POLICY "notifications_insert_org_member_or_admin"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.kk_auth_can_access_org(org_id));

CREATE POLICY "notifications_update_org_member_or_admin"
ON public.notifications FOR UPDATE TO authenticated
USING (public.kk_auth_can_access_org(org_id));

-- ============================================================================
-- RLS for task_transfer_requests (enable + add permissive policies)
-- ============================================================================
ALTER TABLE IF EXISTS public.task_transfer_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'task_transfer_requests') THEN
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'task_transfer_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.task_transfer_requests;', pol.policyname);
    END LOOP;

    EXECUTE $sql$
      CREATE POLICY "ttr_select_org_member_or_admin"
      ON public.task_transfer_requests FOR SELECT TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "ttr_insert_org_member_or_admin"
      ON public.task_transfer_requests FOR INSERT TO authenticated
      WITH CHECK (public.kk_auth_can_access_org(org_id));
    $sql$;
    EXECUTE $sql$
      CREATE POLICY "ttr_update_org_member_or_admin"
      ON public.task_transfer_requests FOR UPDATE TO authenticated
      USING (public.kk_auth_can_access_org(org_id));
    $sql$;
  END IF;
END $$;
