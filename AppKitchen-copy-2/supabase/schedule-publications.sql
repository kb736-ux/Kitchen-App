-- =============================================================================
-- Publish week: one row per restaurant + Monday, plus the last emailed snapshot
-- =============================================================================
-- Run in Supabase → SQL Editor (as postgres), then deploy the Edge Function
-- (see DEPLOY NOTES at the bottom).
--
-- Visibility choice
-- -----------------
-- Saving a shift already inserts a live row in public.shifts. The manager web
-- app and the Expo schedule both SELECT shifts with no draft/published filter,
-- so staff see shifts the moment they are saved.
--
-- This table does NOT hide unpublished weeks. Gating the staff app on a
-- publication row would blank every schedule already in production until a
-- manager pressed Publish. Publish is the notification trigger only.
--
-- notified_snapshot
-- -----------------
-- jsonb keyed by employee identity. Each value is
--   { "name", "email", "shifts": [{ "date", "start", "end", "position" }] }
-- for the shifts we successfully emailed. Re-publish compares the live week
-- to this snapshot and emails only people whose set changed (including a
-- person whose shifts were all removed). Failed or address-less sends are
-- left on the previous snapshot so the next publish retries them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.schedule_publications (
  org_id uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  notified_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (org_id, week_start),
  CONSTRAINT schedule_publications_week_monday
    CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

ALTER TABLE public.schedule_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_publications_select_manager" ON public.schedule_publications;

-- Managers read publish status for the week button. Writes go through the
-- publish-week Edge Function (service role), which also checks the caller.
CREATE POLICY "schedule_publications_select_manager"
ON public.schedule_publications
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.org_id = schedule_publications.org_id
      AND om.user_id = auth.uid()
      AND lower(om.role::text) IN ('manager', 'owner', 'admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND coalesce(au.is_admin, false) = true
  )
);

REVOKE ALL ON TABLE public.schedule_publications FROM anon;
GRANT SELECT ON TABLE public.schedule_publications TO authenticated;
GRANT ALL ON TABLE public.schedule_publications TO service_role;

SELECT pg_notify('pgrst', 'reload schema');

-- =============================================================================
-- DEPLOY NOTES
-- =============================================================================
-- 1. Paste this file into Supabase → SQL Editor → Run.
-- 2. From AppKitchen-copy-2/ (or the repo that contains supabase/):
--      supabase functions deploy publish-week
--    config.toml sets verify_jwt = true for this function.
-- 3. Edge Function secrets (Dashboard → Edge Functions → Secrets, or CLI).
--    Do not commit these values.
--      RESEND_API_KEY    Resend API key
--      RESEND_FROM       Verified sender, e.g. Sheek <schedule@sheekapp.com>
--      SHEEK_APP_URL     Optional. Link behind "Get the Sheek app".
--                        Defaults to https://sheekapp.com until a store URL exists.
--    Supabase injects SUPABASE_URL, SUPABASE_ANON_KEY, and
--    SUPABASE_SERVICE_ROLE_KEY. Do not set those by hand.
-- 4. Confirm the Resend domain on RESEND_FROM before expecting delivery.
-- 5. No phone push is sent from publish-week. Per-shift assign still uses the
--    existing in-app/push path; this function does not email on each edit.
-- =============================================================================
