ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS showcase_style TEXT NOT NULL DEFAULT 'gallery',
  ADD COLUMN IF NOT EXISTS showcase_3d_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_showcase_style_check'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_showcase_style_check
      CHECK (showcase_style IN ('spotlight', 'editorial', 'gallery', 'signature'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.showcase_style IS
  'Presentation preset used by the public personal agent showcase.';
COMMENT ON COLUMN profiles.showcase_3d_enabled IS
  'Whether mobile listing cards use the scroll-linked 3D transition.';
