-- ============================================================
-- 087_credit_packages.sql — Top-up package catalogue
--
-- Two tables instead of the design doc's single `credit_packages`
-- with a `price_inr` column: the dual-gateway requirement (Razorpay
-- INR + Stripe USD/GBP/EUR/AED/SGD/AUD) needs N prices per package,
-- so pricing is split into its own per-currency table.
--
-- amount_minor is in the smallest currency unit (paise for INR,
-- cents for USD/EUR/etc, fils for AED) — same convention already
-- used by createRazorpayOrder()'s `amountCents` parameter.
--
-- Source design: ConvoReal-Engineering-OS/CREDIT_UI_DESIGN.md §3b
-- PLACEHOLDER PRICING: SGD/AUD figures are not in the source design
-- doc (which only prices INR/USD/GBP/EUR/AED) — extrapolated here at
-- roughly the same USD ratio. Flag for a pricing owner to confirm
-- before launch; safe to UPDATE credit_package_prices.amount_minor
-- later without a new migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,          -- 'starter' | 'standard' | 'pro' | 'power'
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON credit_packages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON credit_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS credit_package_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES credit_packages(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('INR','USD','GBP','EUR','AED','SGD','AUD')),
  gateway TEXT NOT NULL CHECK (gateway IN ('razorpay','stripe')),
  amount_minor INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  UNIQUE(package_id, currency)
);

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_package_prices ENABLE ROW LEVEL SECURITY;

-- Reference data, not account-owned — any authenticated user can read
-- (needed to render the top-up grid before any account context matters).
DROP POLICY IF EXISTS credit_packages_select ON credit_packages;
CREATE POLICY credit_packages_select ON credit_packages FOR SELECT
  TO authenticated USING (is_active);
DROP POLICY IF EXISTS credit_package_prices_select ON credit_package_prices;
CREATE POLICY credit_package_prices_select ON credit_package_prices FOR SELECT
  TO authenticated USING (is_active);

CREATE INDEX IF NOT EXISTS idx_credit_package_prices_package ON credit_package_prices(package_id);

-- ============================================================
-- Seed: 4 packages
-- ============================================================
INSERT INTO credit_packages (key, name, credits, display_order) VALUES
  ('starter',  'Starter Pack',  1000,  1),
  ('standard', 'Standard Pack', 2500,  2),
  ('pro',      'Pro Pack',      7000,  3),
  ('power',    'Power Pack',    16000, 4)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Seed: 4 packages x 7 currencies = 28 price rows
-- ============================================================
INSERT INTO credit_package_prices (package_id, currency, gateway, amount_minor)
SELECT p.id, v.currency, v.gateway, v.amount_minor
FROM credit_packages p
JOIN (VALUES
  ('starter',  'INR', 'razorpay', 9900),   ('starter',  'USD', 'stripe', 119),  ('starter',  'GBP', 'stripe', 94),
  ('starter',  'EUR', 'stripe', 110),      ('starter',  'AED', 'stripe', 436),  ('starter',  'SGD', 'stripe', 160),
  ('starter',  'AUD', 'stripe', 180),
  ('standard', 'INR', 'razorpay', 19900),  ('standard', 'USD', 'stripe', 239),  ('standard', 'GBP', 'stripe', 189),
  ('standard', 'EUR', 'stripe', 220),      ('standard', 'AED', 'stripe', 875),  ('standard', 'SGD', 'stripe', 320),
  ('standard', 'AUD', 'stripe', 360),
  ('pro',      'INR', 'razorpay', 49900),  ('pro',      'USD', 'stripe', 599),  ('pro',      'GBP', 'stripe', 475),
  ('pro',      'EUR', 'stripe', 550),      ('pro',      'AED', 'stripe', 2199), ('pro',      'SGD', 'stripe', 810),
  ('pro',      'AUD', 'stripe', 900),
  ('power',    'INR', 'razorpay', 99900),  ('power',    'USD', 'stripe', 1199), ('power',    'GBP', 'stripe', 949),
  ('power',    'EUR', 'stripe', 1099),     ('power',    'AED', 'stripe', 4399), ('power',    'SGD', 'stripe', 1620),
  ('power',    'AUD', 'stripe', 1800)
) AS v(key, currency, gateway, amount_minor) ON v.key = p.key
ON CONFLICT (package_id, currency) DO NOTHING;
