-- Run in Supabase SQL Editor if the web app logs missing columns on notifications, e.g.:
--   column notifications.type does not exist
--   column notifications.title does not exist
-- Adds columns the manager app expects (all nullable / safe defaults).

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS type text;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS body text;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read boolean DEFAULT false;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Optional backfill
UPDATE public.notifications SET type = 'general' WHERE type IS NULL;
