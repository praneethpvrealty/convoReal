-- ============================================================
-- 20260914120200_deal_documents.sql — the deal's document folder.
--
-- A closing runs on paper the Engine has nowhere to put: both parties'
-- Aadhaar and PAN, the agreement draft, the previous sale deed, the EC,
-- the khata. Today they live in someone's WhatsApp thread.
--
-- Deliberately NOT reusing properties.documents: that array is served
-- out of the PUBLIC `property-documents` bucket, where an object URL is
-- the only thing standing between a guess and a customer's Aadhaar.
-- Deal papers go in a PRIVATE bucket reached through an authenticated
-- route that signs a short-lived URL — the pattern `call-recordings`
-- already uses (migration 195).
--
-- `extracted` holds what the AI read out of the file. It is a PROPOSAL
-- an agent applies field by field, never an authority to write, and it
-- never carries a full Aadhaar number — src/lib/invoices/document-extract.ts
-- keeps the last four digits only, so the number stays inside the file
-- and out of every query, backup and log.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Whose document this is, when it belongs to a person rather than the
  -- deal (an Aadhaar does; an agreement draft does not).
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'identity',     -- Aadhaar, PAN, passport
      'agreement',    -- sale agreement, MOU, draft
      'title_deed',   -- previous sale deed, mother deed
      'encumbrance',  -- EC, legal opinion
      'tax_khata',    -- khata, tax paid receipts
      'payment',      -- token receipt, bank transfer proof
      'invoice',      -- a brokerage invoice filed against the deal
      'other'
    )),

  title TEXT NOT NULL,
  -- Bucket-relative ("deal-documents/<account>/<deal>/<file>"), resolved
  -- at the read boundary like every other stored object.
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,

  extracted JSONB,
  extracted_at TIMESTAMPTZ,
  extraction_status TEXT
    CHECK (extraction_status IS NULL OR extraction_status IN ('pending', 'done', 'failed')),
  extraction_error TEXT,

  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_documents_deal
  ON deal_documents (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_documents_account
  ON deal_documents (account_id);
CREATE INDEX IF NOT EXISTS idx_deal_documents_contact
  ON deal_documents (contact_id);

ALTER TABLE deal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_documents_select ON deal_documents;
CREATE POLICY deal_documents_select ON deal_documents FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_documents_modify ON deal_documents;
CREATE POLICY deal_documents_modify ON deal_documents FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON deal_documents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Private buckets.
--
-- public = FALSE on both: every read goes through an authed route that
-- checks account membership and then signs a short-lived URL. Nothing
-- here is ever addressable by URL alone.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-documents',
  'deal-documents',
  FALSE,
  52428800, -- 50 MB, matching DOCUMENT_SIZE_LIMIT
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  FALSE,
  10485760, -- 10 MB; a one-page invoice is a few KB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A scanned signature is forgeable the moment it is public — it is the
-- one image in the product that must never be addressable by URL. It is
-- read server-side when rendering an invoice and is never served to a
-- browser except through the authed settings preview.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signatures',
  'signatures',
  FALSE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN deal_documents.extracted IS
  'AI read-out of the file, proposed to the agent field by field. Never authoritative, and never holds a full Aadhaar number.';
