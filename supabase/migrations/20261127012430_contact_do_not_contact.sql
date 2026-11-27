-- An agent's standing instruction that nobody at the brokerage messages
-- or calls this person: an owner who deals only through one partner, a
-- relative, a contact who asked off-channel never to be messaged.
--
-- Not the same as is_dead (migration 230). A dead lead is out of
-- matching and still answerable by hand; a do-not-contact person stays
-- a live record — their listings keep marketing, their brief keeps
-- matching — and nothing at all is sent to them, the inbox composer
-- included. Every WhatsApp send is refused in the dispatcher, the bot
-- stays silent on their inbound messages, and voice calls skip them.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact_at TIMESTAMPTZ;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT;

COMMENT ON COLUMN public.contacts.do_not_contact IS
  'Set by an agent. Refuses every outbound WhatsApp message (inbox replies included), bot replies and voice calls to this contact. Matching and listings are unaffected.';

CREATE INDEX IF NOT EXISTS idx_contacts_account_do_not_contact
  ON public.contacts(account_id)
  WHERE do_not_contact;
