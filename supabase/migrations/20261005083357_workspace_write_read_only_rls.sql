ALTER POLICY account_api_keys_insert ON account_api_keys
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY account_api_keys_update ON account_api_keys
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY account_invitations_modify ON account_invitations
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'accounts' AND policyname = 'Owners can update own account'
  ) THEN
    ALTER POLICY "Owners can update own account" ON accounts
      USING (EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = auth.uid()
          AND p.account_id = accounts.id
          AND p.account_role = 'owner'
          AND p.is_read_only IS NOT TRUE
      ));
  END IF;
END
$$;

ALTER POLICY accounts_update ON accounts
  USING (is_account_writer(id, 'admin'))
  WITH CHECK (is_account_writer(id, 'admin'));

ALTER POLICY agency_articles_modify ON agency_articles
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY agency_services_modify ON agency_services
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY agent_inventory_digest_log_modify ON agent_inventory_digest_log
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY agent_inventory_digest_settings_modify ON agent_inventory_digest_settings
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY bot_instructions_insert ON bot_instructions
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY bot_instructions_update ON bot_instructions
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY "Members write bot message targets" ON bot_message_targets
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY broadcast_recipients_modify ON broadcast_recipients
  USING (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_writer(b.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_writer(b.account_id, 'agent'))));

ALTER POLICY broadcasts_delete ON broadcasts
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY broadcasts_insert ON broadcasts
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY broadcasts_update ON broadcasts
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY bug_reports_update ON bug_reports
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY buyer_match_digest_log_modify ON buyer_match_digest_log
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY closing_deal_nudges_modify ON closing_deal_nudges
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY call_logs_delete ON contact_call_logs
  USING (is_account_writer(account_id, 'agent') AND (user_id = auth.uid()));

ALTER POLICY call_logs_insert ON contact_call_logs
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY call_logs_update ON contact_call_logs
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_custom_values_modify ON contact_custom_values
  USING (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_writer(c.account_id, 'agent'))));

ALTER POLICY contact_draft_sessions_modify ON contact_draft_sessions
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_duplicate_dismissals_delete ON contact_duplicate_dismissals
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_duplicate_dismissals_insert ON contact_duplicate_dismissals
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_notes_delete ON contact_notes
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_notes_insert ON contact_notes
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_notes_update ON contact_notes
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_parties_modify ON contact_parties
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contact_party_members_modify ON contact_party_members
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_property_inquiries' AND policyname = 'contact_property_inquiries_select'
  ) THEN
    CREATE POLICY contact_property_inquiries_select ON contact_property_inquiries FOR SELECT
      USING ((account_id IS NOT NULL AND is_account_member(account_id))
        OR EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.id = contact_property_inquiries.contact_id
            AND c.user_id = auth.uid()
        ));
  END IF;
END
$$;

ALTER POLICY "Account members can manage contact property inquiries" ON contact_property_inquiries
  USING ((account_id IS NOT NULL) AND is_account_writer(account_id, 'agent'))
  WITH CHECK ((account_id IS NOT NULL) AND is_account_writer(account_id, 'agent'));

ALTER POLICY "Users can manage contact property inquiries" ON contact_property_inquiries
  USING (EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_property_inquiries.contact_id
      AND c.user_id = auth.uid()
      AND is_account_writer(c.account_id, 'agent')
  ));

ALTER POLICY contact_tags_modify ON contact_tags
  USING (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_writer(c.account_id, 'agent'))));

ALTER POLICY contacts_insert ON contacts
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY contacts_update ON contacts
  USING (is_account_writer(account_id, 'agent') AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_coordinator'::org_role_enum]))))) OR (assigned_agent_id = auth.uid()) OR ((assigned_team_id IS NOT NULL) AND (assigned_team_id = ( SELECT p.team_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id))))) OR ((assigned_agent_id IS NULL) AND (assigned_team_id IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_leader'::org_role_enum]))))))));

ALTER POLICY conversation_gaps_insert ON conversation_gaps
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY conversation_gaps_update ON conversation_gaps
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY conversations_delete ON conversations
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY conversations_insert ON conversations
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY conversations_update ON conversations
  USING (is_account_writer(account_id, 'agent') AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_coordinator'::org_role_enum]))))) OR (assigned_agent_id = auth.uid()) OR ((assigned_team_id IS NOT NULL) AND (assigned_team_id = ( SELECT p.team_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id))))) OR ((assigned_agent_id IS NULL) AND (assigned_team_id IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_leader'::org_role_enum]))))))));

ALTER POLICY custom_fields_delete ON custom_fields
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY custom_fields_insert ON custom_fields
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY custom_fields_update ON custom_fields
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY deal_documents_modify ON deal_documents
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_events_insert ON deal_events TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (actor_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_events.deal_id) AND (deals.account_id = deal_events.account_id)))));

ALTER POLICY deal_groups_modify ON deal_groups
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_milestones_modify ON deal_milestones
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_payment_tranches_modify ON deal_payment_tranches
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_share_links_insert ON deal_share_links
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_share_links_update ON deal_share_links
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_stakeholders_modify ON deal_stakeholders
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_update_recipients_insert ON deal_update_recipients
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_update_recipients_update ON deal_update_recipients
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deal_updates_insert ON deal_updates TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (published_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_updates.deal_id) AND (deals.account_id = deal_updates.account_id)))));

