-- When the buyer actually gets the keys. DATE rather than TIMESTAMPTZ:
-- a handover is a day, and a day-only column keeps the value free of the
-- timezone shift a timestamp round-trip introduces (see the to-do due
-- date, which stored midnight UTC and opened a day early).
ALTER TABLE properties ADD COLUMN IF NOT EXISTS possession_date DATE;

COMMENT ON COLUMN properties.possession_date IS
  'Possession / handover date. Day granularity; null when not yet known (e.g. under construction with no committed date).';
