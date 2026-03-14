-- Create the 'avatars' bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop policies if they already exist, so the script can cleanly re-run
DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Avatar Images are publicly accessible." ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can upload an avatar." ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can update their avatar." ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can delete their avatar." ON storage.objects';
END $$;

-- Allow public read access to avatars
CREATE POLICY "Avatar Images are publicly accessible."
ON storage.objects FOR SELECT
USING ( bucket_id = 'avatars' );

-- Allow anon to upload avatar images
CREATE POLICY "Anyone can upload an avatar."
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'avatars' );

-- Allow anon to update their avatar images (overwrite)
CREATE POLICY "Anyone can update their avatar."
ON storage.objects FOR UPDATE
USING ( bucket_id = 'avatars' );

-- Allow anon to delete avatar images
CREATE POLICY "Anyone can delete their avatar."
ON storage.objects FOR DELETE
USING ( bucket_id = 'avatars' );
