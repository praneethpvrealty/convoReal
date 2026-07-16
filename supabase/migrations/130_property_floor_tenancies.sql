-- ============================================================
-- Floor-wise tenancy (rent roll) for pre-leased commercial /
-- industrial buildings under sale. One JSONB array on the
-- property; each element is a floor/unit:
--
--   {
--     "floor": "2nd + 3rd Floor",
--     "area_sqft": 20000,
--     "tenant_name": "Ramada Hospitality",
--     "monthly_rent": 1350000,        -- excluding GST
--     "lease_start": "2024-04-01",
--     "lease_end": "2033-03-31",
--     "lock_in_months": 36,
--     "maintenance": "₹5/sqft, borne by tenant",
--     "notes": "3-Star Hotel · 27 rooms + convention centre"
--   }
--
-- Internal / CRM-only (like properties.notes) — never rendered on
-- the public showcase. Validation lives in
-- src/lib/inventory/floor-tenancies.ts.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS floor_tenancies JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.floor_tenancies IS
  'Floor-wise rent roll for pre-leased commercial buildings: tenant, monthly rent (excluding GST), lease window, lock-in, maintenance per floor. CRM-only.';
