-- ============================================================
-- Auto-qualify inbound WhatsApp lead replies.
--
-- The lead-sync auto-reply ends with "let me know your requirements
-- and budget", but nothing on the inbound side consumed the answer.
-- A lead replying "Land, 1.5 to 2cr" wrote no requirement text, no
-- pref_* columns and triggered no match — the thread simply stopped.
--
-- src/lib/ai/buyer-qualification.ts now files that reply on the
-- contact and answers it: the next missing qualifier (type -> budget
-- -> location), or the top matching listings once all three are known.
--
-- Off is a real off: accounts that want every lead reply handled by a
-- human set this false and the handler returns before any AI call.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS auto_qualify_leads BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN whatsapp_config.auto_qualify_leads IS
  'When true, an inbound lead reply carrying requirement detail is appended to contacts.requirements, extracted onto the pref_* columns and answered automatically by src/lib/ai/buyer-qualification.ts — the next missing qualifier, or the top matching listings once type, budget and location are known.';
