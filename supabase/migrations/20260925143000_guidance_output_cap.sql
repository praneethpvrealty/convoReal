-- Gemini reports the tokens a model spent thinking separately from the
-- answer; the call log keeps them so the bill can be reconciled. A page
-- range whose transcription overflows the output cap is read one page at
-- a time on the next queue run.

ALTER TABLE ai_call_log
  ADD COLUMN IF NOT EXISTS thought_tokens INTEGER;

ALTER TABLE guidance_value_sources
  ADD COLUMN IF NOT EXISTS single_pages INTEGER[] NOT NULL DEFAULT '{}';
