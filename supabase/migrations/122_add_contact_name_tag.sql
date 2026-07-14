-- Name Tag: short internal qualifier shown after the contact's name in the
-- CRM UI (e.g. "Nataraj" + "Bank DSA") for quick recall. Deliberately kept
-- out of the name column so WhatsApp templates, broadcasts, email and other
-- outbound channels — which read contacts.name — never include it.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name_tag TEXT;
