-- Optional: remove the old auto-seeded demo rows from employee_positions
-- (Kenny, Rohan, Natalie, …) if they were inserted by an earlier app version.
-- Replace :org_id with your org UUID from Supabase (or use a WHERE you trust).

-- Preview first:
-- SELECT id, employee_name, positions FROM public.employee_positions
-- WHERE org_id = 'YOUR_ORG_ID_HERE'
--   AND employee_name IN (
--     'Kenny','Rohan','Natalie','Jake','Sam','Sophia','Aria','Alex',
--     'Meagan','Josh','Ben','Justin','Hannah','Gary'
--   );

-- DELETE FROM public.employee_positions
-- WHERE org_id = 'YOUR_ORG_ID_HERE'
--   AND employee_name IN (
--     'Kenny','Rohan','Natalie','Jake','Sam','Sophia','Aria','Alex',
--     'Meagan','Josh','Ben','Justin','Hannah','Gary'
--   );
