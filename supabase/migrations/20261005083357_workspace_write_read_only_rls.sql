DROP POLICY IF EXISTS account_api_keys_insert ON account_api_keys;
CREATE POLICY account_api_keys_insert ON account_api_keys FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS account_api_keys_update ON account_api_keys;
CREATE POLICY account_api_keys_update ON account_api_keys FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS account_invitations_modify ON account_invitations;
CREATE POLICY account_invitations_modify ON account_invitations FOR ALL
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS "Owners can update own account" ON accounts;
CREATE POLICY "Owners can update own account" ON accounts FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = accounts.id
      AND p.account_role = 'owner'
      AND p.is_read_only IS NOT TRUE
  ));

DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_writer(id, 'admin'))
  WITH CHECK (is_account_writer(id, 'admin'));

DROP POLICY IF EXISTS agency_articles_modify ON agency_articles;
CREATE POLICY agency_articles_modify ON agency_articles FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS agency_services_modify ON agency_services;
CREATE POLICY agency_services_modify ON agency_services FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS agent_inventory_digest_log_modify ON agent_inventory_digest_log;
CREATE POLICY agent_inventory_digest_log_modify ON agent_inventory_digest_log FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS agent_inventory_digest_settings_modify ON agent_inventory_digest_settings;
CREATE POLICY agent_inventory_digest_settings_modify ON agent_inventory_digest_settings FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS bot_instructions_insert ON bot_instructions;
CREATE POLICY bot_instructions_insert ON bot_instructions FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS bot_instructions_update ON bot_instructions;
CREATE POLICY bot_instructions_update ON bot_instructions FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS "Members write bot message targets" ON bot_message_targets;
CREATE POLICY "Members write bot message targets" ON bot_message_targets FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL
  USING (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_writer(b.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_writer(b.account_id, 'agent'))));

DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS bug_reports_update ON bug_reports;
CREATE POLICY bug_reports_update ON bug_reports FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS buyer_match_digest_log_modify ON buyer_match_digest_log;
CREATE POLICY buyer_match_digest_log_modify ON buyer_match_digest_log FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS closing_deal_nudges_modify ON closing_deal_nudges;
CREATE POLICY closing_deal_nudges_modify ON closing_deal_nudges FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS call_logs_delete ON contact_call_logs;
CREATE POLICY call_logs_delete ON contact_call_logs FOR DELETE
  USING (is_account_writer(account_id, 'agent') AND (user_id = auth.uid()));

DROP POLICY IF EXISTS call_logs_insert ON contact_call_logs;
CREATE POLICY call_logs_insert ON contact_call_logs FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS call_logs_update ON contact_call_logs;
CREATE POLICY call_logs_update ON contact_call_logs FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL
  USING (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_writer(c.account_id, 'agent'))));

DROP POLICY IF EXISTS contact_draft_sessions_modify ON contact_draft_sessions;
CREATE POLICY contact_draft_sessions_modify ON contact_draft_sessions FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_duplicate_dismissals_delete ON contact_duplicate_dismissals;
CREATE POLICY contact_duplicate_dismissals_delete ON contact_duplicate_dismissals FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_duplicate_dismissals_insert ON contact_duplicate_dismissals;
CREATE POLICY contact_duplicate_dismissals_insert ON contact_duplicate_dismissals FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_parties_modify ON contact_parties;
CREATE POLICY contact_parties_modify ON contact_parties FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_party_members_modify ON contact_party_members;
CREATE POLICY contact_party_members_modify ON contact_party_members FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contact_property_inquiries_select ON contact_property_inquiries;
CREATE POLICY contact_property_inquiries_select ON contact_property_inquiries FOR SELECT
  USING ((account_id IS NOT NULL AND is_account_member(account_id))
    OR EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_property_inquiries.contact_id
        AND c.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Account members can manage contact property inquiries" ON contact_property_inquiries;
CREATE POLICY "Account members can manage contact property inquiries" ON contact_property_inquiries FOR ALL
  USING ((account_id IS NOT NULL) AND is_account_writer(account_id, 'agent'))
  WITH CHECK ((account_id IS NOT NULL) AND is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage contact property inquiries" ON contact_property_inquiries;
CREATE POLICY "Users can manage contact property inquiries" ON contact_property_inquiries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_property_inquiries.contact_id
      AND c.user_id = auth.uid()
      AND is_account_writer(c.account_id, 'agent')
  ));

DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL
  USING (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_writer(c.account_id, 'agent'))));

DROP POLICY IF EXISTS contacts_insert ON contacts;
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (is_account_writer(account_id, 'agent') AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_coordinator'::org_role_enum]))))) OR (assigned_agent_id = auth.uid()) OR ((assigned_team_id IS NOT NULL) AND (assigned_team_id = ( SELECT p.team_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id))))) OR ((assigned_agent_id IS NULL) AND (assigned_team_id IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = contacts.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_leader'::org_role_enum]))))))));

DROP POLICY IF EXISTS conversation_gaps_insert ON conversation_gaps;
CREATE POLICY conversation_gaps_insert ON conversation_gaps FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS conversation_gaps_update ON conversation_gaps;
CREATE POLICY conversation_gaps_update ON conversation_gaps FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS conversations_insert ON conversations;
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_writer(account_id, 'agent') AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_coordinator'::org_role_enum]))))) OR (assigned_agent_id = auth.uid()) OR ((assigned_team_id IS NOT NULL) AND (assigned_team_id = ( SELECT p.team_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id))))) OR ((assigned_agent_id IS NULL) AND (assigned_team_id IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_id = conversations.account_id) AND (p.org_role = ANY (ARRAY['org_manager'::org_role_enum, 'org_leader'::org_role_enum]))))))));

DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;
CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS custom_fields_insert ON custom_fields;
CREATE POLICY custom_fields_insert ON custom_fields FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS custom_fields_update ON custom_fields;
CREATE POLICY custom_fields_update ON custom_fields FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS deal_documents_modify ON deal_documents;
CREATE POLICY deal_documents_modify ON deal_documents FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_events_insert ON deal_events;
CREATE POLICY deal_events_insert ON deal_events FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (actor_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_events.deal_id) AND (deals.account_id = deal_events.account_id)))));

DROP POLICY IF EXISTS deal_groups_modify ON deal_groups;
CREATE POLICY deal_groups_modify ON deal_groups FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_milestones_modify ON deal_milestones;
CREATE POLICY deal_milestones_modify ON deal_milestones FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_payment_tranches_modify ON deal_payment_tranches;
CREATE POLICY deal_payment_tranches_modify ON deal_payment_tranches FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_share_links_insert ON deal_share_links;
CREATE POLICY deal_share_links_insert ON deal_share_links FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_share_links_update ON deal_share_links;
CREATE POLICY deal_share_links_update ON deal_share_links FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_stakeholders_modify ON deal_stakeholders;
CREATE POLICY deal_stakeholders_modify ON deal_stakeholders FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_update_recipients_insert ON deal_update_recipients;
CREATE POLICY deal_update_recipients_insert ON deal_update_recipients FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_update_recipients_update ON deal_update_recipients;
CREATE POLICY deal_update_recipients_update ON deal_update_recipients FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deal_updates_insert ON deal_updates;
CREATE POLICY deal_updates_insert ON deal_updates FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (published_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_updates.deal_id) AND (deals.account_id = deal_updates.account_id)))));

DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deals_insert ON deals;
CREATE POLICY deals_insert ON deals FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS email_sync_configs_delete ON email_sync_configs;
CREATE POLICY email_sync_configs_delete ON email_sync_configs FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS email_sync_configs_insert ON email_sync_configs;
CREATE POLICY email_sync_configs_insert ON email_sync_configs FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS email_sync_configs_update ON email_sync_configs;
CREATE POLICY email_sync_configs_update ON email_sync_configs FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS email_sync_logs_delete ON email_sync_logs;
CREATE POLICY email_sync_logs_delete ON email_sync_logs FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS email_sync_logs_insert ON email_sync_logs;
CREATE POLICY email_sync_logs_insert ON email_sync_logs FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS follow_up_nudges_modify ON follow_up_nudges;
CREATE POLICY follow_up_nudges_modify ON follow_up_nudges FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS invoice_events_insert ON invoice_events;
CREATE POLICY invoice_events_insert ON invoice_events FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS invoice_settings_modify ON invoice_settings;
CREATE POLICY invoice_settings_modify ON invoice_settings FOR ALL
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS invoices_delete ON invoices;
CREATE POLICY invoices_delete ON invoices FOR DELETE
  USING (is_account_writer(account_id, 'agent') AND (status = 'draft'::text));

DROP POLICY IF EXISTS invoices_insert ON invoices;
CREATE POLICY invoices_insert ON invoices FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS invoices_update ON invoices;
CREATE POLICY invoices_update ON invoices FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents delete journey compartments" ON journey_compartments;
CREATE POLICY "Agents delete journey compartments" ON journey_compartments FOR DELETE
  USING (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

DROP POLICY IF EXISTS "Agents insert journey compartments" ON journey_compartments;
CREATE POLICY "Agents insert journey compartments" ON journey_compartments FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

DROP POLICY IF EXISTS "Agents update journey compartments" ON journey_compartments;
CREATE POLICY "Agents update journey compartments" ON journey_compartments FOR UPDATE
  USING (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id))
  WITH CHECK (is_account_writer(account_id, 'agent') AND journey_compartment_row_in_scope(account_id, user_id));

DROP POLICY IF EXISTS journey_events_modify ON journey_events;
CREATE POLICY journey_events_modify ON journey_events FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS journey_items_modify ON journey_items;
CREATE POLICY journey_items_modify ON journey_items FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS journey_overview_states_delete ON journey_overview_states;
CREATE POLICY journey_overview_states_delete ON journey_overview_states FOR DELETE TO authenticated
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS journey_overview_states_insert ON journey_overview_states;
CREATE POLICY journey_overview_states_insert ON journey_overview_states FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (((mode = 'buyer'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.contact_id = journey_overview_states.subject_id))))) OR ((mode = 'property'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.property_id = journey_overview_states.subject_id)))))));

DROP POLICY IF EXISTS journey_overview_states_update ON journey_overview_states;
CREATE POLICY journey_overview_states_update ON journey_overview_states FOR UPDATE TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent') AND (((mode = 'buyer'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.contact_id = journey_overview_states.subject_id))))) OR ((mode = 'property'::text) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.account_id = journey_overview_states.account_id) AND (journey_items.property_id = journey_overview_states.subject_id)))))));

DROP POLICY IF EXISTS "Agents delete journey priorities" ON journey_priorities;
CREATE POLICY "Agents delete journey priorities" ON journey_priorities FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents insert journey priorities" ON journey_priorities;
CREATE POLICY "Agents insert journey priorities" ON journey_priorities FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents update journey priorities" ON journey_priorities;
CREATE POLICY "Agents update journey priorities" ON journey_priorities FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS journey_stage_notes_insert ON journey_stage_notes;
CREATE POLICY journey_stage_notes_insert ON journey_stage_notes FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent') AND (created_by = ( SELECT auth.uid() AS uid)) AND (NOT (created_by_name IS DISTINCT FROM ( SELECT profiles.full_name
   FROM profiles
  WHERE ((profiles.account_id = journey_stage_notes.account_id) AND (profiles.user_id = ( SELECT auth.uid() AS uid)))
 LIMIT 1))) AND (EXISTS ( SELECT 1
   FROM journey_items
  WHERE ((journey_items.id = journey_stage_notes.item_id) AND (journey_items.account_id = journey_stage_notes.account_id)))) AND (EXISTS ( SELECT 1
   FROM journey_stages
  WHERE ((journey_stages.id = journey_stage_notes.stage_id) AND (journey_stages.account_id = journey_stage_notes.account_id) AND (journey_stages.name = journey_stage_notes.stage_name) AND (NOT (journey_stages.color IS DISTINCT FROM journey_stage_notes.stage_color))))));

