-- ============================================================
-- 028_add_todos_relations.sql — Add contact and property mentions in To-Dos
-- ============================================================

-- 1. Add contact_id and property_id to todos table
ALTER TABLE todos 
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

-- 2. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_todos_contact ON todos(contact_id);
CREATE INDEX IF NOT EXISTS idx_todos_property ON todos(property_id);
