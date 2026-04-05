-- =============================================================================
-- Stripe billing columns on orgs (run in Supabase → SQL Editor)
-- =============================================================================
-- After this, deploy Edge Functions (see supabase/functions) and set secrets.
-- =============================================================================

ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS stripe_subscription_status text;

COMMENT ON COLUMN public.orgs.stripe_customer_id IS 'Stripe Customer id (cus_...)';
COMMENT ON COLUMN public.orgs.stripe_subscription_id IS 'Stripe Subscription id (sub_...) when on Checkout billing';
COMMENT ON COLUMN public.orgs.stripe_subscription_status IS 'Stripe subscription.status (active, past_due, canceled, ...)';

CREATE INDEX IF NOT EXISTS orgs_stripe_customer_id_idx ON public.orgs (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
