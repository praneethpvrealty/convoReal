ALTER TABLE public.contact_property_inquiries
  ADD COLUMN IF NOT EXISTS via_portal_link BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.contact_property_inquiries.via_portal_link IS
  'True when the enquiry was created by mapping a portal ad to a listing (POST /api/contacts/[id]/portal-link). unmap_portal_ad removes only these rows, so an enquiry the lead email recorded survives an unmap.';
