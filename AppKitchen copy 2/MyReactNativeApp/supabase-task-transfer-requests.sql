-- Run this in Supabase SQL Editor to add task transfer requests
--
-- If inserts fail with "stack depth limit exceeded", run (once) in SQL Editor:
--   ../fix-task-transfer-stack-depth.sql
-- or the full ../fix-rls-stack-depth-recursion.sql
--
CREATE TABLE IF NOT EXISTS public.task_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  from_employee_name text NOT NULL,
  to_employee_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookup by recipient
CREATE INDEX IF NOT EXISTS idx_task_transfer_to_employee 
  ON public.task_transfer_requests(to_employee_name, status) 
  WHERE status = 'pending';
