-- 20261128040725_contacts_listable.sql
-- The Contacts list's base rows in one call on web and mobile: the
-- account's contacts less merged records, chain-only attributions and
-- the team's own numbers. SECURITY INVOKER with no SET clause, so it is
-- inlined into the caller's query and RLS on contacts and profiles
-- applies exactly as it does to a direct read.

CREATE FUNCTION public.contacts_listable(p_account_id UUID)
RETURNS SETOF public.contacts
LANGUAGE sql
STABLE
AS $$
  SELECT c.*
  FROM public.contacts c
  WHERE c.account_id = p_account_id
    AND c.is_merged = false
    AND c.chain_only = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.account_id = p_account_id
        AND length(regexp_replace(pr.phone, '\D', '', 'g')) >= 8
        AND right(regexp_replace(pr.phone, '\D', '', 'g'), 8)
          = right(regexp_replace(c.phone, '\D', '', 'g'), 8)
    );
$$;

COMMENT ON FUNCTION public.contacts_listable(UUID) IS
  'Base rows of the Contacts list for one account: no merged or chain-only contacts and none of the team''s own numbers (last eight digits of a profile phone, the contacts_tab_counts rule). PostgREST filters, ordering, paging and embeds apply on top.';

REVOKE ALL ON FUNCTION public.contacts_listable(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_listable(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.contacts_listable(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_listable(UUID) TO service_role;
