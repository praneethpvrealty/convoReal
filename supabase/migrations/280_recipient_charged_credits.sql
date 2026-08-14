-- ============================================================
-- 279_recipient_charged_credits.sql — refund exactly what was burned.
--
-- A dial attempt's price now depends on the account's voice mode
-- (migration 279): byo accounts pay their own provider, so we charge
-- them for orchestration only. The burn happens in the dispatcher, but
-- two of the three refund paths run elsewhere — the post-call webhook
-- (no_answer / busy) and the stale sweep — and an account that
-- switches mode between the dial and the result would otherwise be
-- refunded a different number of credits than it paid.
--
-- Recording the charge on the attempt makes the refund exact and
-- immune to anything changing in between.
-- ============================================================

ALTER TABLE voice_campaign_recipients
  ADD COLUMN IF NOT EXISTS charged_credits INTEGER;
