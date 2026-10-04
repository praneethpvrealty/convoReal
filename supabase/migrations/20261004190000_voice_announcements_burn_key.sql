ALTER TABLE public.voice_announcements
  ADD COLUMN IF NOT EXISTS burn_key text;
