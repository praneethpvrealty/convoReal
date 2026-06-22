-- ============================================================
-- 058_add_property_documents.sql
-- Adds documents array column to the properties table and creates
-- the property-documents storage bucket on Supabase.
-- ============================================================

ALTER TABLE properties 
  ADD COLUMN IF NOT EXISTS documents TEXT[] DEFAULT '{}';

-- Create the property-documents bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-documents',
  'property-documents',
  TRUE,
  10485760, -- 10 MB limit
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS Policies for property-documents
DROP POLICY IF EXISTS "Property documents are publicly readable" ON storage.objects;
CREATE POLICY "Property documents are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-documents');

DROP POLICY IF EXISTS "Users can upload property documents" ON storage.objects;
CREATE POLICY "Users can upload property documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-documents'
  );

DROP POLICY IF EXISTS "Users can update property documents" ON storage.objects;
CREATE POLICY "Users can update property documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'property-documents'
  );

DROP POLICY IF EXISTS "Users can delete property documents" ON storage.objects;
CREATE POLICY "Users can delete property documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-documents'
  );
