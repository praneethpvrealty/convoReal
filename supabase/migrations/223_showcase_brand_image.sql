-- The account's brand card: the image a WhatsApp template carries in
-- its header when the message has no photo of its own.
--
-- Media headers are a SEND-TIME parameter, not part of what Meta
-- reviewed, so an approved Utility template can carry a branded image
-- without touching its category. A property share leads with the
-- property's own photo; everything else — a listing with no photos
-- uploaded yet, a digest, a notice — had nothing to lead with and fell
-- back to the review-time sample (the app icon).
--
-- Stored as a bucket-relative object path, same convention as
-- properties.images, and resolved at the read boundary by
-- storagePublicUrl().

ALTER TABLE showcase_settings ADD COLUMN IF NOT EXISTS brand_image_url TEXT;

COMMENT ON COLUMN showcase_settings.brand_image_url IS
  'Bucket-relative path to the account brand card used as the WhatsApp template header image when a message carries no photo of its own.';
