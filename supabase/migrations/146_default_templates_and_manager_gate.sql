-- ============================================================
-- 1. Default reminder templates for EVERY account, automatically.
--
--    Migrations 045/129/140 seeded the four appointment-reminder
--    templates only for accounts that existed when each migration
--    ran — an account created afterwards starts with none. This
--    migration extracts the seeding into a reusable function, wires
--    it to an AFTER INSERT trigger on accounts (covering every
--    creation path: signup trigger, phone-match, referral hook, Den
--    bootstrap), and backfills all existing accounts idempotently.
--
--    Bodies are the migration-145 wording (no leading/trailing
--    variables), buttons the migration-144 emoji-free quick replies,
--    sample values 1:1 with each body's variables so every row is
--    submittable from Settings → Templates as-is.
--
-- 2. Template management becomes org_manager-only at the DB level.
--
--    message_templates write policies (017) required 'admin' — rank
--    3, which is_account_member maps to org_leader+ post-082. Product
--    decision: templates are submitted to Meta under the account's
--    one WhatsApp number and affect its quality rating, so only the
--    Organization Manager may create/edit/delete them. Rank 4
--    ('owner') maps exactly to org_manager in is_account_member.
--    SELECT stays member-wide — agents still need to see and send
--    approved templates. The matching API guards live in
--    src/app/api/whatsapp/templates/* (requireOrgRole('org_manager'))
--    and the UI gate in src/components/settings/template-manager.tsx.
-- ============================================================

-- ------------------------------------------------------------
-- Seeding function. SECURITY DEFINER so the accounts trigger can
-- insert regardless of the calling context's RLS. p_user_id falls
-- back to any profile in the account when owner_user_id is null
-- (defensive — shouldn't happen, but message_templates.user_id is
-- NOT NULL so a null would abort account creation via the trigger).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_reminder_templates(
  p_account_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_buttons JSONB :=
    '[{"type":"QUICK_REPLY","text":"Fine"},{"type":"QUICK_REPLY","text":"Requesting reschedule"}]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    SELECT user_id INTO v_user_id
    FROM profiles
    WHERE account_id = p_account_id
    ORDER BY created_at
    LIMIT 1;
  END IF;
  IF v_user_id IS NULL THEN
    RAISE WARNING 'seed_default_reminder_templates: account % has no user to own the rows — skipped', p_account_id;
    RETURN;
  END IF;

  INSERT INTO message_templates
    (user_id, account_id, name, category, language, body_text, buttons, sample_values, status)
  SELECT v_user_id, p_account_id, t.name, 'Utility', 'en_US', t.body_text, v_buttons, t.sample_values, 'DRAFT'
  FROM (VALUES
    (
      'appointment_reminder',
      'Hi {{1}}, this is a friendly reminder from {{5}} that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Please tap a button below to confirm or request a change.',
      '{"body": ["Rahul", "Loan discussion", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase office", "PV Realty"]}'::jsonb
    ),
    (
      'appointment_reminder_agenda',
      'Hi {{1}}, this is a friendly reminder from {{6}} that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Agenda for the meeting: {{5}}. Please tap a button below to confirm or request a change.',
      '{"body": ["Rahul", "Loan discussion", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase office", "Final pricing and loan options", "PV Realty"]}'::jsonb
    ),
    (
      'property_visit_reminder',
      'Hi {{1}}, this is a friendly reminder from {{5}} about your scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Please tap a button below to confirm or request a change.',
      '{"body": ["Rahul", "3BHK in JP Nagar", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase", "PV Realty"]}'::jsonb
    ),
    (
      'property_visit_reminder_agenda',
      'Hi {{1}}, this is a friendly reminder from {{6}} that you have a scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Agenda for the visit: {{5}}. Please tap a button below to confirm or request a change.',
      '{"body": ["Rahul", "3BHK in JP Nagar", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase", "Final pricing and loan options", "PV Realty"]}'::jsonb
    )
  ) AS t(name, body_text, sample_values)
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates m
    WHERE m.account_id = p_account_id AND m.name = t.name
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- ------------------------------------------------------------
-- Trigger: every freshly created account gets the defaults. Never
-- allowed to abort account creation — failures degrade to a WARNING
-- (the account just starts without defaults, same as today).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_account_seed_templates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_reminder_templates(NEW.id, NEW.owner_user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to seed default templates for account %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_seed_default_templates ON accounts;
CREATE TRIGGER trg_accounts_seed_default_templates
  AFTER INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_account_seed_templates();

-- ------------------------------------------------------------
-- Backfill: any existing account missing one or more of the four
-- defaults (created after migration 140 ran, or a fork that skipped
-- it) gets them now. Idempotent — accounts that already have a
-- template with the same name are left untouched.
-- ------------------------------------------------------------
SELECT public.seed_default_reminder_templates(a.id, a.owner_user_id)
FROM accounts a;

-- ------------------------------------------------------------
-- Manager-only writes. 'owner' = rank 4 = org_manager under the
-- post-082 is_account_member mapping. SELECT policy (member-wide)
-- is intentionally unchanged.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
CREATE POLICY message_templates_insert ON message_templates
  FOR INSERT WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS message_templates_update ON message_templates;
CREATE POLICY message_templates_update ON message_templates
  FOR UPDATE USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS message_templates_delete ON message_templates;
CREATE POLICY message_templates_delete ON message_templates
  FOR DELETE USING (is_account_member(account_id, 'owner'));

COMMENT ON FUNCTION public.seed_default_reminder_templates(UUID, UUID) IS
  'Inserts the four default appointment/property-visit reminder templates (DRAFT) for an account, skipping any name the account already has. Called by the accounts AFTER INSERT trigger and by migration backfills.';
