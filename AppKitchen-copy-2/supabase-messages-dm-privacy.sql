-- ============================================================================
-- Messages: DM privacy (web + mobile)
-- ============================================================================
-- Problem: Policy "messages_any_member_select" with USING (true) lets every
-- authenticated org user read ALL rows, including direct messages between two
-- other people (e.g. manager seeing Kenny ↔ Rohan).
--
-- Run this in Supabase SQL Editor after backup / in a maintenance window.
-- ============================================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_any_member_select" ON public.messages;
DROP POLICY IF EXISTS "messages_select_privacy" ON public.messages;
DROP POLICY IF EXISTS "messages_any_member_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_privacy" ON public.messages;

-- SELECT: group channels visible to anyone with a profile in that org;
--         dm:uuid:uuid only if auth user is one of the two profile ids.
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

-- INSERT: same rule so users cannot post into someone else's DM thread.
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
