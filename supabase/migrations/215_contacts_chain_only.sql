-- ============================================================
-- Chain-only contacts — reshare registrants are attribution, not
-- leads.
--
-- location-requests.ts already states the principle: "a co-broker's
-- client must not be poachable through their own location request".
-- The reshare path broke it. Whoever holds a forwarded showcase link
-- can mint their own attributed link by entering their name and
-- phone, and that wrote them into the listing account as an ordinary
-- contact — a direct line to a party sitting downstream of the
-- intermediary, which the listing side then messaged on approval.
--
-- The chain still needs them addressable: the consent walk messages
-- each intermediary between seeker and owner. So the row stays, and
-- this flag marks it as existing for the chain alone. Outbound is
-- refused at the dispatcher unless the caller is the chain itself,
-- and they are kept out of the contacts list and broadcast audiences.
--
-- An existing contact who reshares is NOT flagged: they were already
-- a lead of this account by another route, and the reshare does not
-- retract that.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS chain_only BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_chain_only
  ON contacts(account_id) WHERE chain_only = true;

COMMENT ON COLUMN contacts.chain_only IS
  'Contact exists only to carry a reshare-chain attribution (property_reshare_links). Not a lead: excluded from the contacts list and broadcast audiences, and unreachable by outbound except the consent-chain sends that created them.';

-- Backfill: contacts the reshare endpoint created (its own referrer
-- stamp) that are attributed as a child in the chain. Scoped by both
-- conditions so a real lead who merely appears in the chain is left
-- alone.
UPDATE contacts c
SET chain_only = true
WHERE c.referrer = 'Co-broker Reshare'
  AND EXISTS (
    SELECT 1 FROM property_reshare_links r
    WHERE r.contact_id = c.id
      AND r.account_id = c.account_id
      AND r.parent_contact_id IS NOT NULL
  );
