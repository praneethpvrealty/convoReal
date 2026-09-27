ALTER TABLE public.profiles ALTER COLUMN showcase_style DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN showcase_style DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN showcase_3d_enabled DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN showcase_3d_enabled DROP NOT NULL;

COMMENT ON COLUMN public.profiles.showcase_style IS
  'Personal showcase design for this agent''s own links. NULL follows the company design in showcase_settings.';
COMMENT ON COLUMN public.profiles.showcase_3d_enabled IS
  'Personal 3D transition choice. NULL follows the company setting in showcase_settings.';

CREATE OR REPLACE FUNCTION public.reset_profile_showcase_on_account_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.showcase_style := NULL;
  NEW.showcase_3d_enabled := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_showcase_follows_new_account ON public.profiles;
CREATE TRIGGER profiles_showcase_follows_new_account
  BEFORE UPDATE OF account_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id)
  EXECUTE FUNCTION public.reset_profile_showcase_on_account_change();
