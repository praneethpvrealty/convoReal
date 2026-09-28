WITH merged AS (
  SELECT DISTINCT ON (cpi.id)
    cpi.id,
    cpi.account_id,
    cpi.property_id,
    right(regexp_replace(coalesce(m.source_snapshot->>'phone', ''), '\D', '', 'g'), 10) AS phone
  FROM public.contact_property_inquiries cpi
  JOIN public.contact_merge_log m
    ON m.target_id = cpi.contact_id
   AND m.account_id = cpi.account_id
   AND m.created_at BETWEEN cpi.created_at AND cpi.created_at + INTERVAL '10 seconds'
  WHERE cpi.inquiry_source IS NULL
  ORDER BY cpi.id, m.created_at
),
evidence AS (
  SELECT DISTINCT ON (merged.id)
    merged.id,
    CASE l.lead_portal
      WHEN 'magicbricks' THEN 'Magic Bricks'
      WHEN 'housing' THEN 'Housing'
      WHEN '99acres' THEN '99acres'
    END AS source
  FROM merged
  JOIN public.email_sync_logs l
    ON l.account_id = merged.account_id
   AND length(merged.phone) = 10
   AND right(regexp_replace(coalesce(l.extracted_phone, ''), '\D', '', 'g'), 10) = merged.phone
  WHERE l.lead_portal IN ('magicbricks', 'housing', '99acres')
    AND (
      l.matched_property_id = merged.property_id
      OR EXISTS (
        SELECT 1 FROM public.property_portal_listings ppl
        WHERE ppl.account_id = merged.account_id
          AND ppl.property_id = merged.property_id
          AND ppl.portal = l.lead_portal
          AND ppl.portal_listing_id = l.lead_portal_listing_id
      )
      OR EXISTS (
        SELECT 1 FROM public.property_portal_listing_aliases ppla
        WHERE ppla.account_id = merged.account_id
          AND ppla.property_id = merged.property_id
          AND ppla.portal = l.lead_portal
          AND ppla.portal_listing_id = l.lead_portal_listing_id
      )
    )
  ORDER BY merged.id, l.created_at DESC
)
UPDATE public.contact_property_inquiries cpi
  SET inquiry_source = evidence.source
  FROM evidence
  WHERE cpi.id = evidence.id
    AND cpi.inquiry_source IS NULL;
