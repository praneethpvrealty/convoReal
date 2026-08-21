-- Add SEO fields and slug to agency_articles
ALTER TABLE agency_articles
ADD COLUMN slug TEXT,
ADD COLUMN meta_title TEXT,
ADD COLUMN meta_description TEXT;

-- Add SEO fields, slug, and content to agency_services
ALTER TABLE agency_services
ADD COLUMN slug TEXT,
ADD COLUMN meta_title TEXT,
ADD COLUMN meta_description TEXT,
ADD COLUMN content TEXT;

-- For existing rows, we could backfill slugs based on title, but since it's a new feature and there might be no rows or just testing rows, 
-- we'll just allow it. We want to add a UNIQUE constraint on (account_id, slug) to avoid conflicts for the URL path.
-- But first we need to handle existing rows with NULL slugs.
-- Generate a random slug for existing rows just to satisfy a unique constraint if we added NOT NULL, but we'll keep them nullable for now.
-- However, the unique constraint should ignore NULLs or we can just apply it. In postgres, UNIQUE ignores NULLs.

ALTER TABLE agency_articles
ADD CONSTRAINT agency_articles_account_id_slug_key UNIQUE (account_id, slug);

ALTER TABLE agency_services
ADD CONSTRAINT agency_services_account_id_slug_key UNIQUE (account_id, slug);
