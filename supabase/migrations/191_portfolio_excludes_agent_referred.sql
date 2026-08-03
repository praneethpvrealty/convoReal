-- ============================================================
-- 191_portfolio_excludes_agent_referred.sql — the owner Portfolio
-- shows owner-direct listings only.
--
-- properties.owner_contact_id is OVERLOADED (convention documented
-- in src/lib/agents/inventory-digest.ts): for listing_source
-- 'owner' / 'whatsapp_lister' / 'web_lister' it points at the
-- owner's contact card, but for 'agent' it points at the REFERRING
-- AGENT's card — the true owner is that agent's client and unknown
-- to the tenant.
--
-- find_den_owner_contacts() ignored that distinction, so a
-- co-broking agent whose card sits in owner_contact_id of a
-- referred listing linked into the owner Portfolio and saw that
-- listing presented as a property they own — offers included.
--
-- Decision (product): agent-referred listings are handled in the
-- Engine, by the tenant that holds them. The Portfolio's owner side
-- is for actual owners. So the EXISTS arm now requires
-- listing_source <> 'agent'.
--
-- The classification arm is unchanged on purpose: a contact filed
-- as Owner/Seller still links even with zero properties (they get
-- an empty Portfolio, which is correct — they ARE an owner).
--
-- This function is the linking gate, not the whole fix. One card
-- can be owner_contact_id on BOTH an owner-direct listing and an
-- agent-referred one; such a card still links (correctly, via the
-- owner-direct listing), so every den property query also excludes
-- listing_source = 'agent' in code — resolveOwnerPropertyIds(),
-- loadOwnedProperty(), the den list/dashboard routes, and the
-- owner WhatsApp digest (referring agents have their own digest:
-- the agent inventory digest).
--
-- Idempotent — CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_den_owner_contacts(p_phone_last10 TEXT)
RETURNS TABLE (contact_id UUID, account_id UUID, contact_name TEXT, classification TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.account_id, c.name, c.classification
  FROM contacts c
  WHERE p_phone_last10 <> ''
    AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = p_phone_last10
    AND (
      c.classification IN ('Owner', 'Seller', 'Owner & Buyer')
      OR EXISTS (
        SELECT 1 FROM properties p
        WHERE p.owner_contact_id = c.id
          AND p.listing_source <> 'agent'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.find_den_owner_contacts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_den_owner_contacts(TEXT) FROM anon, authenticated;

COMMENT ON FUNCTION public.find_den_owner_contacts(TEXT) IS
  'Links a Portfolio (den) login to owner-ish contact cards by phone. Agent-referred listings (listing_source = ''agent'') no longer qualify a card — owner_contact_id holds the referring agent there, not an owner. See migration 191.';
