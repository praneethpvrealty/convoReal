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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload their own flow media'
  ) THEN
    ALTER POLICY "Users can upload their own flow media" ON storage.objects
      WITH CHECK (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Members can upload flow media'
  ) THEN
    ALTER POLICY "Members can upload flow media" ON storage.objects
      WITH CHECK (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload their own flow media'
  ) THEN
    CREATE POLICY "Members can upload flow media" ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own flow media'
  ) THEN
    ALTER POLICY "Users can update their own flow media" ON storage.objects
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Members can update flow media'
  ) THEN
    ALTER POLICY "Members can update flow media" ON storage.objects
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own flow media'
  ) THEN
    CREATE POLICY "Members can update flow media" ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own flow media'
  ) THEN
    ALTER POLICY "Users can delete their own flow media" ON storage.objects
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Members can delete flow media'
  ) THEN
    ALTER POLICY "Members can delete flow media" ON storage.objects
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own flow media'
  ) THEN
    CREATE POLICY "Members can delete flow media" ON storage.objects FOR DELETE
      USING (
        bucket_id = 'flow-media'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
            AND public.is_account_writer(p.account_id, 'agent')
        )
      );
  END IF;
END
$$;
