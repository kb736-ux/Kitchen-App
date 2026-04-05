-- =============================================================================
-- Defer auth user until after Stripe payment + password on /onboard/complete.html
-- Run once in Supabase SQL Editor if onboarding_intents already exists.
-- =============================================================================

ALTER TABLE public.onboarding_intents DROP CONSTRAINT IF EXISTS onboarding_intents_status_check;
ALTER TABLE public.onboarding_intents ADD CONSTRAINT onboarding_intents_status_check
  CHECK (status IN ('pending', 'processing', 'awaiting_signup', 'completed', 'failed'));

ALTER TABLE public.onboarding_intents DROP CONSTRAINT IF EXISTS onboarding_intents_auth_user_id_fkey;
ALTER TABLE public.onboarding_intents ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE public.onboarding_intents ADD CONSTRAINT onboarding_intents_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

SELECT pg_notify('pgrst', 'reload schema');
