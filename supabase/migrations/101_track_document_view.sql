-- ============================================================
-- 101_track_document_view.sql — Track when a shared document link
--   is actually opened by the recipient.
--
-- property_document_requests already records share_sent_at (when the
-- agent's WhatsApp message went out), but nothing recorded whether the
-- recipient ever opened the link — the same "sent vs viewed" gap the
-- buyer showcase funnel already closes for property listings. This
-- closes it for shared documents.
--
-- viewed_at is set once, on first successful access (password
-- verified, or immediate render for a passwordless share) — see
-- src/lib/documents/track-view.ts.
-- ============================================================

ALTER TABLE property_document_requests
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
