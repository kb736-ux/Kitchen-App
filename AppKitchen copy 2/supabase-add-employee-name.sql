-- THE FIX: tasks table is missing employee_name column.
-- Every web task insert fails silently → mobile sees 0 assigned tasks.
-- Run this in Supabase → SQL Editor.

-- 1. Add the missing column (safe to run again — no-op if it already exists)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS employee_name text;

-- 2. Delete orphaned tasks that were saved without any assignee
--    (they have null employee_id AND null employee_name — they can't be shown to anyone)
DELETE FROM public.tasks
WHERE (employee_name IS NULL OR employee_name = '')
  AND (employee_id IS NULL)
  AND (assigned_to IS NULL);

-- 3. Verify
SELECT 'tasks.employee_name column added and orphans cleaned' AS status;
SELECT COUNT(*) AS remaining_tasks FROM public.tasks;
SELECT id, employee_name, employee_id, text, status FROM public.tasks ORDER BY created_at DESC LIMIT 10;
