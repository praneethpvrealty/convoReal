-- ============================================================
-- 052_performance_indexes_and_messages_account.sql
-- Performance indexes for 10k accounts scale + messages.account_id
-- ============================================================

-- 1. Add account_id to messages table (enables dashboard RPCs without join)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

-- Backfill account_id from conversations
UPDATE messages m
SET account_id = c.account_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.account_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE messages ALTER COLUMN account_id SET NOT NULL;

-- 2. Composite indexes for query patterns

-- Properties: inventory list + public API filters
CREATE INDEX IF NOT EXISTS idx_properties_account_published_status_created 
  ON properties(account_id, is_published, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_account_type 
  ON properties(account_id, type);
CREATE INDEX IF NOT EXISTS idx_properties_account_status 
  ON properties(account_id, status);
CREATE INDEX IF NOT EXISTS idx_properties_account_price 
  ON properties(account_id, price);
CREATE INDEX IF NOT EXISTS idx_properties_account_listing_source 
  ON properties(account_id, listing_source);

-- Contacts: contacts page filters
CREATE INDEX IF NOT EXISTS idx_contacts_account_status_created 
  ON contacts(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_account_classification 
  ON contacts(account_id, classification);
-- GIN index for array column areas_of_interest
CREATE INDEX IF NOT EXISTS idx_contacts_areas_gin 
  ON contacts USING GIN (areas_of_interest);
-- Normalized phone for webhook lookups
CREATE INDEX IF NOT EXISTS idx_contacts_account_phone_norm 
  ON contacts(account_id, regexp_replace(phone, '\D', '', 'g'));

-- Conversations: inbox list
CREATE INDEX IF NOT EXISTS idx_conversations_account_status_lastmsg 
  ON conversations(account_id, status, last_message_at DESC);

-- Messages: dashboard RPCs (requires account_id column above)
CREATE INDEX IF NOT EXISTS idx_messages_account_sender_created 
  ON messages(account_id, sender_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_created 
  ON messages(account_id, conversation_id, created_at DESC);

-- Contact tags: tag filter on contacts page
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_contact 
  ON contact_tags(tag_id, contact_id);

-- Broadcast recipients: status queries
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status 
  ON broadcast_recipients(broadcast_id, status);

-- 3. Update trigger to maintain messages.account_id on conversation changes
-- (conversation.account_id shouldn't change, but defensive)
CREATE OR REPLACE FUNCTION sync_message_account_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.account_id := (
      SELECT account_id FROM conversations WHERE id = NEW.conversation_id
    );
    RETURN NEW;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trigger_sync_message_account_id ON messages;
CREATE TRIGGER trigger_sync_message_account_id
BEFORE INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION sync_message_account_id();