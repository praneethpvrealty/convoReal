-- ============================================================
-- Unit-level buyer preferences: facing, tower and floor range.
--
-- A buyer wrote "I need 1851 sft in Prestige meridian, East facing in
-- tower 10 above 8th to 28 floor". Size, project and area had columns;
-- the facing, the tower and the floors lived only in the requirement
-- text, where matching never reads. These four columns hold them, read
-- deterministically from the requirement text (src/lib/ai/unit-
-- preferences.ts) and compared against properties.facing_direction,
-- properties.tower and properties.floor_number.
--
-- Additive: four nullable columns, no backfill, no behaviour change for
-- a contact that states none of them.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pref_facing TEXT[],
  ADD COLUMN IF NOT EXISTS pref_towers TEXT[],
  ADD COLUMN IF NOT EXISTS pref_floor_min INTEGER,
  ADD COLUMN IF NOT EXISTS pref_floor_max INTEGER;

COMMENT ON COLUMN public.contacts.pref_facing IS
  'Facing directions the buyer wants (East, North-East, ...), read from the requirement text.';
COMMENT ON COLUMN public.contacts.pref_towers IS
  'Towers or wings the buyer wants, as normalised tokens (10, B, 12A).';
COMMENT ON COLUMN public.contacts.pref_floor_min IS
  'Lowest floor the buyer will take (0 = ground), or NULL.';
COMMENT ON COLUMN public.contacts.pref_floor_max IS
  'Highest floor the buyer will take, or NULL.';
