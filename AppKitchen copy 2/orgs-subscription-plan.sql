-- =============================================================================
-- Subscription plan per organization (employee-count tiers)
-- =============================================================================
-- Run in Supabase → SQL Editor.
--
-- Plans (enforced in web app; align billing e.g. Stripe separately):
--   starter — up to 20 employees (profiles per org)
--   growth  — 21–40 employees
--   scale   — 41+ employees (unlimited cap in app)
-- =============================================================================

ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS subscription_plan text;

ALTER TABLE public.orgs
  DROP CONSTRAINT IF EXISTS orgs_subscription_plan_check;

ALTER TABLE public.orgs ALTER COLUMN subscription_plan SET DEFAULT 'starter';

UPDATE public.orgs
SET subscription_plan = 'starter'
WHERE subscription_plan IS NULL
   OR trim(subscription_plan) = ''
   OR lower(trim(subscription_plan)) NOT IN ('starter', 'growth', 'scale');

ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_subscription_plan_check
  CHECK (subscription_plan IN ('starter', 'growth', 'scale'));

ALTER TABLE public.orgs ALTER COLUMN subscription_plan SET NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
