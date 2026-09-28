WITH nearest_merge AS (
  SELECT DISTINCT ON (cpi.id)
    cpi.id,
    NULLIF(m.source_snapshot->>'source', '') AS source
  FROM public.contact_property_inquiries cpi
  JOIN public.contact_merge_log m
    ON m.target_id = cpi.contact_id
   AND m.account_id = cpi.account_id
   AND m.created_at BETWEEN cpi.created_at AND cpi.created_at + INTERVAL '10 seconds'
  WHERE cpi.inquiry_source IS NULL
  ORDER BY cpi.id, m.created_at
)
UPDATE public.contact_property_inquiries cpi
  SET inquiry_source = nearest_merge.source
  FROM nearest_merge
  WHERE cpi.id = nearest_merge.id
    AND nearest_merge.source IS NOT NULL;
