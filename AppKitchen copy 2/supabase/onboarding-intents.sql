-- =============================================================================
-- Onboarding intents (Stripe Checkout → webhook creates org after payment)
-- =============================================================================
-- Run in Supabase → SQL Editor (as postgres).
-- Edge Function stripe-onboard-checkout inserts rows; stripe-webhook completes them.
-- RLS enabled with no policies: only the service role can access this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  restaurant_name text NOT NULL,
  plan text NOT NULL CHECK (lower(trim(plan)) IN ('starter', 'growth', 'scale')),
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_checkout_session_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
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

-- If you created this table earlier without status "processing", run:
-- ALTER TABLE public.onboarding_intents DROP CONSTRAINT IF EXISTS onboarding_intents_status_check;
-- ALTER TABLE public.onboarding_intents ADD CONSTRAINT onboarding_intents_status_check
--   CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

SELECT pg_notify('pgrst', 'reload schema');
