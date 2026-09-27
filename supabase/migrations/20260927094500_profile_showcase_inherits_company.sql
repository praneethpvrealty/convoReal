ALTER TABLE public.profiles ALTER COLUMN showcase_style DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN showcase_style DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN showcase_3d_enabled DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN showcase_3d_enabled DROP NOT NULL;

COMMENT ON COLUMN public.profiles.showcase_style IS
  'Personal showcase design for this agent''s own links. NULL follows the company design in showcase_settings.';
COMMENT ON COLUMN public.profiles.showcase_3d_enabled IS
  'Personal 3D transition choice. NULL follows the company setting in showcase_settings.';
