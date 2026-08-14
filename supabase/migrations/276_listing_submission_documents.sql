-- ============================================================
-- 276_listing_submission_documents.sql — a brochure with the listing.
--
-- Commercial landlords do not paste text: they send the deck. Suraj
-- Group's first contact was two PDF decks over WhatsApp, and the
-- seller funnel had nowhere to put them — the /list page accepted only
-- text and photos, and the draft came back with every field Missing.
-- One column: the uploaded brochure URL(s) ride the submission, and on
-- verification the PDF itself is parsed (Gemini reads it directly, the
-- same path the owner chatbot has used for PDFs all along) and its
-- embedded photos become the listing's gallery.
-- ============================================================

ALTER TABLE public_listing_submissions
  ADD COLUMN IF NOT EXISTS documents TEXT[] NOT NULL DEFAULT '{}';
