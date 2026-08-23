ALTER TABLE public.showcase_settings
  ADD COLUMN IF NOT EXISTS showcase_style TEXT NOT NULL DEFAULT 'gallery',
  ADD COLUMN IF NOT EXISTS showcase_3d_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'showcase_settings_showcase_style_check'
      AND conrelid = 'public.showcase_settings'::regclass
  ) THEN
    ALTER TABLE public.showcase_settings
      ADD CONSTRAINT showcase_settings_showcase_style_check
      CHECK (showcase_style IN ('spotlight', 'editorial', 'gallery', 'signature'));
  END IF;
END $$;

COMMENT ON COLUMN public.showcase_settings.showcase_style IS
  'Presentation preset used by the public company showcase.';
COMMENT ON COLUMN public.showcase_settings.showcase_3d_enabled IS
  'Whether company showcase listings use responsive 3D transitions.';
