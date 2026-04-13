-- Allow a staff member who just finished onboarding to upsert their own employee_positions row
-- (name must match their profile for that org). Managers/admins remain covered by existing policies.
-- Run in Supabase SQL Editor if onboarding completes but positions stay empty.

CREATE POLICY "employee_positions_insert_self_matching_profile"
ON public.employee_positions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.org_id = employee_positions.org_id
      AND trim(coalesce(p.employee_name, '')) = trim(coalesce(employee_positions.employee_name, ''))
  )
);

CREATE POLICY "employee_positions_update_self_matching_profile"
ON public.employee_positions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.org_id = employee_positions.org_id
      AND trim(coalesce(p.employee_name, '')) = trim(coalesce(employee_positions.employee_name, ''))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.org_id = employee_positions.org_id
      AND trim(coalesce(p.employee_name, '')) = trim(coalesce(employee_positions.employee_name, ''))
  )
);