DROP POLICY IF EXISTS journey_stages_modify ON journey_stages;
CREATE POLICY journey_stages_modify ON journey_stages FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS learned_facts_insert ON learned_facts;
CREATE POLICY learned_facts_insert ON learned_facts FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS learned_facts_update ON learned_facts;
CREATE POLICY learned_facts_update ON learned_facts FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS liaison_job_payments_modify ON liaison_job_payments;
CREATE POLICY liaison_job_payments_modify ON liaison_job_payments FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS liaison_jobs_modify ON liaison_jobs;
CREATE POLICY liaison_jobs_modify ON liaison_jobs FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS liaison_workflows_modify ON liaison_workflows;
CREATE POLICY liaison_workflows_modify ON liaison_workflows FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS liaisons_modify ON liaisons;
CREATE POLICY liaisons_modify ON liaisons FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS match_events_update ON match_events;
CREATE POLICY match_events_update ON match_events FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL
  USING (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_writer(c.account_id, 'agent'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_writer(c.account_id, 'agent'))));

DROP POLICY IF EXISTS message_templates_delete ON message_templates;
CREATE POLICY message_templates_delete ON message_templates FOR DELETE
  USING (is_account_writer(account_id, 'owner'));

DROP POLICY IF EXISTS message_templates_insert ON message_templates;
CREATE POLICY message_templates_insert ON message_templates FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'owner'));

DROP POLICY IF EXISTS message_templates_update ON message_templates;
CREATE POLICY message_templates_update ON message_templates FOR UPDATE
  USING (is_account_writer(account_id, 'owner'));

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL
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

DROP POLICY IF EXISTS notification_preferences_write ON notification_preferences;
CREATE POLICY notification_preferences_write ON notification_preferences FOR ALL
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS occasion_greetings_delete ON occasion_greetings;
CREATE POLICY occasion_greetings_delete ON occasion_greetings FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS occasion_greetings_insert ON occasion_greetings;
CREATE POLICY occasion_greetings_insert ON occasion_greetings FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS occasion_greetings_update ON occasion_greetings;
CREATE POLICY occasion_greetings_update ON occasion_greetings FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS outreach_followups_modify ON outreach_followups;
CREATE POLICY outreach_followups_modify ON outreach_followups FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS owner_details_request_settings_modify ON owner_details_request_settings;
CREATE POLICY owner_details_request_settings_modify ON owner_details_request_settings FOR ALL
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS owner_digest_log_modify ON owner_digest_log;
CREATE POLICY owner_digest_log_modify ON owner_digest_log FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS owner_digest_settings_modify ON owner_digest_settings;
CREATE POLICY owner_digest_settings_modify ON owner_digest_settings FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS party_suggestion_dismissals_modify ON party_suggestion_dismissals;
CREATE POLICY party_suggestion_dismissals_modify ON party_suggestion_dismissals FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS pending_client_replies_modify ON pending_client_replies;
CREATE POLICY pending_client_replies_modify ON pending_client_replies FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS pending_contact_updates_modify ON pending_contact_updates;
CREATE POLICY pending_contact_updates_modify ON pending_contact_updates FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS pending_map_pins_modify ON pending_map_pins;
CREATE POLICY pending_map_pins_modify ON pending_map_pins FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS pipeline_stages_modify ON pipeline_stages;
CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL
  USING (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_writer(p.account_id, 'admin'))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_writer(p.account_id, 'admin'))));

DROP POLICY IF EXISTS pipelines_delete ON pipelines;
CREATE POLICY pipelines_delete ON pipelines FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS pipelines_insert ON pipelines;
CREATE POLICY pipelines_insert ON pipelines FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS pipelines_update ON pipelines;
CREATE POLICY pipelines_update ON pipelines FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS portal_accounts_select ON portal_accounts;
CREATE POLICY portal_accounts_select ON portal_accounts FOR SELECT TO authenticated
  USING (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE (p.user_id = auth.uid())));

