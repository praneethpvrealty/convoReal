-- ============================================================
-- 217_share_seller_final_price.sql
--
-- May the bot quote the seller's floor to a buyer?
--
-- Migration 215 gives a listing a seller_final_price, and the WhatsApp
-- lead Q&A can answer "is this negotiable?" from it instead of the
-- handover line. Whether it SHOULD is a brokerage's call, not a
-- default: for some desks the final rate is exactly what they tell a
-- serious buyer, and for others it is the negotiating position they
-- hold back until a site visit. Quoting it unasked would give away the
-- floor of every deal on the platform.
--
-- So: off unless an account turns it on. The field is still captured,
-- still visible to agents, and still used by nothing else either way.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS share_seller_final_price BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN whatsapp_config.share_seller_final_price IS
  'When true, the WhatsApp lead Q&A may answer a negotiability question with properties.seller_final_price. Off by default.';
