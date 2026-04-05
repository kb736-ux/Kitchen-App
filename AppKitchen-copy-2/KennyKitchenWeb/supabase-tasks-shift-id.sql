-- Links tasks to shifts so when a shift is transferred, tasks move with it.
-- Run once in Supabase → SQL Editor.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_org_shift_id ON public.tasks (org_id, shift_id) WHERE shift_id IS NOT NULL;

SELECT 'tasks.shift_id ready' AS status;
