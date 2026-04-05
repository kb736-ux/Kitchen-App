# Profile picture upload: "Bucket not found"

The app uploads profile photos to a Supabase Storage bucket named **`avatars`**. If you see "Upload failed: Bucket not found", create the bucket once:

## Steps

1. Open **Supabase Dashboard**: https://supabase.com/dashboard → your project.
2. Go to **Storage** in the left sidebar.
3. Click **"New bucket"**.
4. **Name:** `avatars` (must be exactly this).
5. Turn **"Public bucket"** **ON** (so the app can use public URLs for profile photos).
6. Click **Create bucket**.

Then try changing your profile picture again in the mobile app.
