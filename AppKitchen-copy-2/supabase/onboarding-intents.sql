-- =============================================================================
-- Onboarding intents (Stripe Checkout → webhook creates org; user after payment)
-- =============================================================================
-- Run in Supabase → SQL Editor (as postgres).
-- Flow: stripe-onboard-checkout inserts row (no auth user yet) → customer pays →
--       webhook creates org, sets status awaiting_signup → onboard-complete-signup
--       creates auth user + org_members + profiles.
-- RLS enabled with no policies: only the service role can access this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  restaurant_name text NOT NULL,
  plan text NOT NULL CHECK (lower(trim(plan)) IN ('starter', 'growth', 'scale')),
  auth_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  stripe_checkout_session_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'awaiting_signup', 'completed', 'failed')
  ),
  org_id uuid REFERENCES public.orgs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_intents_stripe_session_uidx
  ON public.onboarding_intents (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS onboarding_intents_auth_user_idx ON public.onboarding_intents (auth_user_id);
CREATE INDEX IF NOT EXISTS onboarding_intents_status_idx ON public.onboarding_intents (status);

ALTER TABLE public.onboarding_intents ENABLE ROW LEVEL SECURITY;

SELECT pg_notify('pgrst', 'reload schema');
