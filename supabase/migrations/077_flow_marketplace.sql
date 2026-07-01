-- ============================================================
-- 076_flow_marketplace.sql — Admin Flow & Template Marketplace
--
-- Lets a super-admin publish flows or static templates to every
-- account. Published items land in each account as a disabled
-- (status='draft') flow owned by the account owner. Free items can
-- be activated with one click; paid items require a one-time
-- Razorpay checkout.
--
-- Tables:
--   1. marketplace_items         — catalog of publishable items
--   2. marketplace_item_nodes    — snapshot of nodes at publish time
--   3. account_marketplace_items — per-account provisioning + purchase state
--
-- Triggers:
--   - Newly-created accounts automatically receive every published
--     marketplace item as a disabled flow copy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. marketplace_items
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('template', 'flow')),
  -- For templates this is the slug (e.g. 'welcome_menu'); for flows
  -- this is the source flow UUID.
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  entry_node_id TEXT,
  fallback_policy JSONB NOT NULL DEFAULT
    '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  -- Admin can unpublish; existing copies stay, new accounts won't get it.
  published BOOLEAN NOT NULL DEFAULT false,
  -- 0 = free; >0 = one-time purchase price
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON marketplace_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON marketplace_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_marketplace_items_published
  ON marketplace_items(published) WHERE published = true;

ALTER TABLE marketplace_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_items_select ON marketplace_items;
DROP POLICY IF EXISTS marketplace_items_admin_all ON marketplace_items;
-- Any signed-in user can read published items; only super_admin can manage.
CREATE POLICY marketplace_items_select ON marketplace_items FOR SELECT
  USING (published = true OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
  ));
CREATE POLICY marketplace_items_admin_all ON marketplace_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
  ));

-- ============================================================
-- 2. marketplace_item_nodes
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_item_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_item_id UUID NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  UNIQUE (marketplace_item_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_item_nodes_item
  ON marketplace_item_nodes(marketplace_item_id);

ALTER TABLE marketplace_item_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_item_nodes_select ON marketplace_item_nodes;
DROP POLICY IF EXISTS marketplace_item_nodes_admin_all ON marketplace_item_nodes;
CREATE POLICY marketplace_item_nodes_select ON marketplace_item_nodes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM marketplace_items mi
    WHERE mi.id = marketplace_item_nodes.marketplace_item_id
      AND (mi.published = true OR EXISTS (
        SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
      ))
  ));
CREATE POLICY marketplace_item_nodes_admin_all ON marketplace_item_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
  ));

-- ============================================================
-- 3. account_marketplace_items
-- ============================================================
CREATE TABLE IF NOT EXISTS account_marketplace_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  marketplace_item_id UUID NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
  -- provisioned  = account has a disabled draft copy
  -- purchased    = one-time payment received but not yet activated
  -- enabled      = flow is active in the account
  status TEXT NOT NULL DEFAULT 'provisioned'
    CHECK (status IN ('provisioned', 'purchased', 'enabled')),
  -- The copied flow in the target account. NULL only transiently.
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  purchased_at TIMESTAMPTZ,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, marketplace_item_id)
);

DROP TRIGGER IF EXISTS set_updated_at ON account_marketplace_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_marketplace_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_account_marketplace_items_account
  ON account_marketplace_items(account_id);
CREATE INDEX IF NOT EXISTS idx_account_marketplace_items_item
  ON account_marketplace_items(marketplace_item_id);
CREATE INDEX IF NOT EXISTS idx_account_marketplace_items_order
  ON account_marketplace_items(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

ALTER TABLE account_marketplace_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_marketplace_items_select ON account_marketplace_items;
DROP POLICY IF EXISTS account_marketplace_items_service ON account_marketplace_items;
CREATE POLICY account_marketplace_items_select ON account_marketplace_items FOR SELECT
  USING (is_account_member(account_id));
-- Service-role/admin writes happen through admin clients; no direct client DML.
CREATE POLICY account_marketplace_items_service ON account_marketplace_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
  ));

