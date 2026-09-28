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
lead_emails AS (
  SELECT
    l.account_id,
    l.created_at,
    l.matched_property_id,
    l.lead_portal_listing_id,
    right(regexp_replace(coalesce(l.extracted_phone, ''), '\D', '', 'g'), 10) AS phone,
    CASE
      WHEN sender_domain LIKE '%magicbricks.com' THEN 'magicbricks'
      WHEN sender_domain LIKE '%housing-mailer.com'
        OR sender_domain LIKE '%housing.com' THEN 'housing'
      WHEN sender_domain LIKE '%99acres.com' THEN '99acres'
    END AS portal
  FROM public.email_sync_logs l,
    LATERAL (
      SELECT lower(split_part(split_part(l.sender, '@', 2), '>', 1)) AS sender_domain
    ) d
),
evidence AS (
  SELECT DISTINCT ON (merged.id)
    merged.id,
    CASE e.portal
      WHEN 'magicbricks' THEN 'Magic Bricks'
      WHEN 'housing' THEN 'Housing'
      WHEN '99acres' THEN '99acres'
    END AS source
  FROM merged
  JOIN lead_emails e
    ON e.account_id = merged.account_id
   AND length(merged.phone) = 10
   AND e.phone = merged.phone
  WHERE e.portal IS NOT NULL
    AND (
      e.matched_property_id = merged.property_id
      OR EXISTS (
        SELECT 1 FROM public.property_portal_listings ppl
        WHERE ppl.account_id = merged.account_id
          AND ppl.property_id = merged.property_id
          AND ppl.portal = e.portal
          AND ppl.portal_listing_id = e.lead_portal_listing_id
      )
      OR EXISTS (
        SELECT 1 FROM public.property_portal_listing_aliases ppla
        WHERE ppla.account_id = merged.account_id
          AND ppla.property_id = merged.property_id
          AND ppla.portal = e.portal
          AND ppla.portal_listing_id = e.lead_portal_listing_id
      )
    )
  ORDER BY merged.id, e.created_at DESC
)
UPDATE public.contact_property_inquiries cpi
  SET inquiry_source = evidence.source
  FROM evidence
  WHERE cpi.id = evidence.id
    AND cpi.inquiry_source IS NULL;
