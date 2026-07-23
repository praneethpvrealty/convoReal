-- 164: Add a dynamic "View Property" URL button to the property-details
-- share templates so the message links to the property's showcase page.
--
-- The web share dialog auto-fills a URL button whose url contains {{1}}
-- with `?property_id=<code>&v=<contactId>` (see property-share-dialog.tsx),
-- producing e.g. https://www.convoreal.com/?property_id=PROP-1100&v=<id>.
--
-- IMPORTANT: a WhatsApp template's buttons must match what Meta approved.
-- Add/edit this same "View Property" dynamic URL button on the template in
-- Meta (WhatsApp Manager) and get it re-approved BEFORE applying this
-- migration — otherwise sends that include the button parameter are
-- rejected by Meta.

UPDATE message_templates
SET buttons = '[
  {"type": "URL", "text": "View Property", "url": "https://www.convoreal.com/{{1}}"}
]'::jsonb
WHERE name = 'share_property_details';

-- Image-header variant: swap the old static "View Photo Gallery" link for
-- the dynamic property URL, keeping the contact button.
UPDATE message_templates
SET buttons = '[
  {"type": "URL", "text": "View Property", "url": "https://www.convoreal.com/{{1}}"},
  {"type": "PHONE_NUMBER", "text": "Contact Agent", "phone_number": "+919999999999"}
]'::jsonb
WHERE name = 'share_property_details_with_image';
