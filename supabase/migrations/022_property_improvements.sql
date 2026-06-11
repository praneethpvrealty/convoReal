-- ============================================================
-- 022_property_improvements.sql
-- Adds new specifications and storage bucket for properties
-- ============================================================

-- 1. Add new columns to properties table
ALTER TABLE properties 
  ADD COLUMN IF NOT EXISTS land_area NUMERIC,
  ADD COLUMN IF NOT EXISTS super_built_area NUMERIC,
  ADD COLUMN IF NOT EXISTS sublocality TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT;

-- 2. Create the property-images Supabase Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-images',
  'property-images',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Storage policies for property-images bucket
DROP POLICY IF EXISTS "Property images are publicly readable" ON storage.objects;
CREATE POLICY "Property images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

DROP POLICY IF EXISTS "Agents can upload property images" ON storage.objects;
CREATE POLICY "Agents can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    -- Checks if folder name (account_id) belongs to user and user is agent+
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Agents can update property images" ON storage.objects;
CREATE POLICY "Agents can update property images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'property-images'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Agents can delete property images" ON storage.objects;
CREATE POLICY "Agents can delete property images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
