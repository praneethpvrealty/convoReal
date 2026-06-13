-- Add lead_temp column to differentiate HOT/COLD/Not Responding/Dead contacts
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS lead_temp TEXT DEFAULT NULL
  CHECK (lead_temp IN ('HOT', 'COLD', 'Not Responding', 'Dead'));

-- Add last_contacted_at column to track last communication timestamp
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index on lead_temp and last_contacted_at for performance
CREATE INDEX IF NOT EXISTS idx_contacts_lead_temp ON contacts(lead_temp);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted_at ON contacts(last_contacted_at);

-- Backfill last_contacted_at for existing contacts from their messages
UPDATE contacts c
SET last_contacted_at = (
  SELECT MAX(m.created_at)
  FROM messages m
  JOIN conversations conv ON conv.id = m.conversation_id
  WHERE conv.contact_id = c.id
)
WHERE c.last_contacted_at IS NULL;

-- Create trigger function to update contact's last_contacted_at on new messages
CREATE OR REPLACE FUNCTION public.update_contact_last_contacted()
RETURNS TRIGGER AS $$
DECLARE
  v_contact_id UUID;
BEGIN
  SELECT contact_id INTO v_contact_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_contact_id IS NOT NULL THEN
    UPDATE public.contacts
    SET last_contacted_at = NEW.created_at
    WHERE id = v_contact_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS tr_update_contact_last_contacted ON messages;
CREATE TRIGGER tr_update_contact_last_contacted
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contact_last_contacted();
