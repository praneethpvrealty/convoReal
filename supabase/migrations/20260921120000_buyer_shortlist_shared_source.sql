-- A listing an agent shares with a buyer from the contact record is
-- saved to that buyer's Portfolio shortlist, so the buyer can manage it
-- from their own account. 'shared' marks those rows apart from the
-- buyer's own saves, ratings and likes.
ALTER TABLE buyer_shortlist_items
  DROP CONSTRAINT IF EXISTS buyer_shortlist_items_source_check;
ALTER TABLE buyer_shortlist_items
  ADD CONSTRAINT buyer_shortlist_items_source_check
  CHECK (source IN ('manual', 'rating', 'like', 'shared'));
