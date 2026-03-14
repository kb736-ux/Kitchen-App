-- =============================================================================
-- RUN THIS IN SUPABASE SQL EDITOR when you see:
--   "Could not find the table 'public.admin_profiles' in the schema cache"
-- =============================================================================
-- 1. Supabase Dashboard → SQL Editor → New query
-- 2. Paste this entire file and click Run
-- =============================================================================

-- Orgs: ensure name and logo_url exist
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS logo_url text;

-- Create admin_profiles table (used by Admin Settings for first/last name)
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  display_name text,
  updated_at timestamptz default now()
);

ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Allow authenticated users to read/update their own admin profile
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own admin profile" ON admin_profiles;
CREATE POLICY "Users can read own admin profile" ON admin_profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own admin profile" ON admin_profiles;
CREATE POLICY "Users can update own admin profile" ON admin_profiles FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own admin profile" ON admin_profiles;
CREATE POLICY "Users can insert own admin profile" ON admin_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Orgs: allow authenticated users to read and update (so admin can change restaurant name)
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read orgs" ON orgs;
CREATE POLICY "Allow read orgs" ON orgs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow update orgs" ON orgs;
CREATE POLICY "Allow update orgs" ON orgs FOR UPDATE USING (true);
