-- ============================================================
-- AI tag suggestions on contacts.
--
-- The Gemini preference extraction (092) now also proposes up to 3
-- short buyer-profile labels ("Investor", "Rental Income", "NRI")
-- from the requirements/notes free text. They are stored here as
-- plain text and rendered on the Requirements cards as tappable
-- suggestion chips — an agent confirms each with a tap, which
-- creates/attaches a real CRM tag. Suggestions are NEVER attached
-- automatically, so the account's tag vocabulary stays curated.
-- Suggestions whose label matches an already-attached tag are
-- hidden by the UI (src/lib/contact-preferences.ts).
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pref_suggested_tags TEXT[];

COMMENT ON COLUMN contacts.pref_suggested_tags IS
  'AI-suggested CRM tag labels extracted from requirements/notes free text. Display-only until an agent confirms one (which creates/attaches a real tags/contact_tags row).';
