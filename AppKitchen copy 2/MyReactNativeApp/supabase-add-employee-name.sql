-- Run this in Supabase SQL Editor to add employee_name for urgent task claiming
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS employee_name text;
