-- Migration 103: Create razorpay_orders table for tracking payment orders
-- This table stores Razorpay order creation and payment status for credit top-ups

CREATE TABLE IF NOT EXISTS razorpay_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'attempted', 'paid', 'failed', 'expired')),
  package_key TEXT NOT NULL,
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by account and order_id
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_account_id ON razorpay_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_order_id ON razorpay_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_status ON razorpay_orders(status);
CREATE INDEX IF NOT EXISTS idx_razorpay_orders_created_at ON razorpay_orders(created_at DESC);

-- RLS policies
ALTER TABLE razorpay_orders ENABLE ROW LEVEL SECURITY;

-- Users can view their own orders
CREATE POLICY "Users can view own razorpay orders"
  ON razorpay_orders FOR SELECT
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

-- Users can insert their own orders
CREATE POLICY "Users can insert own razorpay orders"
  ON razorpay_orders FOR INSERT
  WITH CHECK (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

-- Users can update their own orders
CREATE POLICY "Users can update own razorpay orders"
  ON razorpay_orders FOR UPDATE
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE ON razorpay_orders TO authenticated;
