CREATE INDEX IF NOT EXISTS idx_portal_expiry_reminder_log_user
  ON public.portal_listing_expiry_reminder_log (user_id, created_at DESC);
