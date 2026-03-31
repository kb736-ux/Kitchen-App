-- Approved calendar time off: store date range on shift_requests so the web scheduler
-- can block assigning shifts during that period after approval.
-- Run in Supabase → SQL Editor (safe to run multiple times).

ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_start_date date;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS time_off_end_date date;

SELECT 'shift_requests time_off_* columns OK' AS status;