ALTER POLICY deals_delete ON deals
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY deals_insert ON deals
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY deals_update ON deals
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY email_sync_configs_delete ON email_sync_configs
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY email_sync_configs_insert ON email_sync_configs
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY email_sync_configs_update ON email_sync_configs
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY email_sync_logs_delete ON email_sync_logs
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY email_sync_logs_insert ON email_sync_logs
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY follow_up_nudges_modify ON follow_up_nudges
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY invoice_events_insert ON invoice_events
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY invoice_settings_modify ON invoice_settings
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY invoices_delete ON invoices
  USING (is_account_writer(account_id, 'agent') AND (status = 'draft'::text));

ALTER POLICY invoices_insert ON invoices
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY invoices_update ON invoices
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents delete journey compartments" ON journey_compartments
  USING (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

ALTER POLICY "Agents insert journey compartments" ON journey_compartments
  WITH CHECK (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

ALTER POLICY "Agents update journey compartments" ON journey_compartments
  USING (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id))
  WITH CHECK (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

ALTER POLICY journey_events_modify ON journey_events
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY journey_items_modify ON journey_items
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY journey_overview_states_delete ON journey_overview_states TO authenticated
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY journey_overview_states_insert ON journey_overview_states TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (((mode = 'buyer'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.contact_id = journey_overview_states.subject_id))))) OR ((mode = 'property'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.property_id = journey_overview_states.subject_id)))))));

ALTER POLICY journey_overview_states_update ON journey_overview_states TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent') AND (((mode = 'buyer'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.contact_id = journey_overview_states.subject_id))))) OR ((mode = 'property'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.property_id = journey_overview_states.subject_id)))))));

ALTER POLICY "Agents delete journey priorities" ON journey_priorities
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents insert journey priorities" ON journey_priorities
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents update journey priorities" ON journey_priorities
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY journey_stage_notes_insert ON journey_stage_notes TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (created_by = ( SELECT auth.uid() AS uid)) AND (NOT (created_by_name IS DISTINCT FROM ( SELECT profiles.full_name
   FROM profiles
  WHERE ((profiles.account_id = journey_stage_notes.account_id) AND (profiles.user_id = ( SELECT auth.uid() AS uid)))
 LIMIT 1))) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.id = journey_stage_notes.item_id) AND (journey_items.account_id = journey_stage_notes.account_id)))) AND (EXISTS ( SELECT 1
   FROM journey_stages
  WHERE ((journey_stages.id = journey_stage_notes.stage_id) AND (journey_stages.account_id = journey_stage_notes.account_id) AND (journey_stages.name = journey_stage_notes.stage_name) AND (NOT (journey_stages.color IS DISTINCT FROM journey_stage_notes.stage_color))))));

ALTER POLICY journey_stages_modify ON journey_stages
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY learned_facts_insert ON learned_facts
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY learned_facts_update ON learned_facts
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY liaison_job_payments_modify ON liaison_job_payments
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY liaison_jobs_modify ON liaison_jobs
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY liaison_workflows_modify ON liaison_workflows
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY liaisons_modify ON liaisons
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY match_events_update ON match_events
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY message_reactions_modify ON message_reactions
  USING (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_writer(c.account_id, 'agent'))));

ALTER POLICY message_templates_delete ON message_templates
  USING (is_account_writer(account_id, 'owner'));

ALTER POLICY message_templates_insert ON message_templates
  WITH CHECK (is_account_writer(account_id, 'owner'));

ALTER POLICY message_templates_update ON message_templates
  USING (is_account_writer(account_id, 'owner'));

ALTER POLICY messages_modify ON messages
  USING (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_writer(c.account_id, 'agent') AND ((EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.user_id = auth.uid()) AND (p.account_id = c.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_coordinator'::org_role_enum]))))) OR (c.assigned_agent_id = auth.uid()) OR ((c.assigned_team_id IS NOT NULL) AND (c.assigned_team_id = ( SELECT p.team_id
           FROM profiles p
          WHERE ((p.user_id = auth.uid()) AND (p.account_id = c.account_id))))) OR ((c.assigned_agent_id IS NULL) AND (c.assigned_team_id IS NULL) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.user_id = auth.uid()) AND (p.account_id = c.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_leader'::org_role_enum]))))))))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_writer(c.account_id, 'agent'))));

ALTER POLICY notification_preferences_write ON notification_preferences
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY occasion_greetings_delete ON occasion_greetings
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY occasion_greetings_insert ON occasion_greetings
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY occasion_greetings_update ON occasion_greetings
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY outreach_followups_modify ON outreach_followups
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY owner_details_request_settings_modify ON owner_details_request_settings
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY owner_digest_log_modify ON owner_digest_log
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY owner_digest_settings_modify ON owner_digest_settings
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY party_suggestion_dismissals_modify ON party_suggestion_dismissals
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY pending_client_replies_modify ON pending_client_replies
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pending_contact_updates' AND policyname = 'pending_contact_updates_modify'
  ) THEN
    ALTER POLICY pending_contact_updates_modify ON pending_contact_updates
      USING (is_account_writer(account_id, 'agent'))
      WITH CHECK (is_account_writer(account_id, 'agent'));
  END IF;
