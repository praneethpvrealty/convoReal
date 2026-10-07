ALTER POLICY "Agents can upload property images" ON storage.objects
  WITH CHECK (
    bucket_id = 'property-images'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Agents can update property images" ON storage.objects
  USING (
    bucket_id = 'property-images'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Agents can delete property images" ON storage.objects
  USING (
    bucket_id = 'property-images'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Agents can upload private property images" ON storage.objects
  WITH CHECK (
    bucket_id = 'property-images-private'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Agents can update private property images" ON storage.objects
  USING (
    bucket_id = 'property-images-private'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Agents can delete private property images" ON storage.objects
  USING (
    bucket_id = 'property-images-private'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Users can upload property documents" ON storage.objects
  WITH CHECK (
    bucket_id = 'property-documents'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Users can update property documents" ON storage.objects
  USING (
    bucket_id = 'property-documents'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );

ALTER POLICY "Users can delete property documents" ON storage.objects
  USING (
    bucket_id = 'property-documents'
    AND public.is_account_writer(((storage.foldername(name))[1])::uuid, 'agent')
  );
