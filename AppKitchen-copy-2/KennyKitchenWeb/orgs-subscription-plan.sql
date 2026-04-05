-- Same as ../orgs-subscription-plan.sql — run in Supabase SQL Editor.
-- See repo root orgs-subscription-plan.sql for the canonical copy.

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
