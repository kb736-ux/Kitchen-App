-- =============================================================================
-- RUN THIS IN SUPABASE IF PROFILE SAVE FAILS ("column not found")
-- =============================================================================
-- 1. Open your Supabase project at https://supabase.com/dashboard
-- 2. Go to: SQL Editor
-- 3. Click "New query"
-- 4. Copy and paste the lines below, then click "Run"
-- =============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_color text;
