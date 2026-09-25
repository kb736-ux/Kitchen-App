-- ============================================================================
-- Optional indexes for Sheek hot paths (org_id + date/status/employee)
-- ============================================================================
-- Client query shape is the real slowness (see docs/supabase-hotpath-audit.md).
-- These indexes help the *bounded* queries after you add limits/filters.
-- They will not make unbounded select('*') of years of shifts feel fast.
--
-- Safe to re-run. Does not migrate data or change RLS.
-- Run in Supabase SQL Editor after backup.
-- ============================================================================

-- Shifts: week/month grids, today roster, "my schedule"
CREATE INDEX IF NOT EXISTS shifts_org_date_idx
  ON public.shifts (org_id, shift_date);

CREATE INDEX IF NOT EXISTS shifts_org_employee_date_idx
  ON public.shifts (org_id, employee_name, shift_date);

-- Tasks: dashboard, Expo "mine", home urgent card
CREATE INDEX IF NOT EXISTS tasks_org_created_idx
  ON public.tasks (org_id, created_at);

CREATE INDEX IF NOT EXISTS tasks_org_employee_idx
  ON public.tasks (org_id, employee_id);

CREATE INDEX IF NOT EXISTS tasks_org_urgent_idx
  ON public.tasks (org_id, is_urgent)
  WHERE is_urgent IS TRUE;

-- Profiles / roster
CREATE INDEX IF NOT EXISTS profiles_org_user_idx
  ON public.profiles (org_id, user_id);

CREATE INDEX IF NOT EXISTS employee_positions_org_name_idx
  ON public.employee_positions (org_id, employee_name);

-- Shift requests: pending panel, time-off overlap
CREATE INDEX IF NOT EXISTS shift_requests_org_status_created_idx
  ON public.shift_requests (org_id, status, created_at DESC);

-- Notifications badge counts (Expo already uses count/head)
CREATE INDEX IF NOT EXISTS notifications_org_type_read_idx
  ON public.notifications (org_id, type, read);

-- Announcements (home card + chat)
CREATE INDEX IF NOT EXISTS announcements_org_created_idx
  ON public.announcements (org_id, created_at DESC);

SELECT 'hot-path indexes ready' AS status;
