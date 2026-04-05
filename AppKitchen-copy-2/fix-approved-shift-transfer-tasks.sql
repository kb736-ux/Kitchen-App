-- Run once in Supabase SQL Editor.
--
-- Purpose:
-- Backfill task ownership for shift transfers that were already approved before
-- the newer transfer logic updated both shifts and tasks together.
--
-- What it does:
-- 1) Reassigns tasks already linked by tasks.shift_id to the current shift owner.
-- 2) Reassigns legacy tasks with shift_id IS NULL when they were assigned to the
--    original requester on that same shift day, and links them to the shift.
--
-- Assumes:
-- - public.tasks has columns: employee_name, employee_id, shift_id, created_at, due_at
-- - public.shift_requests contains approved transfer rows with shift_id populated

BEGIN;

-- 1) Fix shift-linked tasks for approved transfer requests.
WITH approved_transfers AS (
  SELECT DISTINCT
    sr.org_id,
    sr.shift_id,
    sr.employee_name AS previous_employee_name,
    sr.target_employee,
    s.employee_name AS current_shift_employee_name,
    s.employee_id AS current_shift_employee_id,
    s.shift_date
  FROM public.shift_requests sr
  JOIN public.shifts s
    ON s.id = sr.shift_id
   AND s.org_id = sr.org_id
  WHERE lower(sr.request_type::text) = 'transfer'
    AND lower(sr.status::text) IN ('approved', 'accepted')
    AND sr.shift_id IS NOT NULL
)
UPDATE public.tasks t
SET
  employee_name = at.current_shift_employee_name,
  employee_id = at.current_shift_employee_id
FROM approved_transfers at
WHERE t.org_id = at.org_id
  AND t.shift_id = at.shift_id
  AND (
    t.employee_name IS DISTINCT FROM at.current_shift_employee_name
    OR t.employee_id IS DISTINCT FROM at.current_shift_employee_id
  );

-- 2) Fix legacy tasks that were never linked to the shift.
WITH approved_transfers AS (
  SELECT DISTINCT
    sr.org_id,
    sr.shift_id,
    sr.employee_name AS previous_employee_name,
    sr.target_employee,
    s.employee_name AS current_shift_employee_name,
    s.employee_id AS current_shift_employee_id,
    s.shift_date
  FROM public.shift_requests sr
  JOIN public.shifts s
    ON s.id = sr.shift_id
   AND s.org_id = sr.org_id
  WHERE lower(sr.request_type::text) = 'transfer'
    AND lower(sr.status::text) IN ('approved', 'accepted')
    AND sr.shift_id IS NOT NULL
),
legacy_matches AS (
  SELECT
    t.id AS task_id,
    at.shift_id,
    at.current_shift_employee_name,
    at.current_shift_employee_id
  FROM public.tasks t
  JOIN approved_transfers at
    ON t.org_id = at.org_id
  WHERE t.shift_id IS NULL
    AND (
      lower(coalesce(t.employee_name, '')) = lower(coalesce(at.previous_employee_name, ''))
      OR lower(coalesce(t.employee_name, '')) = lower(split_part(coalesce(at.previous_employee_name, ''), ' ', 1))
      OR lower(split_part(coalesce(t.employee_name, ''), ' ', 1)) = lower(coalesce(at.previous_employee_name, ''))
    )
    AND (
      (t.created_at IS NOT NULL AND (t.created_at AT TIME ZONE 'UTC')::date = at.shift_date)
      OR (t.due_at IS NOT NULL AND (t.due_at AT TIME ZONE 'UTC')::date = at.shift_date)
      OR (t.created_at IS NULL AND t.due_at IS NULL)
    )
)
UPDATE public.tasks t
SET
  employee_name = lm.current_shift_employee_name,
  employee_id = lm.current_shift_employee_id,
  shift_id = lm.shift_id
FROM legacy_matches lm
WHERE t.id = lm.task_id;

COMMIT;

SELECT 'approved transfer tasks repaired' AS status;
