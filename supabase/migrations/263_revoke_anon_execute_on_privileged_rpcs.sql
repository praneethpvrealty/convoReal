-- ============================================================
-- 263_revoke_anon_execute_on_privileged_rpcs.sql
--
-- Closes an exploitable hole: twelve SECURITY DEFINER functions that
-- move money, quota or entitlement state were executable by `anon` and
-- `authenticated`, and none of them checks who is calling.
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default,
-- and PostgREST exposes anything in `public` at /rest/v1/rpc/<name>.
-- The anon key is public by design — it ships in the browser bundle —
-- and account UUIDs are discoverable (showcase links carry
-- `?ref=<account_id>`, and NEXT_PUBLIC_DEFAULT_ACCOUNT_ID is in the
-- client environment). So before this migration:
--
--   POST /rest/v1/rpc/purchase_credits_tx
--   { "p_account_id": "<any account>", "p_amount": 1000000, ... }
--
-- minted credits for any workspace, and burn_credits_tx drained one.
-- Both take the account id as a PARAMETER and neither reads auth.uid();
-- being SECURITY DEFINER, they also bypass RLS on credit_wallets and
-- credit_transactions.
--
-- PUBLIC is the role that actually holds the grant. Postgres writes it
-- as `=X/postgres` in proacl, and REVOKE ... FROM anon, authenticated
-- does NOT remove it — those roles inherit through PUBLIC rather than
-- holding a grant of their own. service_role has an explicit
-- `service_role=X` entry on all twelve, verified before running this,
-- so revoking PUBLIC leaves every real caller working.
--
-- REVOKE is the whole fix. Every legitimate caller reaches these
-- through a service-role client (billingAdmin() in src/lib/credits/*,
-- supabaseAdmin() for the cron and the webhook), and the service role
-- bypasses grants entirely — so nothing in the app changes.
--
-- DELIBERATELY NOT REVOKED, having checked each caller:
--   peek_invitation      — /api/invitations/[token]/peek calls it on the
--                          SSR client for the public /join/[token] page,
--                          where the visitor is usually signed OUT.
--   beta_program_public  — /api/beta-invites calls it on ctx.supabase,
--                          i.e. as `authenticated`.
--   is_account_member    — evaluated inside RLS policies as the querying
--                          role. Revoking it would break every policy in
--                          the database.
-- The member/ownership/invitation RPCs (set_member_role,
-- transfer_account_ownership, remove_account_member, handoff_contact,
-- redeem_invitation, issue_beta_invite, ...) are left alone too: they
-- open with auth.uid() and RAISE, so an anonymous call already fails
-- closed. The linter flags them; they are not reachable.
--
-- REVERSIBLE. To undo a single entry:
--   GRANT EXECUTE ON FUNCTION <signature> TO anon, authenticated;
-- ============================================================

-- Credit ledger — mint, burn and refund against any account id.
REVOKE EXECUTE ON FUNCTION public.purchase_credits_tx(
  uuid, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.burn_credits_tx(
  uuid, text, integer, boolean, text
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.refund_credits_tx(
  uuid, text, integer, text
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_subscription_credits_tx(
  uuid, integer, integer, timestamptz
) FROM PUBLIC, anon, authenticated;

-- Referral ledger — the same shape, plus the pending/promote/void
-- lifecycle that decides whether a referral ever pays out.
REVOKE EXECUTE ON FUNCTION public.grant_referral_credits_tx(
  uuid, integer, text, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_pending_referral_tx(
  uuid, integer, uuid, text
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.promote_pending_referral_tx(
  uuid, integer, uuid
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.void_pending_referral_tx(
  uuid, integer, uuid, text
) FROM PUBLIC, anon, authenticated;

-- Billing reconciliation — walks every subscription. Cron-only.
REVOKE EXECUTE ON FUNCTION public.reconcile_subscriptions()
  FROM PUBLIC, anon, authenticated;

-- Marketplace entitlement — provisions paid items into accounts.
-- provision_* has no direct app caller; it is invoked from publish_*,
-- which is SECURITY DEFINER, so that nested call is unaffected.
REVOKE EXECUTE ON FUNCTION public.publish_marketplace_item_to_existing_accounts(
  uuid
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.provision_marketplace_item_for_account(
  uuid, uuid
) FROM PUBLIC, anon, authenticated;

-- Sandbox quota counter — the cap on a shared-number tenant's sends.
REVOKE EXECUTE ON FUNCTION public.increment_sandbox_message_count(
  uuid, integer
) FROM PUBLIC, anon, authenticated;
