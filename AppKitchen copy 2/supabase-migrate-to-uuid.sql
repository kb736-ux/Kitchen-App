CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  employee_name text NOT NULL,
  token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, employee_name)
);

-- Add employee_id to all relevant tables
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE IF EXISTS public.shift_requests ADD COLUMN IF NOT EXISTS employee_id uuid;

-- Backfill existing data
UPDATE public.shifts s
SET employee_id = p.id
FROM public.employee_positions p
WHERE s.org_id = p.org_id AND s.employee_name = p.employee_name AND s.employee_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name = 'employee_name'
    ) THEN
        EXECUTE '
            UPDATE public.tasks t
            SET employee_id = p.id
            FROM public.employee_positions p
            WHERE t.org_id = p.org_id AND t.employee_name = p.employee_name AND t.employee_id IS NULL;
        ';
    END IF;
END $$;

UPDATE public.notifications n
SET employee_id = p.id
FROM public.employee_positions p
WHERE n.org_id = p.org_id AND n.employee_name = p.employee_name AND n.employee_id IS NULL;

UPDATE public.push_tokens pt
SET employee_id = p.id
FROM public.employee_positions p
WHERE pt.org_id = p.org_id AND pt.employee_name = p.employee_name AND pt.employee_id IS NULL;

-- Only run if shift_requests exists (ignore error if it doesn't)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_requests') THEN
        UPDATE public.shift_requests sr
        SET employee_id = p.id
        FROM public.employee_positions p
        WHERE sr.org_id = p.org_id AND sr.employee_name = p.employee_name AND sr.employee_id IS NULL;
    END IF;
END $$;
