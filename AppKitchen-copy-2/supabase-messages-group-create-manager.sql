-- ============================================================================
-- Messages: manager-only group CREATE (web + mobile)
-- ============================================================================
-- Anyone in the org may reply in an existing group-* channel.
-- Only managers (org_members.role manager/owner) or admin_users may insert
-- the first row that creates a new group channel.
--
-- Run in Supabase SQL Editor after backup.
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.kk_auth_is_org_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_auth_is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_auth_is_org_manager(uuid) TO service_role;

-- Bypass RLS on messages so this check cannot recurse through insert policy.
CREATE OR REPLACE FUNCTION public.kk_chat_channel_exists(p_org_id uuid, p_channel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.org_id = p_org_id
      AND m.channel_id = p_channel_id
  );
$$;

REVOKE ALL ON FUNCTION public.kk_chat_channel_exists(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_chat_channel_exists(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_chat_channel_exists(uuid, text) TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_any_member_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_privacy" ON public.messages;

CREATE POLICY "messages_insert_privacy"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.user_id = auth.uid())
  AND (
    (
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
    OR (
      channel_id LIKE 'group-%'
      AND (
        public.kk_auth_is_org_manager(org_id)
        OR public.kk_chat_channel_exists(org_id, channel_id)
      )
    )
  )
);
