-- ============================================================
-- 20261128043149_inventory_overview.sql
--
-- The inventory page opened with three RPCs side by side:
-- inventory_stats for the summary tiles, inventory_attention_counts
-- for the Needs attention tile and inventory_source_breakdown for the
-- tab and listing-party pills. Each is its own request with its own
-- auth and membership check. Return all three in one call, in exactly
-- the shapes the three functions return, so the page header is one
-- round trip. The functions themselves are unchanged and stay the
-- single definition of each count; this only composes them.
--
-- SECURITY INVOKER: every composed function is SECURITY DEFINER and
-- guards itself with is_account_member(), and the wrapper repeats the
-- guard so a non-member gets NULL rather than three empty shapes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_overview(p_account_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_account_member(p_account_id) THEN
      jsonb_build_object(
        'stats',
        (SELECT to_jsonb(s) FROM public.inventory_stats(p_account_id) s),
        'attention',
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(a))
            FROM public.inventory_attention_counts(p_account_id) a
          ),
          '[]'::jsonb
        ),
        'source_breakdown',
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(b))
            FROM public.inventory_source_breakdown(p_account_id) b
          ),
          '[]'::jsonb
        )
      )
  END;
$$;

COMMENT ON FUNCTION public.inventory_overview(UUID) IS
  'inventory_stats, inventory_attention_counts and inventory_source_breakdown for one account in a single call, for the inventory page header.';

REVOKE ALL ON FUNCTION public.inventory_overview(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_overview(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_overview(UUID) TO authenticated;
