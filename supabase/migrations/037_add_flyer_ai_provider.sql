-- Add flyer_ai_provider column to showcase_settings table
ALTER TABLE showcase_settings 
ADD COLUMN IF NOT EXISTS flyer_ai_provider TEXT NOT NULL DEFAULT 'huggingface'
CHECK (flyer_ai_provider IN ('google', 'huggingface'));