-- ============================================================
-- 4. Helper: provision a marketplace item into a single account
--
-- Creates a disabled flow copy owned by the account owner and
-- records the provisioning in account_marketplace_items. Safe to
-- call repeatedly: it skips accounts that already have a row.
-- ============================================================
CREATE OR REPLACE FUNCTION provision_marketplace_item_for_account(
  p_marketplace_item_id UUID,
  p_account_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item marketplace_items%ROWTYPE;
  v_owner_user_id UUID;
  v_flow_id UUID;
  v_existing UUID;
BEGIN
  -- Idempotency: skip if this account already has this item with a live
  -- flow copy. If the user deleted their copy, re-provision it.
  SELECT id, flow_id INTO v_existing, v_flow_id
  FROM account_marketplace_items
  WHERE account_id = p_account_id AND marketplace_item_id = p_marketplace_item_id
  LIMIT 1;
  IF v_existing IS NOT NULL AND v_flow_id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_item FROM marketplace_items WHERE id = p_marketplace_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Marketplace item not found: %', p_marketplace_item_id;
  END IF;
  IF NOT v_item.published THEN
    RAISE EXCEPTION 'Cannot provision unpublished item: %', p_marketplace_item_id;
  END IF;

  SELECT owner_user_id INTO v_owner_user_id
  FROM accounts
  WHERE id = p_account_id;
  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Account not found: %', p_account_id;
  END IF;

  -- Create the disabled flow copy.
  INSERT INTO flows (
    user_id, account_id, name, description, status,
    trigger_type, trigger_config, entry_node_id, fallback_policy
  ) VALUES (
    v_owner_user_id, p_account_id, v_item.name, v_item.description, 'draft',
    v_item.trigger_type, v_item.trigger_config, v_item.entry_node_id, v_item.fallback_policy
  )
  RETURNING id INTO v_flow_id;

  -- Copy snapshot nodes.
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT v_flow_id, node_key, node_type, config, position_x, position_y
  FROM marketplace_item_nodes
  WHERE marketplace_item_id = p_marketplace_item_id;

  -- Record or restore provisioning.
  IF v_existing IS NULL THEN
    INSERT INTO account_marketplace_items (
      account_id, marketplace_item_id, status, flow_id
    ) VALUES (
      p_account_id, p_marketplace_item_id, 'provisioned', v_flow_id
    )
    RETURNING id INTO v_existing;
  ELSE
    UPDATE account_marketplace_items
    SET flow_id = v_flow_id, status = 'provisioned'
    WHERE id = v_existing;
  END IF;

  RETURN v_existing;
END;
$$;

ALTER FUNCTION provision_marketplace_item_for_account(UUID, UUID) OWNER TO postgres;

-- ============================================================
-- 5. Trigger: new accounts receive all published marketplace items
-- ============================================================
CREATE OR REPLACE FUNCTION provision_published_items_for_new_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
BEGIN
  FOR v_item_id IN
    SELECT id FROM marketplace_items WHERE published = true
  LOOP
    BEGIN
      PERFORM provision_marketplace_item_for_account(v_item_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Don't let a marketplace provisioning bug block account creation.
      RAISE WARNING 'Failed to provision marketplace item % for account %: %', v_item_id, NEW.id, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION provision_published_items_for_new_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_provision_published_items_for_new_account ON accounts;
CREATE TRIGGER trg_provision_published_items_for_new_account
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION provision_published_items_for_new_account();

-- ============================================================
-- 6. Helper: distribute a newly-published item to existing accounts
--
-- Called from the admin publish API after flipping published=true.
-- ============================================================
CREATE OR REPLACE FUNCTION publish_marketplace_item_to_existing_accounts(
  p_marketplace_item_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  FOR v_account_id IN
    SELECT id FROM accounts
  LOOP
    PERFORM provision_marketplace_item_for_account(p_marketplace_item_id, v_account_id);
  END LOOP;
END;
$$;

ALTER FUNCTION publish_marketplace_item_to_existing_accounts(UUID) OWNER TO postgres;
