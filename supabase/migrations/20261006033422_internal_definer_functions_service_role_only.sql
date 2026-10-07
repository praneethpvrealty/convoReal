REVOKE ALL ON FUNCTION public._bcast_bump(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.bump_copilot_qa_hit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_copilot_qa_hit(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.vote_copilot_qa(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vote_copilot_qa(UUID, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.log_copilot_unmet_request(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_copilot_unmet_request(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sync_contact_budget_band(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_contact_budget_band(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.seed_default_reminder_templates(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_reminder_templates(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.claim_broadcast_dispatch(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_dispatch(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION public.release_broadcast_dispatch(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_broadcast_dispatch(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.renew_broadcast_dispatch(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_broadcast_dispatch(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION public.renew_broadcast_recipient_claims(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_broadcast_recipient_claims(UUID[]) TO service_role;


REVOKE ALL ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) TO service_role;
