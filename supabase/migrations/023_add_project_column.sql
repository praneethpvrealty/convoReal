-- ============================================================
-- 023_add_project_column.sql
-- Adds project name column to properties table
-- ============================================================

ALTER TABLE properties 
  ADD COLUMN IF NOT EXISTS project TEXT;
