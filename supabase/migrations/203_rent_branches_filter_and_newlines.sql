-- ============================================================
-- Two faults in the seeded rent branches, both visible to a lead.
--
-- 1. LITERAL \n
--    The three rent showcase nodes were seeded with an escaped newline,
--    so the intro reached WhatsApp as
--      "🔑 *Properties for Rent*\n\nHere are our current rental listings:"
--    with the \n printed rather than breaking the line. The buy-side
--    nodes carry real newlines; only these three are wrong.
--
-- 2. NO TYPE FILTER
--    All three carried only filter_listing_type = 'Rent' and no
--    filter_types, so every button returned the same undifferentiated
--    rental list. A lead who tapped "3 BHK & Penthouse" was shown a PG
--    building and a commercial office space. The button promised a
--    filter the node never applied.
--
-- Matched on the exact seeded values, so a flow reworded or re-filtered
-- in the builder keeps its own config.
-- ============================================================

UPDATE flow_nodes
SET config = config
  || jsonb_build_object(
       'intro_text', '🔑 *2 BHK Homes for Rent*

Here are our current listings:',
       'empty_text', '🔑 *2 BHK Homes for Rent*

Nothing available right now. Our team will reach out when something suitable is listed.',
       'filter_types', '["Flat/ Apartment","Builder Floor Apartment","Studio Apartment","Residential House"]'::jsonb
     )
WHERE node_key = 'rent_2bhk_info'
  AND node_type = 'send_property_listings'
  AND config->>'filter_listing_type' = 'Rent'
  AND config->'filter_types' IS NULL;

UPDATE flow_nodes
SET config = config
  || jsonb_build_object(
       'intro_text', '🔑 *3 BHK & Penthouses for Rent*

Here are our current listings:',
       'empty_text', '🔑 *3 BHK & Penthouses for Rent*

Nothing available right now. Our team will reach out when something suitable is listed.',
       'filter_types', '["Flat/ Apartment","Builder Floor Apartment","Penthouse","Villa","Residential House"]'::jsonb
     )
WHERE node_key = 'rent_3bhk_info'
  AND node_type = 'send_property_listings'
  AND config->>'filter_listing_type' = 'Rent'
  AND config->'filter_types' IS NULL;

UPDATE flow_nodes
SET config = config
  || jsonb_build_object(
       'intro_text', '🏢 *Commercial Space for Rent*

Here are our current listings:',
       'empty_text', '🏢 *Commercial Space for Rent*

Nothing available right now. Our team will reach out when something suitable is listed.',
       'filter_types', '["Commercial Office Space","Office in IT Park/ SEZ","Commercial Shop","Commercial Showroom","Commercial Building","Warehouse/ Godown"]'::jsonb
     )
WHERE node_key = 'rent_commercial_info'
  AND node_type = 'send_property_listings'
  AND config->>'filter_listing_type' = 'Rent'
  AND config->'filter_types' IS NULL;

-- Any other seeded node carrying the same escaped-newline damage. The
-- buy-side nodes were seeded correctly, so this normally matches
-- nothing; it exists so a flow seeded by the same bad path is repaired
-- rather than left to print backslashes at a customer.
UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{intro_text}',
      to_jsonb(replace(config->>'intro_text', '\n', chr(10)))
    )
WHERE config->>'intro_text' LIKE '%\n%';

UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{empty_text}',
      to_jsonb(replace(config->>'empty_text', '\n', chr(10)))
    )
WHERE config->>'empty_text' LIKE '%\n%';
