-- Public profile wording is an account-level brand decision. The existing
-- showcase_settings policy intentionally lets agents maintain other showcase
-- fields, so enforce admin-only access narrowly when these three columns
-- change instead of tightening the policy for the entire row.

CREATE FUNCTION public.enforce_showcase_public_profile_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  profile_changed boolean;
BEGIN
  profile_changed := CASE
    WHEN TG_OP = 'INSERT' THEN
      NEW.public_business_description IS NOT NULL
      OR NEW.public_areas_served IS NOT NULL
      OR NEW.public_property_expertise IS NOT NULL
    ELSE
      NEW.public_business_description IS DISTINCT FROM OLD.public_business_description
      OR NEW.public_areas_served IS DISTINCT FROM OLD.public_areas_served
      OR NEW.public_property_expertise IS DISTINCT FROM OLD.public_property_expertise
  END;

  IF profile_changed
     AND NOT public.is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only account admins can update the public business profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_showcase_public_profile_admin
BEFORE INSERT OR UPDATE ON public.showcase_settings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_showcase_public_profile_admin();

COMMENT ON FUNCTION public.enforce_showcase_public_profile_admin() IS
  'Blocks non-admin changes to account-authored public profile fields while preserving agent writes to unrelated showcase settings.';
