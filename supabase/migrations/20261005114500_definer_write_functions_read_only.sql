CREATE OR REPLACE FUNCTION public.allocate_invoice_number(
  p_account_id UUID,
  p_financial_year TEXT
)
RETURNS TABLE (sequence_number INTEGER, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings invoice_settings%ROWTYPE;
  v_prefix TEXT;
  v_start INTEGER;
  v_resets BOOLEAN;
  v_next INTEGER;
BEGIN
  IF NOT is_account_writer(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Not authorised to issue invoices for this account';
  END IF;

  IF p_financial_year IS NULL OR p_financial_year !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid financial year: %', p_financial_year;
  END IF;

  SELECT * INTO v_settings
  FROM invoice_settings
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO invoice_settings (account_id)
    VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT * INTO v_settings
    FROM invoice_settings
    WHERE account_id = p_account_id
    FOR UPDATE;
  END IF;

  v_prefix := COALESCE(v_settings.number_prefix, '');
  v_start := COALESCE(v_settings.starting_number, 1);
  v_resets := COALESCE(v_settings.number_resets_yearly, TRUE);

  IF v_resets THEN
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = p_account_id
      AND i.financial_year = p_financial_year;
  ELSE
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = p_account_id;
  END IF;

  sequence_number := v_next;
  invoice_number := CASE
    WHEN v_prefix = '' THEN v_next || '/' || p_financial_year
    ELSE v_prefix || '/' || v_next || '/' || p_financial_year
  END;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.deal_invoice_append(p_deal_id UUID, p_entry JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_invoices JSONB;
BEGIN
  SELECT account_id INTO v_account_id FROM deals WHERE id = p_deal_id;
  IF v_account_id IS NULL OR NOT is_account_writer(v_account_id, 'agent') THEN
    RETURN NULL;
  END IF;

  UPDATE deals
     SET invoices = COALESCE(invoices, '[]'::jsonb) || jsonb_build_array(p_entry)
   WHERE id = p_deal_id
  RETURNING invoices INTO v_invoices;

  RETURN v_invoices;
END;
$$;

CREATE OR REPLACE FUNCTION public.deal_invoice_remove(p_deal_id UUID, p_path TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_invoices JSONB;
BEGIN
  SELECT account_id INTO v_account_id FROM deals WHERE id = p_deal_id;
  IF v_account_id IS NULL OR NOT is_account_writer(v_account_id, 'agent') THEN
    RETURN NULL;
  END IF;

  UPDATE deals
     SET invoices = COALESCE(
           (
             SELECT jsonb_agg(entry)
               FROM jsonb_array_elements(COALESCE(invoices, '[]'::jsonb)) AS entry
              WHERE entry->>'path' IS DISTINCT FROM p_path
           ),
           '[]'::jsonb
         )
   WHERE id = p_deal_id
  RETURNING invoices INTO v_invoices;

  RETURN v_invoices;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_invoice(
  p_invoice_id UUID,
  p_signed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_settings invoice_settings%ROWTYPE;
  v_financial_year TEXT;
  v_prefix TEXT;
  v_start INTEGER;
  v_resets BOOLEAN;
  v_next INTEGER;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_account_writer(v_invoice.account_id, 'agent') THEN
    RAISE EXCEPTION 'Not authorised to issue invoices for this account';
  END IF;

  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'This invoice is already %', v_invoice.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_financial_year :=
    CASE
      WHEN EXTRACT(MONTH FROM v_invoice.invoice_date) >= 4
        THEN EXTRACT(YEAR FROM v_invoice.invoice_date)::int
      ELSE EXTRACT(YEAR FROM v_invoice.invoice_date)::int - 1
    END::text
    || '-'
    || LPAD(
         ((CASE
             WHEN EXTRACT(MONTH FROM v_invoice.invoice_date) >= 4
               THEN EXTRACT(YEAR FROM v_invoice.invoice_date)::int + 1
             ELSE EXTRACT(YEAR FROM v_invoice.invoice_date)::int
           END) % 100)::text,
         2, '0'
       );

  SELECT * INTO v_settings
  FROM invoice_settings
  WHERE account_id = v_invoice.account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO invoice_settings (account_id)
    VALUES (v_invoice.account_id)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT * INTO v_settings
    FROM invoice_settings
    WHERE account_id = v_invoice.account_id
    FOR UPDATE;
  END IF;

  v_prefix := COALESCE(v_settings.number_prefix, '');
  v_start := COALESCE(v_settings.starting_number, 1);
  v_resets := COALESCE(v_settings.number_resets_yearly, TRUE);

  IF v_resets THEN
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = v_invoice.account_id
      AND i.financial_year = v_financial_year;
  ELSE
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = v_invoice.account_id;
  END IF;

  UPDATE invoices
  SET status = 'issued',
      sequence_number = v_next,
      financial_year = v_financial_year,
      invoice_number = CASE
        WHEN v_prefix = '' THEN v_next || '/' || v_financial_year
        ELSE v_prefix || '/' || v_next || '/' || v_financial_year
      END,
      issued_at = NOW(),
      signed_at = p_signed_at
  WHERE id = p_invoice_id
    AND status = 'draft'
  RETURNING * INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invoice was issued by someone else'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.journey_show_captured(
  p_account_id UUID,
  p_item_ids UUID[]
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_item_ids IS NULL
     OR cardinality(p_item_ids) = 0
     OR NOT is_account_writer(p_account_id, 'agent') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shown AS (
    UPDATE journey_items
    SET hidden = FALSE
    WHERE account_id = p_account_id
      AND hidden
      AND id = ANY(p_item_ids)
    RETURNING id, stage_id
  ),
  logged AS (
    INSERT INTO journey_events (
      account_id, item_id, event_type, from_stage_id, to_stage_id, created_by
    )
    SELECT p_account_id, shown.id, 'unhidden', shown.stage_id, shown.stage_id,
           (SELECT auth.uid())
    FROM shown
    RETURNING item_id
  )
  SELECT item_id FROM logged;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_listing_status_from_deals(
  p_account_id UUID,
  p_property_id UUID,
  p_requested TEXT
)
RETURNS TABLE (previous_status TEXT, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous TEXT;
  v_held INTEGER;
  v_target TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT is_account_writer(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not an agent on this account' USING ERRCODE = '42501';
  END IF;
  IF p_requested NOT IN ('Available', 'Under Contract', 'Sold') THEN
    RAISE EXCEPTION 'unsupported listing status %', p_requested
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_previous
  FROM properties
  WHERE id = p_property_id AND account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(
    CASE
      WHEN d.status = 'won' THEN 2
      WHEN s.stage_type = 'lost' THEN 0
      WHEN s.stage_type IN ('won', 'brokerage_pending', 'brokerage_paid') THEN 2
      WHEN s.stage_type = 'committed' THEN 1
      ELSE 0
    END
  ), 0)
  INTO v_held
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  WHERE d.account_id = p_account_id
    AND d.property_id = p_property_id
    AND d.status IN ('open', 'won');

  v_target := CASE v_held
    WHEN 2 THEN 'Sold'
    WHEN 1 THEN 'Under Contract'
    ELSE 'Available'
  END;

  UPDATE properties
  SET status = v_target
  WHERE id = p_property_id AND account_id = p_account_id;

  RETURN QUERY SELECT v_previous, v_target;
END;
$$;

CREATE OR REPLACE FUNCTION public.resync_pipeline_stage_deals(p_stage_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
  v_type TEXT;
  v_status TEXT;
  v_count INTEGER := 0;
  v_prop RECORD;
BEGIN
  SELECT p.account_id, s.stage_type
    INTO v_account, v_type
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_stage_id;
  IF v_account IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT is_account_writer(v_account, 'admin') THEN
    RAISE EXCEPTION 'not an admin on this account' USING ERRCODE = '42501';
  END IF;

  v_status := CASE
    WHEN v_type = 'lost' THEN 'lost'
    WHEN v_type IN ('won', 'brokerage_pending', 'brokerage_paid') THEN 'won'
    ELSE 'open'
  END;

  UPDATE deals
    SET status = v_status
    WHERE stage_id = p_stage_id
      AND account_id = v_account
      AND status IS DISTINCT FROM v_status;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  FOR v_prop IN
    SELECT DISTINCT property_id
      FROM deals
      WHERE stage_id = p_stage_id
        AND account_id = v_account
        AND property_id IS NOT NULL
  LOOP
    PERFORM sync_listing_status_from_deals(v_account, v_prop.property_id, 'Available');
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_beta_invite(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv beta_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM beta_invites WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.issued_by_account_id IS NULL
     OR NOT is_account_writer(v_inv.issued_by_account_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'This invitation has already been claimed'
      USING ERRCODE = '22023';
  END IF;

  UPDATE beta_invites SET status = 'revoked' WHERE id = p_id;

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_beta_invite(
  p_id UUID,
  p_token_hash TEXT,
  p_code TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv public.beta_invites%ROWTYPE;
  v_ttl_days SMALLINT;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_code !~ '^CONVO-[23456789BCDFGHJKMNPQRSTVWXYZ]{4}$' THEN
    RAISE EXCEPTION 'Invalid invitation credentials' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.beta_invites
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.issued_by_account_id IS NULL
     OR NOT public.is_account_writer(v_inv.issued_by_account_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending invitation can be resent'
      USING ERRCODE = '22023';
  END IF;

  SELECT invite_ttl_days INTO v_ttl_days
  FROM public.beta_program
  WHERE id AND issuance_open
  FOR UPDATE;

  IF v_ttl_days IS NULL THEN
    RAISE EXCEPTION 'Beta invitations are closed' USING ERRCODE = '22023';
  END IF;

  v_expires := NOW() + (v_ttl_days || ' days')::INTERVAL;

  UPDATE public.beta_invites
  SET token_hash = p_token_hash,
      code = p_code,
      issued_by_user_id = v_caller,
      expires_at = v_expires
  WHERE id = p_id;

  RETURN json_build_object(
    'ok', true,
    'id', v_inv.id,
    'code', p_code,
    'label', v_inv.label,
    'invitee_phone', v_inv.invitee_phone,
    'expires_at', v_expires
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unmap_portal_ad(
  p_account_id UUID,
  p_portal TEXT,
  p_portal_listing_id TEXT
)
RETURNS TABLE (property_id UUID, untagged_contacts BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_untagged BIGINT;
BEGIN
  IF NOT is_account_writer(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not a member of this account'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM property_portal_listing_aliases ppla
    WHERE ppla.account_id = p_account_id
      AND ppla.portal = p_portal
      AND ppla.portal_listing_id = p_portal_listing_id
    RETURNING ppla.property_id INTO v_property_id;

  IF v_property_id IS NULL THEN
    UPDATE property_portal_listings ppl
      SET portal_listing_id = NULL
      WHERE ppl.account_id = p_account_id
        AND ppl.portal = p_portal
        AND ppl.portal_listing_id = p_portal_listing_id
      RETURNING ppl.property_id INTO v_property_id;
  END IF;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM contact_property_inquiries cpi
    WHERE cpi.property_id = v_property_id
      AND cpi.via_portal_link
      AND EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.id = cpi.contact_id
          AND c.account_id = p_account_id
          AND c.lead_portal = p_portal
          AND c.lead_portal_listing_id = p_portal_listing_id
          AND c.last_inquired_property_id = v_property_id
      );

  WITH cleared AS (
    UPDATE contacts c
      SET last_inquired_property_id = NULL,
          updated_at = NOW()
      WHERE c.account_id = p_account_id
        AND c.lead_portal = p_portal
        AND c.lead_portal_listing_id = p_portal_listing_id
        AND c.last_inquired_property_id = v_property_id
      RETURNING c.id
  )
  SELECT count(*) INTO v_untagged FROM cleared;

  RETURN QUERY SELECT v_property_id, v_untagged;
END;
$$;