DROP POLICY IF EXISTS "Members manage own portal accounts" ON portal_accounts;
CREATE POLICY "Members manage own portal accounts" ON portal_accounts FOR ALL TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS portal_import_items_select ON portal_import_items;
CREATE POLICY portal_import_items_select ON portal_import_items FOR SELECT TO authenticated
  USING (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE (p.user_id = auth.uid())));

DROP POLICY IF EXISTS "Members manage own portal imports" ON portal_import_items;
CREATE POLICY "Members manage own portal imports" ON portal_import_items FOR ALL TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS projects_modify ON projects;
CREATE POLICY projects_modify ON projects FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS properties_modify ON properties;
CREATE POLICY properties_modify ON properties FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Authenticated users can update their account doc requests" ON property_document_requests;
CREATE POLICY "Authenticated users can update their account doc requests" ON property_document_requests FOR UPDATE TO authenticated
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS draft_sessions_modify ON property_draft_sessions;
CREATE POLICY draft_sessions_modify ON property_draft_sessions FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS property_guidance_values_delete ON property_guidance_values;
CREATE POLICY property_guidance_values_delete ON property_guidance_values FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS location_requests_update ON property_location_requests;
CREATE POLICY location_requests_update ON property_location_requests FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents create own portal listing aliases" ON property_portal_listing_aliases;
CREATE POLICY "Agents create own portal listing aliases" ON property_portal_listing_aliases FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents delete own portal listing aliases" ON property_portal_listing_aliases;
CREATE POLICY "Agents delete own portal listing aliases" ON property_portal_listing_aliases FOR DELETE TO authenticated
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents update own portal listing aliases" ON property_portal_listing_aliases;
CREATE POLICY "Agents update own portal listing aliases" ON property_portal_listing_aliases FOR UPDATE TO authenticated
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS property_share_grants_insert ON property_share_grants;
CREATE POLICY property_share_grants_insert ON property_share_grants FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS property_share_grants_update ON property_share_grants;
CREATE POLICY property_share_grants_update ON property_share_grants FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS property_shares_modify ON property_shares;
CREATE POLICY property_shares_modify ON property_shares FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can insert own razorpay orders" ON razorpay_orders;
CREATE POLICY "Users can insert own razorpay orders" ON razorpay_orders FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can update own razorpay orders" ON razorpay_orders;
CREATE POLICY "Users can update own razorpay orders" ON razorpay_orders FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS requirement_share_links_insert ON requirement_share_links;
CREATE POLICY requirement_share_links_insert ON requirement_share_links FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS requirement_share_links_update ON requirement_share_links;
CREATE POLICY requirement_share_links_update ON requirement_share_links FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS routing_rules_modify ON routing_rules;
CREATE POLICY routing_rules_modify ON routing_rules FOR ALL
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS showcase_settings_modify ON showcase_settings;
CREATE POLICY showcase_settings_modify ON showcase_settings FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS showcase_share_links_insert ON showcase_share_links;
CREATE POLICY showcase_share_links_insert ON showcase_share_links FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS subscriptions_insert ON subscriptions;
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'owner'));

DROP POLICY IF EXISTS subscriptions_update ON subscriptions;
CREATE POLICY subscriptions_update ON subscriptions FOR UPDATE
  USING (is_account_writer(account_id, 'owner'))
  WITH CHECK (is_account_writer(account_id, 'owner'));

DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_delete ON tags FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert ON tags FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS tags_update ON tags;
CREATE POLICY tags_update ON tags FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS teams_delete ON teams;
CREATE POLICY teams_delete ON teams FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS teams_insert ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS teams_update ON teams;
CREATE POLICY teams_update ON teams FOR UPDATE
  USING (is_account_writer(account_id, 'admin')
    OR (leader_id = auth.uid() AND is_account_writer(account_id, 'agent')));

