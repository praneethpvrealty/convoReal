DROP POLICY IF EXISTS "Members manage own account portal listings" ON property_portal_listings;

DROP POLICY IF EXISTS property_portal_listings_select ON property_portal_listings;
CREATE POLICY property_portal_listings_select ON property_portal_listings FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS property_portal_listings_insert ON property_portal_listings;
CREATE POLICY property_portal_listings_insert ON property_portal_listings FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS property_portal_listings_update ON property_portal_listings;
CREATE POLICY property_portal_listings_update ON property_portal_listings FOR UPDATE USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS property_portal_listings_delete ON property_portal_listings;
CREATE POLICY property_portal_listings_delete ON property_portal_listings FOR DELETE USING (
  is_account_member(account_id, 'agent')
);
