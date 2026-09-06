BEGIN;
ALTER TABLE public.showcase_settings DROP CONSTRAINT showcase_settings_showcase_style_check;
ALTER TABLE public.showcase_settings ADD CONSTRAINT showcase_settings_showcase_style_check
  CHECK (showcase_style IN ('spotlight', 'editorial', 'gallery', 'signature', 'warm-editorial', 'map-discovery', 'quiet-luxury'));
ALTER TABLE public.profiles DROP CONSTRAINT profiles_showcase_style_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_showcase_style_check
  CHECK (showcase_style IN ('spotlight', 'editorial', 'gallery', 'signature', 'warm-editorial', 'map-discovery', 'quiet-luxury'));
COMMIT;