DROP POLICY IF EXISTS todos_delete ON todos;
CREATE POLICY todos_delete ON todos FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS todos_insert ON todos;
CREATE POLICY todos_insert ON todos FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS todos_update ON todos;
CREATE POLICY todos_update ON todos FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS update_sessions_modify ON update_sessions;
CREATE POLICY update_sessions_modify ON update_sessions FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_agent_config_delete ON voice_agent_config;
CREATE POLICY voice_agent_config_delete ON voice_agent_config FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS voice_agent_config_insert ON voice_agent_config;
CREATE POLICY voice_agent_config_insert ON voice_agent_config FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS voice_agent_config_update ON voice_agent_config;
CREATE POLICY voice_agent_config_update ON voice_agent_config FOR UPDATE
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS voice_announcements_delete ON voice_announcements;
CREATE POLICY voice_announcements_delete ON voice_announcements FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_announcements_insert ON voice_announcements;
CREATE POLICY voice_announcements_insert ON voice_announcements FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_announcements_update ON voice_announcements;
CREATE POLICY voice_announcements_update ON voice_announcements FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaign_recipients_delete ON voice_campaign_recipients;
CREATE POLICY voice_campaign_recipients_delete ON voice_campaign_recipients FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaign_recipients_insert ON voice_campaign_recipients;
CREATE POLICY voice_campaign_recipients_insert ON voice_campaign_recipients FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaign_recipients_update ON voice_campaign_recipients;
CREATE POLICY voice_campaign_recipients_update ON voice_campaign_recipients FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaigns_delete ON voice_campaigns;
CREATE POLICY voice_campaigns_delete ON voice_campaigns FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaigns_insert ON voice_campaigns;
CREATE POLICY voice_campaigns_insert ON voice_campaigns FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS voice_campaigns_update ON voice_campaigns;
CREATE POLICY voice_campaigns_update ON voice_campaigns FOR UPDATE
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_config;
CREATE POLICY whatsapp_config_delete ON whatsapp_config FOR DELETE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_config;
CREATE POLICY whatsapp_config_insert ON whatsapp_config FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_config;
CREATE POLICY whatsapp_config_update ON whatsapp_config FOR UPDATE
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS "Agents manage their account's participants" ON whatsapp_group_participants;
CREATE POLICY "Agents manage their account's participants" ON whatsapp_group_participants FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents manage their account's groups" ON whatsapp_groups;
CREATE POLICY "Agents manage their account's groups" ON whatsapp_groups FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS whatsapp_meta_flow_sessions_modify ON whatsapp_meta_flow_sessions;
CREATE POLICY whatsapp_meta_flow_sessions_modify ON whatsapp_meta_flow_sessions FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS whatsapp_meta_flows_modify ON whatsapp_meta_flows;
CREATE POLICY whatsapp_meta_flows_modify ON whatsapp_meta_flows FOR ALL
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS number_change_notices_delete ON whatsapp_number_change_notices;
CREATE POLICY number_change_notices_delete ON whatsapp_number_change_notices FOR DELETE TO authenticated
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS number_change_notices_insert ON whatsapp_number_change_notices;
CREATE POLICY number_change_notices_insert ON whatsapp_number_change_notices FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS number_change_notices_update ON whatsapp_number_change_notices;
CREATE POLICY number_change_notices_update ON whatsapp_number_change_notices FOR UPDATE TO authenticated
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_number_profiles_delete ON whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_delete ON whatsapp_number_profiles FOR DELETE TO authenticated
  USING (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_number_profiles_insert ON whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_insert ON whatsapp_number_profiles FOR INSERT TO authenticated
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_number_profiles_update ON whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_update ON whatsapp_number_profiles FOR UPDATE TO authenticated
  USING (is_account_writer(account_id, 'admin'))
  WITH CHECK (is_account_writer(account_id, 'admin'));

DROP POLICY IF EXISTS retired_number_replies_delete ON whatsapp_retired_number_replies;
CREATE POLICY retired_number_replies_delete ON whatsapp_retired_number_replies FOR DELETE TO authenticated
  USING (is_account_writer(account_id, 'admin'));