END
$$;

ALTER POLICY pending_map_pins_modify ON pending_map_pins
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY pipeline_stages_modify ON pipeline_stages
  USING (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_writer(p.account_id, 'admin'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_writer(p.account_id, 'admin'))));

ALTER POLICY pipelines_delete ON pipelines
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY pipelines_insert ON pipelines
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY pipelines_update ON pipelines
  USING (is_account_writer(account_id, 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portal_accounts' AND policyname = 'portal_accounts_select'
  ) THEN
    CREATE POLICY portal_accounts_select ON portal_accounts FOR SELECT TO authenticated
      USING (account_id IN ( SELECT p.account_id
       FROM profiles p
      WHERE (p.user_id = auth.uid())));
  END IF;
END
$$;

ALTER POLICY "Members manage own portal accounts" ON portal_accounts TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portal_import_items' AND policyname = 'portal_import_items_select'
  ) THEN
    CREATE POLICY portal_import_items_select ON portal_import_items FOR SELECT TO authenticated
      USING (account_id IN ( SELECT p.account_id
       FROM profiles p
      WHERE (p.user_id = auth.uid())));
  END IF;
END
$$;

ALTER POLICY "Members manage own portal imports" ON portal_import_items TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY projects_modify ON projects
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY properties_modify ON properties
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Authenticated users can update their account doc requests" ON property_document_requests TO authenticated
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY draft_sessions_modify ON property_draft_sessions
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY property_guidance_values_delete ON property_guidance_values
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY location_requests_update ON property_location_requests
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents create own portal listing aliases" ON property_portal_listing_aliases TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents delete own portal listing aliases" ON property_portal_listing_aliases TO authenticated
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents update own portal listing aliases" ON property_portal_listing_aliases TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY property_share_grants_insert ON property_share_grants
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY property_share_grants_update ON property_share_grants
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY property_shares_modify ON property_shares
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Users can insert own razorpay orders" ON razorpay_orders
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Users can update own razorpay orders" ON razorpay_orders
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY requirement_share_links_insert ON requirement_share_links
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY requirement_share_links_update ON requirement_share_links
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY routing_rules_modify ON routing_rules
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY showcase_settings_modify ON showcase_settings
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY showcase_share_links_insert ON showcase_share_links
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY subscriptions_insert ON subscriptions
  WITH CHECK (is_account_writer(account_id, 'owner'));

ALTER POLICY subscriptions_update ON subscriptions
  USING (is_account_writer(account_id, 'owner'))
  WITH CHECK (is_account_writer(account_id, 'owner'));

ALTER POLICY tags_delete ON tags
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY tags_insert ON tags
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY tags_update ON tags
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY teams_delete ON teams
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY teams_insert ON teams
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY teams_update ON teams
  USING (is_account_writer(account_id, 'admin')
    OR (leader_id = auth.uid() AND is_account_writer(account_id, 'agent')));

ALTER POLICY todos_delete ON todos
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY todos_insert ON todos
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY todos_update ON todos
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY update_sessions_modify ON update_sessions
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_agent_config_delete ON voice_agent_config
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY voice_agent_config_insert ON voice_agent_config
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY voice_agent_config_update ON voice_agent_config
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY voice_announcements_delete ON voice_announcements
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_announcements_insert ON voice_announcements
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_announcements_update ON voice_announcements
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaign_recipients_delete ON voice_campaign_recipients
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaign_recipients_insert ON voice_campaign_recipients
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaign_recipients_update ON voice_campaign_recipients
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaigns_delete ON voice_campaigns
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaigns_insert ON voice_campaigns
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY voice_campaigns_update ON voice_campaigns
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY whatsapp_config_delete ON whatsapp_config
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY whatsapp_config_insert ON whatsapp_config
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY whatsapp_config_update ON whatsapp_config
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY "Agents manage their account's participants" ON whatsapp_group_participants
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY "Agents manage their account's groups" ON whatsapp_groups
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY whatsapp_meta_flow_sessions_modify ON whatsapp_meta_flow_sessions
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY whatsapp_meta_flows_modify ON whatsapp_meta_flows
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY number_change_notices_delete ON whatsapp_number_change_notices TO authenticated
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY number_change_notices_insert ON whatsapp_number_change_notices TO authenticated
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY number_change_notices_update ON whatsapp_number_change_notices TO authenticated
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY whatsapp_number_profiles_delete ON whatsapp_number_profiles TO authenticated
  USING (is_account_writer(account_id, 'admin'));

ALTER POLICY whatsapp_number_profiles_insert ON whatsapp_number_profiles TO authenticated
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY whatsapp_number_profiles_update ON whatsapp_number_profiles TO authenticated
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

ALTER POLICY retired_number_replies_delete ON whatsapp_retired_number_replies TO authenticated
  USING (is_account_writer(account_id, 'admin'));
