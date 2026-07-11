-- Migration 110: Add secondary_phones column to contacts table
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS secondary_phones TEXT[] NOT NULL DEFAULT '{}';
