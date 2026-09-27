ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seller_page_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_seller_page_slug
  ON contacts (seller_page_slug)
  WHERE seller_page_slug IS NOT NULL;
