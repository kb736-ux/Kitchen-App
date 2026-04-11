-- =============================================================================
-- FIX: Ghost employees appearing before signup is complete
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================
-- WHAT THIS DOES:
--   1. Adds an `onboarding_completed` flag to profiles
--   2. Marks existing real employees (those with org_members entries) as completed
--   3. Drops the auto-trigger that creates ghost profile rows on signInWithOtp
--   4. Cleans up any ghost profiles that were never finished
-- =============================================================================

-- Step 1: Add the onboarding_completed flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Step 2: Mark all existing real employees as completed
-- (Anyone who already has an org_members entry is a real, finished employee)
UPDATE public.profiles p
SET onboarding_completed = true
WHERE EXISTS (
  SELECT 1 FROM public.org_members om
  WHERE om.user_id = p.user_id
    AND om.org_id = p.org_id
);

-- Step 3: Drop the auto-trigger (it creates ghost profiles on every signInWithOtp call)
-- Common trigger names Supabase uses — drop whichever exists:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user ON auth.users;
DROP TRIGGER IF EXISTS create_profile_on_signup ON auth.users;
DROP TRIGGER IF EXISTS on_new_user ON auth.users;
DROP TRIGGER IF EXISTS new_user_profile ON auth.users;

-- Also drop the associated function if it was only used by the trigger:
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_for_user() CASCADE;

-- Step 4: Clean up ghost profiles (profiles that were never completed)
-- SAFE: only deletes rows with no org_members entry and no onboarding_completed flag
DELETE FROM public.profiles
WHERE onboarding_completed = false
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.user_id = profiles.user_id
      AND om.org_id = profiles.org_id
  );

-- Step 5: Confirm results
SELECT
  COUNT(*) FILTER (WHERE onboarding_completed = true) AS completed_employees,
  COUNT(*) FILTER (WHERE onboarding_completed = false) AS ghost_profiles_remaining
FROM public.profiles;
