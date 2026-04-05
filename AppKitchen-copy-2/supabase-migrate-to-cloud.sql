-- Run in Supabase SQL Editor: Migrate localStorage data to Supabase for multi-restaurant support
-- =============================================================================

-- 1) Extend recipes table with full content (desc, ingredients, steps, yield, status)
-- Note: "desc" is a reserved word in SQL, so we quote it
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS "desc" text;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS ingredients jsonb DEFAULT '[]';
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS steps jsonb DEFAULT '[]';
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS yield_amount numeric;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS yield_unit text;

-- 2) Dishes table (recipe combinations)
CREATE TABLE IF NOT EXISTS public.dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  recipes jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Allow anon to read/write dishes (RLS can block otherwise)
ALTER TABLE public.dishes DISABLE ROW LEVEL SECURITY;

-- 3) Employee positions (employee_name -> list of positions)
CREATE TABLE IF NOT EXISTS public.employee_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  employee_name text NOT NULL,
  positions jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, employee_name)
);

-- 4) Extend inventory_items if needed (kitted, threshold_kitted, yield_per_portion, yield_unit)
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS kitted numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS threshold_kitted numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS yield_per_portion numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS yield_unit text;

-- 5) notifications table (if not exists)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  employee_name text NOT NULL,
  type text NOT NULL,
  title text,
  body text,
  read boolean DEFAULT false,
  shift_id uuid,
  created_at timestamptz DEFAULT now()
);

-- 6) messages table - ensure it has channel_id (mobile uses it)
-- If messages doesn't exist:
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  channel_id text NOT NULL,
  sender text NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 7) shift_requests table (time off, transfer requests)
CREATE TABLE IF NOT EXISTS public.shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  shift_id uuid,
  employee_name text NOT NULL,
  request_type text NOT NULL,
  note text,
  target_employee text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- If shift_requests exists but missing columns, add them
ALTER TABLE public.shift_requests ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE public.shift_requests ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE public.shift_requests ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.shift_requests ADD COLUMN IF NOT EXISTS target_employee text;
ALTER TABLE public.shift_requests ADD COLUMN IF NOT EXISTS status text;

-- Make user_id nullable if it exists (app uses employee_name, no auth)
ALTER TABLE public.shift_requests ALTER COLUMN user_id DROP NOT NULL;

-- 8) Seed active recipes (and inactive) so they transfer to mobile
-- Uses same ORG_ID as web/mobile config. Skips recipes that already exist.
INSERT INTO public.recipes (org_id, name, status, "desc", ingredients, steps, yield_amount, yield_unit)
SELECT v.org_id, v.name, v.status, v.desc, v.ingredients::jsonb, v.steps::jsonb, v.yield_amount, v.yield_unit
FROM (VALUES
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Focaccia Kit', 'active', 'House focaccia with olive oil and sea salt',
   '["500g flour","400ml warm water","10g salt","7g yeast","50ml olive oil","Sea salt, rosemary"]',
   '[{"prep":"Measure flour, water, salt, yeast. Oil a large baking pan.","active":"Mix dough, knead 10 min. Proof 1 hr. Stretch into pan, dimple, drizzle oil. Bake 220°C 25 min."},{"prep":"Cool rack, serving board","active":"Cool 10 min, slice, serve with olive oil."}]', 4, 'portions'),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Balsamic Glaze', 'active', 'Reduced balsamic for dressings and drizzles',
   '["500ml balsamic vinegar","2 tbsp honey"]',
   '[{"prep":"Measure vinegar and honey.","active":"Simmer in saucepan until reduced by half, 15–20 min. Cool to room temperature."}]', 1, 'qt'),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Smoked Salmon', 'active', 'Cold-smoked Atlantic salmon',
   '["1kg salmon fillet","50g salt","30g sugar","Black pepper","Smoking wood chips"]',
   '[{"prep":"Mix salt, sugar, pepper. Cure salmon 12 hrs. Rinse and dry.","active":"Cold-smoke 4–6 hrs at 25°C. Rest 24 hrs in fridge, slice thin."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Meringue', 'active', 'French meringue for desserts',
   '["4 egg whites","200g caster sugar","Pinch salt"]',
   '[{"prep":"Bring whites to room temp. Line baking sheet. Preheat oven 100°C.","active":"Whip whites + salt to soft peaks. Add sugar slowly. Pipe onto sheet. Bake 90 min."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Chilled Pea Soup', 'active', 'Creamy pea soup with mint',
   '["500g frozen peas","1 onion","500ml veg stock","100ml cream","Mint","Salt, pepper"]',
   '[{"prep":"Dice onion. Defrost peas. Chop mint.","active":"Sauté onion. Add peas + stock. Simmer 5 min. Blend, stir in cream. Chill, garnish mint."}]', 4, 'portions'),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Pickled Garlic', 'active', 'Quick-pickled garlic cloves',
   '["2 heads garlic","200ml rice vinegar","100ml water","50g sugar","1 tsp salt"]',
   '[{"prep":"Peel garlic cloves. Sterilize jar.","active":"Boil vinegar, water, sugar, salt. Pour over garlic. Seal, cool. Refrigerate 24 hrs."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Pumpkin Soup', 'archived', 'Seasonal roasted pumpkin soup',
   '["1kg pumpkin","1 onion","500ml stock","100ml cream"]',
   '[{"prep":"Dice pumpkin and onion. Preheat oven 200°C.","active":"Roast pumpkin 30 min. Sauté onion, add pumpkin and stock. Blend, add cream. Season."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Cranberry Relish', 'archived', 'Holiday cranberry relish',
   '["400g cranberries","100g sugar","Orange zest"]',
   '[{"prep":"Zest orange. Rinse cranberries.","active":"Simmer cranberries, sugar, zest 10 min until bursting. Cool. Chill."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Eggnog', 'archived', 'House eggnog (seasonal)',
   '["6 eggs","250ml milk","250ml cream","100g sugar","Nutmeg"]',
   '[{"prep":"Separate eggs. Measure milk, cream, sugar.","active":"Whip yolks + sugar. Add milk and cream. Fold in whipped whites. Grate nutmeg. Chill 4+ hrs."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Grilled Corn Salsa', 'archived', 'Summer corn and lime salsa',
   '["4 corn cobs","1 red onion","2 limes","Cilantro","Salt"]',
   '[{"prep":"Grill corn. Dice onion. Chop cilantro. Juice limes.","active":"Cut kernels off cobs. Mix with onion, lime juice, cilantro, salt. Serve chilled."}]', NULL, NULL),
  ('f4121c7b-53ed-45b3-9966-57af9b40cb5d'::uuid, 'Tomato Gazpacho', 'archived', 'Chilled tomato and cucumber soup',
   '["1kg tomatoes","1 cucumber","1 pepper","2 cloves garlic","Olive oil","Sherry vinegar"]',
   '[{"prep":"Core tomatoes. Peel cucumber. Deseed pepper. Peel garlic.","active":"Blend all until smooth. Add oil and vinegar. Chill 2 hrs. Serve cold."}]', NULL, NULL)
) AS v(org_id, name, status, desc, ingredients, steps, yield_amount, yield_unit)
WHERE NOT EXISTS (SELECT 1 FROM public.recipes r WHERE r.org_id = v.org_id AND r.name = v.name);
