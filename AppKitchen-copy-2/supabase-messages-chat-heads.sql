-- ============================================================================
-- Chat: latest-per-channel heads (fast conversation list)
-- ============================================================================
-- Web + Expo used to SELECT every messages row for the org before painting
-- the sidebar. This RPC returns one latest row per channel_id so the list
-- can render without downloading full histories.
--
-- SECURITY INVOKER: existing messages SELECT RLS still applies (DM privacy).
-- Client falls back to a bounded recent-row scan if this is not deployed.
--
-- Run in Supabase SQL Editor after backup.
-- ============================================================================

CREATE INDEX IF NOT EXISTS messages_org_channel_created_idx
  ON public.messages (org_id, channel_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.kk_chat_conversation_heads(p_org_id uuid)
RETURNS TABLE (
  channel_id text,
  id uuid,
  sender text,
  text text,
  created_at timestamptz,
  employee_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.channel_id)
    m.channel_id,
    m.id,
    m.sender,
    m.text,
    m.created_at,
    m.employee_id
  FROM public.messages m
  WHERE m.org_id = p_org_id
    AND m.channel_id IS NOT NULL
    AND m.channel_id <> ''
  ORDER BY m.channel_id, m.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.kk_chat_conversation_heads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kk_chat_conversation_heads(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kk_chat_conversation_heads(uuid) TO service_role;
