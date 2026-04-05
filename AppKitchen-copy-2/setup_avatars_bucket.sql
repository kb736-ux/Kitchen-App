-- Ensure avatars bucket exists and is public
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Remove any existing policies with the same name to avoid duplicates
DROP POLICY IF EXISTS "Allow public uploads to avatars bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates to avatars bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow public viewing of avatars" ON storage.objects;

-- Allow public uploads to avatars bucket
CREATE POLICY "Allow public uploads to avatars bucket"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'avatars');

-- Allow public updates to avatars bucket
CREATE POLICY "Allow public updates to avatars bucket"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'avatars');

-- Allow anyone to read the avatars bucket contents
CREATE POLICY "Allow public viewing of avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');
