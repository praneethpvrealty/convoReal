ALTER TABLE public.showcase_settings
  ADD COLUMN IF NOT EXISTS public_business_description TEXT,
  ADD COLUMN IF NOT EXISTS public_areas_served TEXT[],
  ADD COLUMN IF NOT EXISTS public_property_expertise TEXT[];

COMMENT ON COLUMN public.showcase_settings.public_business_description IS
  'Optional account-authored About copy for the public showcase and SEO profile.';
COMMENT ON COLUMN public.showcase_settings.public_areas_served IS
  'Optional account-authored service-area labels. Published inventory supplies the fallback.';
COMMENT ON COLUMN public.showcase_settings.public_property_expertise IS
  'Optional account-authored property expertise labels. Published inventory supplies the fallback.';
