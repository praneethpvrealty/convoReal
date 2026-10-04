export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      account_api_keys: {
        Row: {
          account_id: string;
          created_at: string;
          created_by_user_id: string | null;
          expires_at: string | null;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          revoked_by_user_id: string | null;
          scopes: string[];
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by_user_id?: string | null;
          expires_at?: string | null;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          revoked_by_user_id?: string | null;
          scopes?: string[];
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          expires_at?: string | null;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          revoked_by_user_id?: string | null;
          scopes?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'account_api_keys_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'account_api_keys_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      account_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by_user_id: string | null;
          account_id: string;
          created_at: string;
          created_by_user_id: string | null;
          expires_at: string;
          id: string;
          label: string | null;
          role: Database['public']['Enums']['account_role_enum'];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          account_id: string;
          created_at?: string;
          created_by_user_id?: string | null;
          expires_at: string;
          id?: string;
          label?: string | null;
          role: Database['public']['Enums']['account_role_enum'];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          account_id?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          expires_at?: string;
          id?: string;
          label?: string | null;
          role?: Database['public']['Enums']['account_role_enum'];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'account_invitations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'account_invitations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      account_lifecycle_log: {
        Row: {
          account_id: string;
          action: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          snapshot: Json | null;
        };
        Insert: {
          account_id: string;
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          snapshot?: Json | null;
        };
        Update: {
          account_id?: string;
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          snapshot?: Json | null;
        };
        Relationships: [];
      };
      account_marketplace_items: {
        Row: {
          account_id: string;
          created_at: string;
          flow_id: string | null;
          id: string;
          marketplace_item_id: string;
          purchased_at: string | null;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          flow_id?: string | null;
          id?: string;
          marketplace_item_id: string;
          purchased_at?: string | null;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          flow_id?: string | null;
          id?: string;
          marketplace_item_id?: string;
          purchased_at?: string | null;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'account_marketplace_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'account_marketplace_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'account_marketplace_items_flow_id_fkey';
            columns: ['flow_id'];
            isOneToOne: false;
            referencedRelation: 'flows';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'account_marketplace_items_marketplace_item_id_fkey';
            columns: ['marketplace_item_id'];
            isOneToOne: false;
            referencedRelation: 'marketplace_items';
            referencedColumns: ['id'];
          },
        ];
      };
      accounts: {
        Row: {
          agent_quiet_hours_enabled: boolean;
          agent_quiet_hours_end: string;
          agent_quiet_hours_start: string;
          archived_at: string | null;
          archived_by: string | null;
          beta_invite_id: string | null;
          client_quiet_hours_enabled: boolean;
          client_quiet_hours_end: string;
          client_quiet_hours_start: string;
          created_at: string;
          data_sharing_consent: boolean;
          data_sharing_consent_at: string | null;
          data_sharing_consent_by: string | null;
          default_language: string;
          id: string;
          invite_quota: number;
          journey_compartment_scope: string;
          name: string;
          owner_user_id: string;
          referred_by_code: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          agent_quiet_hours_enabled?: boolean;
          agent_quiet_hours_end?: string;
          agent_quiet_hours_start?: string;
          archived_at?: string | null;
          archived_by?: string | null;
          beta_invite_id?: string | null;
          client_quiet_hours_enabled?: boolean;
          client_quiet_hours_end?: string;
          client_quiet_hours_start?: string;
          created_at?: string;
          data_sharing_consent?: boolean;
          data_sharing_consent_at?: string | null;
          data_sharing_consent_by?: string | null;
          default_language?: string;
          id?: string;
          invite_quota?: number;
          journey_compartment_scope?: string;
          name?: string;
          owner_user_id: string;
          referred_by_code?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          agent_quiet_hours_enabled?: boolean;
          agent_quiet_hours_end?: string;
          agent_quiet_hours_start?: string;
          archived_at?: string | null;
          archived_by?: string | null;
          beta_invite_id?: string | null;
          client_quiet_hours_enabled?: boolean;
          client_quiet_hours_end?: string;
          client_quiet_hours_start?: string;
          created_at?: string;
          data_sharing_consent?: boolean;
          data_sharing_consent_at?: string | null;
          data_sharing_consent_by?: string | null;
          default_language?: string;
          id?: string;
          invite_quota?: number;
          journey_compartment_scope?: string;
          name?: string;
          owner_user_id?: string;
          referred_by_code?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'accounts_beta_invite_id_fkey';
            columns: ['beta_invite_id'];
            isOneToOne: false;
            referencedRelation: 'beta_invites';
            referencedColumns: ['id'];
          },
        ];
      };
      ad_campaigns: {
        Row: {
          account_id: string;
          ad_id: string | null;
          adset_id: string | null;
          campaign_id: string;
          created_at: string;
          created_by: string | null;
          creative_id: string | null;
          currency: string;
          daily_budget_minor: number;
          end_at: string | null;
          headline: string | null;
          id: string;
          image_url: string | null;
          last_insights: Json | null;
          last_insights_at: string | null;
          primary_text: string | null;
          property_id: string;
          radius_km: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          ad_id?: string | null;
          adset_id?: string | null;
          campaign_id: string;
          created_at?: string;
          created_by?: string | null;
          creative_id?: string | null;
          currency?: string;
          daily_budget_minor: number;
          end_at?: string | null;
          headline?: string | null;
          id?: string;
          image_url?: string | null;
          last_insights?: Json | null;
          last_insights_at?: string | null;
          primary_text?: string | null;
          property_id: string;
          radius_km?: number | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          ad_id?: string | null;
          adset_id?: string | null;
          campaign_id?: string;
          created_at?: string;
          created_by?: string | null;
          creative_id?: string | null;
          currency?: string;
          daily_budget_minor?: number;
          end_at?: string | null;
          headline?: string | null;
          id?: string;
          image_url?: string | null;
          last_insights?: Json | null;
          last_insights_at?: string | null;
          primary_text?: string | null;
          property_id?: string;
          radius_km?: number | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ad_campaigns_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'ad_campaigns_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ad_campaigns_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_plan_otp_challenges: {
        Row: {
          account_id: string | null;
          action: string;
          admin_user_id: string;
          attempts: number;
          code_hash: string;
          created_at: string;
          expires_at: string;
          from_plan: string | null;
          id: string;
          payload_hash: string | null;
          to_plan: string | null;
          used_at: string | null;
        };
        Insert: {
          account_id?: string | null;
          action?: string;
          admin_user_id: string;
          attempts?: number;
          code_hash: string;
          created_at?: string;
          expires_at: string;
          from_plan?: string | null;
          id?: string;
          payload_hash?: string | null;
          to_plan?: string | null;
          used_at?: string | null;
        };
        Update: {
          account_id?: string | null;
          action?: string;
          admin_user_id?: string;
          attempts?: number;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          from_plan?: string | null;
          id?: string;
          payload_hash?: string | null;
          to_plan?: string | null;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_plan_otp_challenges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'admin_plan_otp_challenges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agency_articles: {
        Row: {
          account_id: string;
          content: string | null;
          created_at: string;
          excerpt: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          meta_description: string | null;
          meta_title: string | null;
          published_at: string | null;
          slug: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          content?: string | null;
          created_at?: string;
          excerpt?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          slug?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          content?: string | null;
          created_at?: string;
          excerpt?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          slug?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agency_articles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agency_articles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agency_services: {
        Row: {
          account_id: string;
          content: string | null;
          created_at: string;
          description: string | null;
          icon: string | null;
          id: string;
          is_active: boolean;
          meta_description: string | null;
          meta_title: string | null;
          slug: string | null;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          content?: string | null;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          meta_description?: string | null;
          meta_title?: string | null;
          slug?: string | null;
          sort_order?: number;
          title: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          content?: string | null;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          meta_description?: string | null;
          meta_title?: string | null;
          slug?: string | null;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agency_services_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agency_services_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_digest_log: {
        Row: {
          account_id: string;
          created_at: string | null;
          digest_date: string;
          id: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          digest_date: string;
          id?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          digest_date?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agent_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_inventory_digest_log: {
        Row: {
          account_id: string;
          agent_contact_id: string;
          channel: string | null;
          created_at: string;
          digest_date: string;
          id: string;
          invite_included: boolean;
          period_end: string;
          period_start: string;
          stats: Json;
        };
        Insert: {
          account_id: string;
          agent_contact_id: string;
          channel?: string | null;
          created_at?: string;
          digest_date: string;
          id?: string;
          invite_included?: boolean;
          period_end: string;
          period_start: string;
          stats?: Json;
        };
        Update: {
          account_id?: string;
          agent_contact_id?: string;
          channel?: string | null;
          created_at?: string;
          digest_date?: string;
          id?: string;
          invite_included?: boolean;
          period_end?: string;
          period_start?: string;
          stats?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_inventory_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agent_inventory_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_inventory_digest_log_agent_contact_id_fkey';
            columns: ['agent_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_inventory_digest_settings: {
        Row: {
          account_id: string;
          created_at: string;
          frequency: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          frequency?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          frequency?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_inventory_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agent_inventory_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_task_digest_log: {
        Row: {
          account_id: string;
          digest_date: string;
          id: string;
          sent_at: string;
          slot: string;
          task_count: number;
          user_id: string;
        };
        Insert: {
          account_id: string;
          digest_date: string;
          id?: string;
          sent_at?: string;
          slot: string;
          task_count?: number;
          user_id: string;
        };
        Update: {
          account_id?: string;
          digest_date?: string;
          id?: string;
          sent_at?: string;
          slot?: string;
          task_count?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_task_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agent_task_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_task_digest_settings: {
        Row: {
          account_id: string;
          created_at: string;
          enabled: boolean;
          id: string;
          send_times: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          send_times?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          send_times?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_task_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'agent_task_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_call_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          feature: string | null;
          has_media: boolean;
          id: string;
          input_preview: string | null;
          json_mode: boolean;
          key_label: string | null;
          latency_ms: number | null;
          model: string;
          output_preview: string | null;
          prompt_chars: number | null;
          prompt_tokens: number | null;
          response_chars: number | null;
          response_tokens: number | null;
          success: boolean;
          system_preview: string | null;
          thought_tokens: number | null;
          tier: string | null;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          feature?: string | null;
          has_media?: boolean;
          id?: string;
          input_preview?: string | null;
          json_mode?: boolean;
          key_label?: string | null;
          latency_ms?: number | null;
          model: string;
          output_preview?: string | null;
          prompt_chars?: number | null;
          prompt_tokens?: number | null;
          response_chars?: number | null;
          response_tokens?: number | null;
          success?: boolean;
          system_preview?: string | null;
          thought_tokens?: number | null;
          tier?: string | null;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          feature?: string | null;
          has_media?: boolean;
          id?: string;
          input_preview?: string | null;
          json_mode?: boolean;
          key_label?: string | null;
          latency_ms?: number | null;
          model?: string;
          output_preview?: string | null;
          prompt_chars?: number | null;
          prompt_tokens?: number | null;
          response_chars?: number | null;
          response_tokens?: number | null;
          success?: boolean;
          system_preview?: string | null;
          thought_tokens?: number | null;
          tier?: string | null;
        };
        Relationships: [];
      };
      ai_key_topups: {
        Row: {
          amount: number;
          created_at: string | null;
          created_by: string | null;
          currency: string;
          id: string;
          key_id: string;
          note: string | null;
          topped_up_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string | null;
          created_by?: string | null;
          currency?: string;
          id?: string;
          key_id: string;
          note?: string | null;
          topped_up_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          created_by?: string | null;
          currency?: string;
          id?: string;
          key_id?: string;
          note?: string | null;
          topped_up_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_key_topups_key_id_fkey';
            columns: ['key_id'];
            isOneToOne: false;
            referencedRelation: 'ai_provider_keys';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_provider_keys: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          enabled: boolean;
          id: string;
          key_ciphertext: string;
          key_hint: string;
          label: string;
          last_alert_at: string | null;
          last_error: string | null;
          last_error_at: string | null;
          last_used_at: string | null;
          priority: number;
          provider: string;
          resting_until: string | null;
          scope: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          key_ciphertext: string;
          key_hint: string;
          label: string;
          last_alert_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          last_used_at?: string | null;
          priority?: number;
          provider?: string;
          resting_until?: string | null;
          scope?: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          key_ciphertext?: string;
          key_hint?: string;
          label?: string;
          last_alert_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          last_used_at?: string | null;
          priority?: number;
          provider?: string;
          resting_until?: string | null;
          scope?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      appointment_reminder_log: {
        Row: {
          account_id: string;
          appointment_id: string;
          contact_id: string | null;
          created_at: string | null;
          generation_known: boolean;
          id: string;
          liaison_id: string | null;
          prior_wa_message_ids: string[];
          rearmed_at: string | null;
          reminder_type: string;
          sent_at: string | null;
          wa_message_id: string | null;
        };
        Insert: {
          account_id: string;
          appointment_id: string;
          contact_id?: string | null;
          created_at?: string | null;
          generation_known?: boolean;
          id?: string;
          liaison_id?: string | null;
          prior_wa_message_ids?: string[];
          rearmed_at?: string | null;
          reminder_type: string;
          sent_at?: string | null;
          wa_message_id?: string | null;
        };
        Update: {
          account_id?: string;
          appointment_id?: string;
          contact_id?: string | null;
          created_at?: string | null;
          generation_known?: boolean;
          id?: string;
          liaison_id?: string | null;
          prior_wa_message_ids?: string[];
          rearmed_at?: string | null;
          reminder_type?: string;
          sent_at?: string | null;
          wa_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'appointment_reminder_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'appointment_reminder_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointment_reminder_log_appointment_id_fkey';
            columns: ['appointment_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointment_reminder_log_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointment_reminder_log_liaison_id_fkey';
            columns: ['liaison_id'];
            isOneToOne: false;
            referencedRelation: 'liaisons';
            referencedColumns: ['id'];
          },
        ];
      };
      appointments: {
        Row: {
          account_id: string;
          agenda: string | null;
          agent_reminder_sent: boolean;
          archived_at: string | null;
          assigned_to: string | null;
          client_confirmed_at: string | null;
          contact_id: string | null;
          contact_ids: string[];
          copilot_search_text: string | null;
          created_at: string | null;
          description: string | null;
          end_time: string;
          event_type: string;
          id: string;
          liaison_id: string | null;
          location: string | null;
          minutes: string | null;
          outcome: string | null;
          overdue_nudge_sent: boolean;
          property_id: string | null;
          remind_liaison: boolean;
          reminder_1h_sent: boolean;
          reminder_24h_sent: boolean;
          reminder_2h_sent: boolean;
          reminder_morning_sent: boolean;
          reminders_rearmed_at: string | null;
          reschedule_requested_at: string | null;
          source: string;
          start_time: string;
          status: string;
          title: string;
          transcript: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          agenda?: string | null;
          agent_reminder_sent?: boolean;
          archived_at?: string | null;
          assigned_to?: string | null;
          client_confirmed_at?: string | null;
          contact_id?: string | null;
          contact_ids?: string[];
          copilot_search_text?: string | null;
          created_at?: string | null;
          description?: string | null;
          end_time: string;
          event_type?: string;
          id?: string;
          liaison_id?: string | null;
          location?: string | null;
          minutes?: string | null;
          outcome?: string | null;
          overdue_nudge_sent?: boolean;
          property_id?: string | null;
          remind_liaison?: boolean;
          reminder_1h_sent?: boolean;
          reminder_24h_sent?: boolean;
          reminder_2h_sent?: boolean;
          reminder_morning_sent?: boolean;
          reminders_rearmed_at?: string | null;
          reschedule_requested_at?: string | null;
          source?: string;
          start_time: string;
          status?: string;
          title: string;
          transcript?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          agenda?: string | null;
          agent_reminder_sent?: boolean;
          archived_at?: string | null;
          assigned_to?: string | null;
          client_confirmed_at?: string | null;
          contact_id?: string | null;
          contact_ids?: string[];
          copilot_search_text?: string | null;
          created_at?: string | null;
          description?: string | null;
          end_time?: string;
          event_type?: string;
          id?: string;
          liaison_id?: string | null;
          location?: string | null;
          minutes?: string | null;
          outcome?: string | null;
          overdue_nudge_sent?: boolean;
          property_id?: string | null;
          remind_liaison?: boolean;
          reminder_1h_sent?: boolean;
          reminder_24h_sent?: boolean;
          reminder_2h_sent?: boolean;
          reminder_morning_sent?: boolean;
          reminders_rearmed_at?: string | null;
          reschedule_requested_at?: string | null;
          source?: string;
          start_time?: string;
          status?: string;
          title?: string;
          transcript?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'appointments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'appointments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointments_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointments_liaison_id_fkey';
            columns: ['liaison_id'];
            isOneToOne: false;
            referencedRelation: 'liaisons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointments_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      automation_logs: {
        Row: {
          account_id: string;
          automation_id: string;
          contact_id: string | null;
          created_at: string;
          error_message: string | null;
          id: string;
          status: string;
          steps_executed: Json;
          trigger_event: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          automation_id: string;
          contact_id?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          status: string;
          steps_executed?: Json;
          trigger_event: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          automation_id?: string;
          contact_id?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          status?: string;
          steps_executed?: Json;
          trigger_event?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automation_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'automation_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_logs_automation_id_fkey';
            columns: ['automation_id'];
            isOneToOne: false;
            referencedRelation: 'automations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_logs_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      automation_pending_executions: {
        Row: {
          account_id: string;
          attempts: number;
          automation_id: string;
          branch: string | null;
          claim_token: string | null;
          claimed_at: string | null;
          contact_id: string | null;
          context: Json;
          created_at: string;
          id: string;
          log_id: string | null;
          next_step_position: number;
          parent_step_id: string | null;
          run_at: string;
          status: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          attempts?: number;
          automation_id: string;
          branch?: string | null;
          claim_token?: string | null;
          claimed_at?: string | null;
          contact_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          log_id?: string | null;
          next_step_position: number;
          parent_step_id?: string | null;
          run_at: string;
          status?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          attempts?: number;
          automation_id?: string;
          branch?: string | null;
          claim_token?: string | null;
          claimed_at?: string | null;
          contact_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          log_id?: string | null;
          next_step_position?: number;
          parent_step_id?: string | null;
          run_at?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automation_pending_executions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'automation_pending_executions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_pending_executions_automation_id_fkey';
            columns: ['automation_id'];
            isOneToOne: false;
            referencedRelation: 'automations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_pending_executions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_pending_executions_log_id_fkey';
            columns: ['log_id'];
            isOneToOne: false;
            referencedRelation: 'automation_logs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_pending_executions_parent_step_id_fkey';
            columns: ['parent_step_id'];
            isOneToOne: false;
            referencedRelation: 'automation_steps';
            referencedColumns: ['id'];
          },
        ];
      };
      automation_steps: {
        Row: {
          automation_id: string;
          branch: string | null;
          created_at: string;
          id: string;
          parent_step_id: string | null;
          position: number;
          step_config: Json;
          step_type: string;
        };
        Insert: {
          automation_id: string;
          branch?: string | null;
          created_at?: string;
          id?: string;
          parent_step_id?: string | null;
          position: number;
          step_config?: Json;
          step_type: string;
        };
        Update: {
          automation_id?: string;
          branch?: string | null;
          created_at?: string;
          id?: string;
          parent_step_id?: string | null;
          position?: number;
          step_config?: Json;
          step_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automation_steps_automation_id_fkey';
            columns: ['automation_id'];
            isOneToOne: false;
            referencedRelation: 'automations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_steps_parent_step_id_fkey';
            columns: ['parent_step_id'];
            isOneToOne: false;
            referencedRelation: 'automation_steps';
            referencedColumns: ['id'];
          },
        ];
      };
      automations: {
        Row: {
          account_id: string;
          created_at: string;
          description: string | null;
          execution_count: number;
          id: string;
          is_active: boolean;
          last_executed_at: string | null;
          name: string;
          trigger_config: Json;
          trigger_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          description?: string | null;
          execution_count?: number;
          id?: string;
          is_active?: boolean;
          last_executed_at?: string | null;
          name: string;
          trigger_config?: Json;
          trigger_type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          description?: string | null;
          execution_count?: number;
          id?: string;
          is_active?: boolean;
          last_executed_at?: string | null;
          name?: string;
          trigger_config?: Json;
          trigger_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'automations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      beta_invites: {
        Row: {
          accepted_account_id: string | null;
          accepted_at: string | null;
          accepted_by_user_id: string | null;
          code: string;
          created_at: string;
          expires_at: string;
          generation: number;
          id: string;
          invitee_email: string | null;
          invitee_phone: string | null;
          issued_by_account_id: string | null;
          issued_by_user_id: string | null;
          label: string | null;
          seat_number: number | null;
          status: Database['public']['Enums']['beta_invite_status'];
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          accepted_account_id?: string | null;
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          code: string;
          created_at?: string;
          expires_at: string;
          generation?: number;
          id?: string;
          invitee_email?: string | null;
          invitee_phone?: string | null;
          issued_by_account_id?: string | null;
          issued_by_user_id?: string | null;
          label?: string | null;
          seat_number?: number | null;
          status?: Database['public']['Enums']['beta_invite_status'];
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_account_id?: string | null;
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          code?: string;
          created_at?: string;
          expires_at?: string;
          generation?: number;
          id?: string;
          invitee_email?: string | null;
          invitee_phone?: string | null;
          issued_by_account_id?: string | null;
          issued_by_user_id?: string | null;
          label?: string | null;
          seat_number?: number | null;
          status?: Database['public']['Enums']['beta_invite_status'];
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'beta_invites_accepted_account_id_fkey';
            columns: ['accepted_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'beta_invites_accepted_account_id_fkey';
            columns: ['accepted_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'beta_invites_issued_by_account_id_fkey';
            columns: ['issued_by_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'beta_invites_issued_by_account_id_fkey';
            columns: ['issued_by_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      beta_program: {
        Row: {
          account_cap: number;
          default_quota: number;
          gate_enabled: boolean;
          id: boolean;
          invite_ttl_days: number;
          issuance_open: boolean;
          program_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          account_cap?: number;
          default_quota?: number;
          gate_enabled?: boolean;
          id?: boolean;
          invite_ttl_days?: number;
          issuance_open?: boolean;
          program_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          account_cap?: number;
          default_quota?: number;
          gate_enabled?: boolean;
          id?: boolean;
          invite_ttl_days?: number;
          issuance_open?: boolean;
          program_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      bot_instructions: {
        Row: {
          account_id: string;
          contact_classification: string | null;
          created_at: string;
          created_by: string | null;
          directive: string;
          funnel_stage: string | null;
          hit_count: number;
          id: string;
          influence: string;
          language: string | null;
          last_hit_at: string | null;
          listing_type: string | null;
          source: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          account_id: string;
          contact_classification?: string | null;
          created_at?: string;
          created_by?: string | null;
          directive: string;
          funnel_stage?: string | null;
          hit_count?: number;
          id?: string;
          influence: string;
          language?: string | null;
          last_hit_at?: string | null;
          listing_type?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          account_id?: string;
          contact_classification?: string | null;
          created_at?: string;
          created_by?: string | null;
          directive?: string;
          funnel_stage?: string | null;
          hit_count?: number;
          id?: string;
          influence?: string;
          language?: string | null;
          last_hit_at?: string | null;
          listing_type?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bot_instructions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'bot_instructions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      bot_message_targets: {
        Row: {
          account_id: string;
          created_at: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          updated_at: string | null;
          wa_message_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          updated_at?: string | null;
          wa_message_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          updated_at?: string | null;
          wa_message_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bot_message_targets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'bot_message_targets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          broadcast_id: string;
          claimed_at: string | null;
          contact_id: string | null;
          created_at: string | null;
          delivered_at: string | null;
          error_message: string | null;
          id: string;
          read_at: string | null;
          replied_at: string | null;
          retry_after: string | null;
          retry_count: number;
          sent_at: string | null;
          status: string;
          whatsapp_message_id: string | null;
        };
        Insert: {
          broadcast_id: string;
          claimed_at?: string | null;
          contact_id?: string | null;
          created_at?: string | null;
          delivered_at?: string | null;
          error_message?: string | null;
          id?: string;
          read_at?: string | null;
          replied_at?: string | null;
          retry_after?: string | null;
          retry_count?: number;
          sent_at?: string | null;
          status?: string;
          whatsapp_message_id?: string | null;
        };
        Update: {
          broadcast_id?: string;
          claimed_at?: string | null;
          contact_id?: string | null;
          created_at?: string | null;
          delivered_at?: string | null;
          error_message?: string | null;
          id?: string;
          read_at?: string | null;
          replied_at?: string | null;
          retry_after?: string | null;
          retry_count?: number;
          sent_at?: string | null;
          status?: string;
          whatsapp_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'broadcast_recipients_broadcast_id_fkey';
            columns: ['broadcast_id'];
            isOneToOne: false;
            referencedRelation: 'broadcasts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'broadcast_recipients_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      broadcasts: {
        Row: {
          account_id: string;
          audience_filter: Json | null;
          created_at: string | null;
          delivered_count: number | null;
          dispatch_lease_until: string | null;
          failed_count: number | null;
          header_media_url: string | null;
          id: string;
          name: string;
          read_count: number | null;
          replied_count: number | null;
          scheduled_at: string | null;
          sent_count: number | null;
          status: string;
          template_language: string;
          template_name: string;
          template_variables: Json | null;
          total_recipients: number | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          audience_filter?: Json | null;
          created_at?: string | null;
          delivered_count?: number | null;
          dispatch_lease_until?: string | null;
          failed_count?: number | null;
          header_media_url?: string | null;
          id?: string;
          name: string;
          read_count?: number | null;
          replied_count?: number | null;
          scheduled_at?: string | null;
          sent_count?: number | null;
          status?: string;
          template_language?: string;
          template_name: string;
          template_variables?: Json | null;
          total_recipients?: number | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          audience_filter?: Json | null;
          created_at?: string | null;
          delivered_count?: number | null;
          dispatch_lease_until?: string | null;
          failed_count?: number | null;
          header_media_url?: string | null;
          id?: string;
          name?: string;
          read_count?: number | null;
          replied_count?: number | null;
          scheduled_at?: string | null;
          sent_count?: number | null;
          status?: string;
          template_language?: string;
          template_name?: string;
          template_variables?: Json | null;
          total_recipients?: number | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'broadcasts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'broadcasts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      bug_reports: {
        Row: {
          account_id: string;
          admin_notes: string | null;
          body: string;
          build_id: string | null;
          created_at: string;
          github_issue_url: string | null;
          id: string;
          page_url: string | null;
          reference: string;
          reported_by_user_id: string | null;
          screenshot_path: string | null;
          severity: Database['public']['Enums']['bug_severity'];
          status: Database['public']['Enums']['bug_status'];
          title: string;
          updated_at: string;
          user_agent: string | null;
        };
        Insert: {
          account_id: string;
          admin_notes?: string | null;
          body?: string;
          build_id?: string | null;
          created_at?: string;
          github_issue_url?: string | null;
          id?: string;
          page_url?: string | null;
          reference: string;
          reported_by_user_id?: string | null;
          screenshot_path?: string | null;
          severity?: Database['public']['Enums']['bug_severity'];
          status?: Database['public']['Enums']['bug_status'];
          title: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Update: {
          account_id?: string;
          admin_notes?: string | null;
          body?: string;
          build_id?: string | null;
          created_at?: string;
          github_issue_url?: string | null;
          id?: string;
          page_url?: string | null;
          reference?: string;
          reported_by_user_id?: string | null;
          screenshot_path?: string | null;
          severity?: Database['public']['Enums']['bug_severity'];
          status?: Database['public']['Enums']['bug_status'];
          title?: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bug_reports_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'bug_reports_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      buyer_alert_deliveries: {
        Row: {
          account_id: string;
          attempt_count: number;
          claimed_at: string | null;
          contact_id: string;
          created_at: string;
          delivered_at: string | null;
          due_at: string;
          id: string;
          last_error: string | null;
          property_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          attempt_count?: number;
          claimed_at?: string | null;
          contact_id: string;
          created_at?: string;
          delivered_at?: string | null;
          due_at?: string;
          id?: string;
          last_error?: string | null;
          property_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          attempt_count?: number;
          claimed_at?: string | null;
          contact_id?: string;
          created_at?: string;
          delivered_at?: string | null;
          due_at?: string;
          id?: string;
          last_error?: string | null;
          property_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'buyer_alert_deliveries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'buyer_alert_deliveries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_alert_deliveries_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_alert_deliveries_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      buyer_contact_links: {
        Row: {
          account_id: string;
          buyer_user_id: string;
          contact_id: string;
          created_at: string;
          id: string;
          phone_at_link: string | null;
          status: string;
        };
        Insert: {
          account_id: string;
          buyer_user_id: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          phone_at_link?: string | null;
          status?: string;
        };
        Update: {
          account_id?: string;
          buyer_user_id?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          phone_at_link?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'buyer_contact_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'buyer_contact_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_contact_links_buyer_user_id_fkey';
            columns: ['buyer_user_id'];
            isOneToOne: false;
            referencedRelation: 'buyer_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_contact_links_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      buyer_match_digest_log: {
        Row: {
          account_id: string;
          buyer_contact_id: string;
          channel: string | null;
          created_at: string;
          digest_date: string;
          id: string;
          property_ids: string[];
        };
        Insert: {
          account_id: string;
          buyer_contact_id: string;
          channel?: string | null;
          created_at?: string;
          digest_date: string;
          id?: string;
          property_ids?: string[];
        };
        Update: {
          account_id?: string;
          buyer_contact_id?: string;
          channel?: string | null;
          created_at?: string;
          digest_date?: string;
          id?: string;
          property_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'buyer_match_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'buyer_match_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_match_digest_log_buyer_contact_id_fkey';
            columns: ['buyer_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      buyer_shortlist_items: {
        Row: {
          account_id: string;
          buyer_user_id: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          property_id: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          buyer_user_id: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          property_id: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          buyer_user_id?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          property_id?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'buyer_shortlist_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'buyer_shortlist_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_shortlist_items_buyer_user_id_fkey';
            columns: ['buyer_user_id'];
            isOneToOne: false;
            referencedRelation: 'buyer_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_shortlist_items_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'buyer_shortlist_items_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      buyer_users: {
        Row: {
          auth_user_id: string;
          created_at: string;
          display_name: string | null;
          id: string;
          notify_matches: boolean;
          phone: string;
          phone_normalized: string;
          updated_at: string;
        };
        Insert: {
          auth_user_id: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          notify_matches?: boolean;
          phone: string;
          phone_normalized: string;
          updated_at?: string;
        };
        Update: {
          auth_user_id?: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          notify_matches?: boolean;
          phone?: string;
          phone_normalized?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      closing_deal_nudges: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          item_id: string;
          last_nudged_at: string | null;
          snoozed_until: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          last_nudged_at?: string | null;
          snoozed_until?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          last_nudged_at?: string | null;
          snoozed_until?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'closing_deal_nudges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'closing_deal_nudges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'closing_deal_nudges_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'journey_items';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_call_logs: {
        Row: {
          account_id: string;
          action_items: string[] | null;
          called_at: string;
          contact_id: string;
          created_at: string;
          direction: string;
          disposition: string | null;
          duration_seconds: number | null;
          events_created_at: string | null;
          external_call_id: string | null;
          id: string;
          key_points: string[] | null;
          notes: string | null;
          outcome: string;
          recording_url: string | null;
          source: string;
          summary: string | null;
          transcript: string | null;
          update_draft: string | null;
          update_sent_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          action_items?: string[] | null;
          called_at?: string;
          contact_id: string;
          created_at?: string;
          direction?: string;
          disposition?: string | null;
          duration_seconds?: number | null;
          events_created_at?: string | null;
          external_call_id?: string | null;
          id?: string;
          key_points?: string[] | null;
          notes?: string | null;
          outcome?: string;
          recording_url?: string | null;
          source?: string;
          summary?: string | null;
          transcript?: string | null;
          update_draft?: string | null;
          update_sent_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          action_items?: string[] | null;
          called_at?: string;
          contact_id?: string;
          created_at?: string;
          direction?: string;
          disposition?: string | null;
          duration_seconds?: number | null;
          events_created_at?: string | null;
          external_call_id?: string | null;
          id?: string;
          key_points?: string[] | null;
          notes?: string | null;
          outcome?: string;
          recording_url?: string | null;
          source?: string;
          summary?: string | null;
          transcript?: string | null;
          update_draft?: string | null;
          update_sent_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_call_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_call_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_call_logs_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_custom_values: {
        Row: {
          contact_id: string;
          created_at: string | null;
          custom_field_id: string;
          id: string;
          value: string | null;
        };
        Insert: {
          contact_id: string;
          created_at?: string | null;
          custom_field_id: string;
          id?: string;
          value?: string | null;
        };
        Update: {
          contact_id?: string;
          created_at?: string | null;
          custom_field_id?: string;
          id?: string;
          value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_custom_values_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_custom_values_custom_field_id_fkey';
            columns: ['custom_field_id'];
            isOneToOne: false;
            referencedRelation: 'custom_fields';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_draft_sessions: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          draft_data: Json;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          draft_data?: Json;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          draft_data?: Json;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_draft_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_draft_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_draft_sessions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: true;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_duplicate_dismissals: {
        Row: {
          account_id: string;
          contact_a_id: string;
          contact_b_id: string;
          created_at: string;
          dismissed_by: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_a_id: string;
          contact_b_id: string;
          created_at?: string;
          dismissed_by?: string | null;
          id?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_a_id?: string;
          contact_b_id?: string;
          created_at?: string;
          dismissed_by?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_duplicate_dismissals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_duplicate_dismissals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_duplicate_dismissals_contact_a_id_fkey';
            columns: ['contact_a_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_duplicate_dismissals_contact_b_id_fkey';
            columns: ['contact_b_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_merge_log: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          merged_by: string | null;
          source_id: string;
          source_snapshot: Json | null;
          target_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          merged_by?: string | null;
          source_id: string;
          source_snapshot?: Json | null;
          target_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          merged_by?: string | null;
          source_id?: string;
          source_snapshot?: Json | null;
          target_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_merge_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_merge_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_merge_log_target_id_fkey';
            columns: ['target_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_notes: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string | null;
          id: string;
          is_completed: boolean;
          note_text: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string | null;
          id?: string;
          is_completed?: boolean;
          note_text: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          is_completed?: boolean;
          note_text?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_notes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_notes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_notes_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_parties: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          kind: string;
          name: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_parties_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_parties_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_party_members: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          id: string;
          is_primary: boolean;
          party_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          party_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          party_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_party_members_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_party_members_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_party_members_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_party_members_party_id_fkey';
            columns: ['party_id'];
            isOneToOne: false;
            referencedRelation: 'contact_parties';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_property_inquiries: {
        Row: {
          account_id: string | null;
          contact_id: string;
          created_at: string | null;
          id: string;
          inquiry_date: string | null;
          inquiry_source: string | null;
          notes: string | null;
          property_id: string;
          via_portal_link: boolean;
        };
        Insert: {
          account_id?: string | null;
          contact_id: string;
          created_at?: string | null;
          id?: string;
          inquiry_date?: string | null;
          inquiry_source?: string | null;
          notes?: string | null;
          property_id: string;
          via_portal_link?: boolean;
        };
        Update: {
          account_id?: string | null;
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          inquiry_date?: string | null;
          inquiry_source?: string | null;
          notes?: string | null;
          property_id?: string;
          via_portal_link?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_property_inquiries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contact_property_inquiries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_property_inquiries_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_property_inquiries_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_tags: {
        Row: {
          contact_id: string;
          created_at: string | null;
          id: string;
          tag_id: string;
        };
        Insert: {
          contact_id: string;
          created_at?: string | null;
          id?: string;
          tag_id: string;
        };
        Update: {
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_tags_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_tags_tag_id_fkey';
            columns: ['tag_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id'];
          },
        ];
      };
      contacts: {
        Row: {
          account_id: string;
          archived_at: string | null;
          areas_of_interest: string[] | null;
          areas_of_interest_geo: Json | null;
          assigned_agent_id: string | null;
          assigned_team_id: string | null;
          avatar_url: string | null;
          buyer_alerts_consent: string;
          buyer_alerts_consent_requested_at: string | null;
          chain_only: boolean;
          classification: string;
          company: string | null;
          copilot_search_text: string | null;
          created_at: string | null;
          dead_at: string | null;
          dead_reason: string | null;
          do_not_call: boolean;
          dob: string | null;
          email: string | null;
          feedback_status: string;
          id: string;
          is_archived: boolean;
          is_dead: boolean;
          is_favorite: boolean;
          is_merged: boolean;
          last_contacted_at: string | null;
          last_inquired_property_id: string | null;
          lead_portal: string | null;
          lead_portal_listing_id: string | null;
          lead_temp: string | null;
          max_budget: number | null;
          merged_into_id: string | null;
          min_budget: number | null;
          min_roi: number | null;
          name: string | null;
          name_tag: string | null;
          no_budget: boolean | null;
          owner_digest_consent: string;
          owner_digest_consent_requested_at: string | null;
          phone: string | null;
          pitch_quiet_until: string | null;
          pref_areas: string[] | null;
          pref_bhk_max: number | null;
          pref_bhk_min: number | null;
          pref_budget_max: number | null;
          pref_budget_min: number | null;
          pref_excluded_areas: string[] | null;
          pref_extracted_at: string | null;
          pref_land_area_max_sqft: number | null;
          pref_land_area_min_sqft: number | null;
          pref_listing_types: string[] | null;
          pref_min_roi: number | null;
          pref_projects: string[] | null;
          pref_property_categories: string[] | null;
          pref_property_types: string[] | null;
          pref_requires_tenanted: boolean;
          pref_source_hash: string | null;
          pref_suggested_tags: string[] | null;
          preferred_language: string | null;
          preferred_update_channel: string | null;
          projects_of_interest: string[] | null;
          property_interests: string[] | null;
          referrer: string | null;
          referrer_contact_id: string | null;
          requirement_active: boolean;
          requirement_profiles: Json;
          requirements: string | null;
          requires_tenanted: boolean | null;
          salutation: string | null;
          second_name: string | null;
          secondary_phones: string[];
          seller_page_slug: string | null;
          source: string | null;
          status: string;
          strict_area_match: boolean | null;
          strict_project_match: boolean | null;
          updated_at: string | null;
          user_id: string;
          whatsapp_marketing_suppressed_until: string | null;
          whatsapp_marketing_suppression_code: number | null;
          whatsapp_phone_confirmed_at: string | null;
        };
        Insert: {
          account_id: string;
          archived_at?: string | null;
          areas_of_interest?: string[] | null;
          areas_of_interest_geo?: Json | null;
          assigned_agent_id?: string | null;
          assigned_team_id?: string | null;
          avatar_url?: string | null;
          buyer_alerts_consent?: string;
          buyer_alerts_consent_requested_at?: string | null;
          chain_only?: boolean;
          classification?: string;
          company?: string | null;
          copilot_search_text?: string | null;
          created_at?: string | null;
          dead_at?: string | null;
          dead_reason?: string | null;
          do_not_call?: boolean;
          dob?: string | null;
          email?: string | null;
          feedback_status?: string;
          id?: string;
          is_archived?: boolean;
          is_dead?: boolean;
          is_favorite?: boolean;
          is_merged?: boolean;
          last_contacted_at?: string | null;
          last_inquired_property_id?: string | null;
          lead_portal?: string | null;
          lead_portal_listing_id?: string | null;
          lead_temp?: string | null;
          max_budget?: number | null;
          merged_into_id?: string | null;
          min_budget?: number | null;
          min_roi?: number | null;
          name?: string | null;
          name_tag?: string | null;
          no_budget?: boolean | null;
          owner_digest_consent?: string;
          owner_digest_consent_requested_at?: string | null;
          phone?: string | null;
          pitch_quiet_until?: string | null;
          pref_areas?: string[] | null;
          pref_bhk_max?: number | null;
          pref_bhk_min?: number | null;
          pref_budget_max?: number | null;
          pref_budget_min?: number | null;
          pref_excluded_areas?: string[] | null;
          pref_extracted_at?: string | null;
          pref_land_area_max_sqft?: number | null;
          pref_land_area_min_sqft?: number | null;
          pref_listing_types?: string[] | null;
          pref_min_roi?: number | null;
          pref_projects?: string[] | null;
          pref_property_categories?: string[] | null;
          pref_property_types?: string[] | null;
          pref_requires_tenanted?: boolean;
          pref_source_hash?: string | null;
          pref_suggested_tags?: string[] | null;
          preferred_language?: string | null;
          preferred_update_channel?: string | null;
          projects_of_interest?: string[] | null;
          property_interests?: string[] | null;
          referrer?: string | null;
          referrer_contact_id?: string | null;
          requirement_active?: boolean;
          requirement_profiles?: Json;
          requirements?: string | null;
          requires_tenanted?: boolean | null;
          salutation?: string | null;
          second_name?: string | null;
          secondary_phones?: string[];
          seller_page_slug?: string | null;
          source?: string | null;
          status?: string;
          strict_area_match?: boolean | null;
          strict_project_match?: boolean | null;
          updated_at?: string | null;
          user_id: string;
          whatsapp_marketing_suppressed_until?: string | null;
          whatsapp_marketing_suppression_code?: number | null;
          whatsapp_phone_confirmed_at?: string | null;
        };
        Update: {
          account_id?: string;
          archived_at?: string | null;
          areas_of_interest?: string[] | null;
          areas_of_interest_geo?: Json | null;
          assigned_agent_id?: string | null;
          assigned_team_id?: string | null;
          avatar_url?: string | null;
          buyer_alerts_consent?: string;
          buyer_alerts_consent_requested_at?: string | null;
          chain_only?: boolean;
          classification?: string;
          company?: string | null;
          copilot_search_text?: string | null;
          created_at?: string | null;
          dead_at?: string | null;
          dead_reason?: string | null;
          do_not_call?: boolean;
          dob?: string | null;
          email?: string | null;
          feedback_status?: string;
          id?: string;
          is_archived?: boolean;
          is_dead?: boolean;
          is_favorite?: boolean;
          is_merged?: boolean;
          last_contacted_at?: string | null;
          last_inquired_property_id?: string | null;
          lead_portal?: string | null;
          lead_portal_listing_id?: string | null;
          lead_temp?: string | null;
          max_budget?: number | null;
          merged_into_id?: string | null;
          min_budget?: number | null;
          min_roi?: number | null;
          name?: string | null;
          name_tag?: string | null;
          no_budget?: boolean | null;
          owner_digest_consent?: string;
          owner_digest_consent_requested_at?: string | null;
          phone?: string | null;
          pitch_quiet_until?: string | null;
          pref_areas?: string[] | null;
          pref_bhk_max?: number | null;
          pref_bhk_min?: number | null;
          pref_budget_max?: number | null;
          pref_budget_min?: number | null;
          pref_excluded_areas?: string[] | null;
          pref_extracted_at?: string | null;
          pref_land_area_max_sqft?: number | null;
          pref_land_area_min_sqft?: number | null;
          pref_listing_types?: string[] | null;
          pref_min_roi?: number | null;
          pref_projects?: string[] | null;
          pref_property_categories?: string[] | null;
          pref_property_types?: string[] | null;
          pref_requires_tenanted?: boolean;
          pref_source_hash?: string | null;
          pref_suggested_tags?: string[] | null;
          preferred_language?: string | null;
          preferred_update_channel?: string | null;
          projects_of_interest?: string[] | null;
          property_interests?: string[] | null;
          referrer?: string | null;
          referrer_contact_id?: string | null;
          requirement_active?: boolean;
          requirement_profiles?: Json;
          requirements?: string | null;
          requires_tenanted?: boolean | null;
          salutation?: string | null;
          second_name?: string | null;
          secondary_phones?: string[];
          seller_page_slug?: string | null;
          source?: string | null;
          status?: string;
          strict_area_match?: boolean | null;
          strict_project_match?: boolean | null;
          updated_at?: string | null;
          user_id?: string;
          whatsapp_marketing_suppressed_until?: string | null;
          whatsapp_marketing_suppression_code?: number | null;
          whatsapp_phone_confirmed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'contacts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_assigned_agent_id_fkey';
            columns: ['assigned_agent_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'contacts_assigned_team_id_fkey';
            columns: ['assigned_team_id'];
            isOneToOne: false;
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_last_inquired_property_id_fkey';
            columns: ['last_inquired_property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_merged_into_id_fkey';
            columns: ['merged_into_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_referrer_contact_id_fkey';
            columns: ['referrer_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_deferred_messages: {
        Row: {
          account_id: string;
          conversation_id: string;
          created_at: string | null;
          id: string;
          message_id: string;
          payload: Json;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          conversation_id: string;
          created_at?: string | null;
          id?: string;
          message_id: string;
          payload: Json;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          conversation_id?: string;
          created_at?: string | null;
          id?: string;
          message_id?: string;
          payload?: Json;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_deferred_messages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'conversation_deferred_messages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_deferred_messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_gaps: {
        Row: {
          account_id: string;
          assigned_agent_id: string | null;
          channel: string;
          contact_id: string | null;
          conversation_id: string | null;
          created_at: string;
          dedupe_key: string;
          evidence: string;
          id: string;
          kind: string;
          occurred_at: string;
          occurrence_count: number;
          property_id: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: string;
          status: string;
          suggested_action: string | null;
          summary: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          assigned_agent_id?: string | null;
          channel?: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          dedupe_key: string;
          evidence: string;
          id?: string;
          kind: string;
          occurred_at?: string;
          occurrence_count?: number;
          property_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          status?: string;
          suggested_action?: string | null;
          summary: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          assigned_agent_id?: string | null;
          channel?: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          dedupe_key?: string;
          evidence?: string;
          id?: string;
          kind?: string;
          occurred_at?: string;
          occurrence_count?: number;
          property_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          status?: string;
          suggested_action?: string | null;
          summary?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_gaps_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'conversation_gaps_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_gaps_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_gaps_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_gaps_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_qualification_leases: {
        Row: {
          account_id: string;
          conversation_id: string;
          created_at: string | null;
          expires_at: string;
          holder: string;
          id: string;
          pending_message_ids: string[];
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          conversation_id: string;
          created_at?: string | null;
          expires_at: string;
          holder: string;
          id?: string;
          pending_message_ids?: string[];
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          conversation_id?: string;
          created_at?: string | null;
          expires_at?: string;
          holder?: string;
          id?: string;
          pending_message_ids?: string[];
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_qualification_leases_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'conversation_qualification_leases_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_qualification_leases_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: true;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_sweep_runs: {
        Row: {
          account_id: string;
          created_at: string;
          credits_burned: number;
          detail: string | null;
          facts_applied: number;
          facts_proposed: number;
          gaps_opened: number;
          id: string;
          run_date: string;
          status: string;
          threads_analyzed: number;
          threads_seen: number;
          updated_at: string;
          window_end: string;
          window_start: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          credits_burned?: number;
          detail?: string | null;
          facts_applied?: number;
          facts_proposed?: number;
          gaps_opened?: number;
          id?: string;
          run_date: string;
          status?: string;
          threads_analyzed?: number;
          threads_seen?: number;
          updated_at?: string;
          window_end: string;
          window_start: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          credits_burned?: number;
          detail?: string | null;
          facts_applied?: number;
          facts_proposed?: number;
          gaps_opened?: number;
          id?: string;
          run_date?: string;
          status?: string;
          threads_analyzed?: number;
          threads_seen?: number;
          updated_at?: string;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_sweep_runs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'conversation_sweep_runs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      conversations: {
        Row: {
          account_id: string;
          assigned_agent_id: string | null;
          assigned_at: string | null;
          assigned_by: string | null;
          assigned_team_id: string | null;
          awaiting_reply: boolean;
          close_note: string | null;
          close_reason: string | null;
          closed_at: string | null;
          contact_id: string | null;
          created_at: string | null;
          group_id: string | null;
          id: string;
          is_archived: boolean;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_text: string | null;
          routing_rule_used: string | null;
          status: string;
          unread_count: number | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          assigned_agent_id?: string | null;
          assigned_at?: string | null;
          assigned_by?: string | null;
          assigned_team_id?: string | null;
          awaiting_reply?: boolean;
          close_note?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          contact_id?: string | null;
          created_at?: string | null;
          group_id?: string | null;
          id?: string;
          is_archived?: boolean;
          last_customer_message_at?: string | null;
          last_message_at?: string | null;
          last_message_text?: string | null;
          routing_rule_used?: string | null;
          status?: string;
          unread_count?: number | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          assigned_agent_id?: string | null;
          assigned_at?: string | null;
          assigned_by?: string | null;
          assigned_team_id?: string | null;
          awaiting_reply?: boolean;
          close_note?: string | null;
          close_reason?: string | null;
          closed_at?: string | null;
          contact_id?: string | null;
          created_at?: string | null;
          group_id?: string | null;
          id?: string;
          is_archived?: boolean;
          last_customer_message_at?: string | null;
          last_message_at?: string | null;
          last_message_text?: string | null;
          routing_rule_used?: string | null;
          status?: string;
          unread_count?: number | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'conversations_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_assigned_by_fkey';
            columns: ['assigned_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'conversations_assigned_team_id_fkey';
            columns: ['assigned_team_id'];
            isOneToOne: false;
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'whatsapp_groups';
            referencedColumns: ['id'];
          },
        ];
      };
      copilot_action_executions: {
        Row: {
          account_id: string;
          action_type: string;
          actor_user_id: string | null;
          after_state: Json;
          before_state: Json;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          idempotency_key: string;
          outcome: string;
          source_platform: string;
        };
        Insert: {
          account_id: string;
          action_type: string;
          actor_user_id?: string | null;
          after_state?: Json;
          before_state?: Json;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          idempotency_key: string;
          outcome: string;
          source_platform: string;
        };
        Update: {
          account_id?: string;
          action_type?: string;
          actor_user_id?: string | null;
          after_state?: Json;
          before_state?: Json;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          idempotency_key?: string;
          outcome?: string;
          source_platform?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'copilot_action_executions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'copilot_action_executions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      copilot_events: {
        Row: {
          account_id: string;
          audience: string;
          cached: boolean;
          coverage: string | null;
          created_at: string;
          event: string;
          id: string;
          platform: string;
          tour_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          audience?: string;
          cached?: boolean;
          coverage?: string | null;
          created_at?: string;
          event: string;
          id?: string;
          platform?: string;
          tour_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          audience?: string;
          cached?: boolean;
          coverage?: string | null;
          created_at?: string;
          event?: string;
          id?: string;
          platform?: string;
          tour_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'copilot_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'copilot_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      copilot_qa_cache: {
        Row: {
          coverage: string | null;
          created_at: string;
          down_votes: number;
          embedding: string;
          hit_count: number;
          id: string;
          kb_version: string;
          last_used_at: string;
          navigate_to: string | null;
          question: string;
          reply: string;
          source_chunks: Json | null;
          tour_id: string | null;
          unsupported_capability: string | null;
          up_votes: number;
        };
        Insert: {
          coverage?: string | null;
          created_at?: string;
          down_votes?: number;
          embedding: string;
          hit_count?: number;
          id?: string;
          kb_version: string;
          last_used_at?: string;
          navigate_to?: string | null;
          question: string;
          reply: string;
          source_chunks?: Json | null;
          tour_id?: string | null;
          unsupported_capability?: string | null;
          up_votes?: number;
        };
        Update: {
          coverage?: string | null;
          created_at?: string;
          down_votes?: number;
          embedding?: string;
          hit_count?: number;
          id?: string;
          kb_version?: string;
          last_used_at?: string;
          navigate_to?: string | null;
          question?: string;
          reply?: string;
          source_chunks?: Json | null;
          tour_id?: string | null;
          unsupported_capability?: string | null;
          up_votes?: number;
        };
        Relationships: [];
      };
      copilot_unmet_requests: {
        Row: {
          account_id: string;
          audience: string;
          capability: string;
          capability_key: string;
          created_at: string;
          id: string;
          last_requested_at: string;
          pathname: string | null;
          request_count: number;
          sample_question: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          audience?: string;
          capability: string;
          capability_key: string;
          created_at?: string;
          id?: string;
          last_requested_at?: string;
          pathname?: string | null;
          request_count?: number;
          sample_question: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          audience?: string;
          capability?: string;
          capability_key?: string;
          created_at?: string;
          id?: string;
          last_requested_at?: string;
          pathname?: string | null;
          request_count?: number;
          sample_question?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'copilot_unmet_requests_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'copilot_unmet_requests_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      credit_package_prices: {
        Row: {
          amount_minor: number;
          currency: string;
          gateway: string;
          id: string;
          is_active: boolean;
          package_id: string;
        };
        Insert: {
          amount_minor: number;
          currency: string;
          gateway: string;
          id?: string;
          is_active?: boolean;
          package_id: string;
        };
        Update: {
          amount_minor?: number;
          currency?: string;
          gateway?: string;
          id?: string;
          is_active?: boolean;
          package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credit_package_prices_package_id_fkey';
            columns: ['package_id'];
            isOneToOne: false;
            referencedRelation: 'credit_packages';
            referencedColumns: ['id'];
          },
        ];
      };
      credit_packages: {
        Row: {
          created_at: string;
          credits: number;
          display_order: number;
          id: string;
          is_active: boolean;
          key: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          credits: number;
          display_order?: number;
          id?: string;
          is_active?: boolean;
          key: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          credits?: number;
          display_order?: number;
          id?: string;
          is_active?: boolean;
          key?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          account_id: string;
          ai_feature: string | null;
          amount: number;
          balance_after: number;
          bucket: string;
          created_at: string;
          description: string | null;
          expires_at: string | null;
          gateway_order_id: string | null;
          gateway_payment_id: string | null;
          id: string;
          payment_gateway: string | null;
          related_account_id: string | null;
          type: string;
        };
        Insert: {
          account_id: string;
          ai_feature?: string | null;
          amount: number;
          balance_after: number;
          bucket: string;
          created_at?: string;
          description?: string | null;
          expires_at?: string | null;
          gateway_order_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          payment_gateway?: string | null;
          related_account_id?: string | null;
          type: string;
        };
        Update: {
          account_id?: string;
          ai_feature?: string | null;
          amount?: number;
          balance_after?: number;
          bucket?: string;
          created_at?: string;
          description?: string | null;
          expires_at?: string | null;
          gateway_order_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          payment_gateway?: string | null;
          related_account_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credit_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'credit_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'credit_transactions_related_account_id_fkey';
            columns: ['related_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'credit_transactions_related_account_id_fkey';
            columns: ['related_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      credit_wallets: {
        Row: {
          account_id: string;
          bonus_credits: number;
          created_at: string;
          id: string;
          monthly_credits: number;
          monthly_reset_at: string | null;
          paid_referral_count: number;
          pending_referral_credits: number;
          promo_credits: number;
          purchased_credits: number;
          referral_code: string;
          referral_credits: number;
          referral_tier: string;
          total_credits: number;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          bonus_credits?: number;
          created_at?: string;
          id?: string;
          monthly_credits?: number;
          monthly_reset_at?: string | null;
          paid_referral_count?: number;
          pending_referral_credits?: number;
          promo_credits?: number;
          purchased_credits?: number;
          referral_code: string;
          referral_credits?: number;
          referral_tier?: string;
          total_credits?: number;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          bonus_credits?: number;
          created_at?: string;
          id?: string;
          monthly_credits?: number;
          monthly_reset_at?: string | null;
          paid_referral_count?: number;
          pending_referral_credits?: number;
          promo_credits?: number;
          purchased_credits?: number;
          referral_code?: string;
          referral_credits?: number;
          referral_tier?: string;
          total_credits?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credit_wallets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'credit_wallets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      ctwa_referrals: {
        Row: {
          account_id: string;
          body: string | null;
          contact_id: string;
          conversation_id: string | null;
          created_at: string;
          ctwa_clid: string | null;
          headline: string | null;
          id: string;
          image_url: string | null;
          media_type: string | null;
          message_id: string | null;
          source_id: string | null;
          source_type: string | null;
          source_url: string | null;
          video_url: string | null;
        };
        Insert: {
          account_id: string;
          body?: string | null;
          contact_id: string;
          conversation_id?: string | null;
          created_at?: string;
          ctwa_clid?: string | null;
          headline?: string | null;
          id?: string;
          image_url?: string | null;
          media_type?: string | null;
          message_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          source_url?: string | null;
          video_url?: string | null;
        };
        Update: {
          account_id?: string;
          body?: string | null;
          contact_id?: string;
          conversation_id?: string | null;
          created_at?: string;
          ctwa_clid?: string | null;
          headline?: string | null;
          id?: string;
          image_url?: string | null;
          media_type?: string | null;
          message_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          source_url?: string | null;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ctwa_referrals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'ctwa_referrals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ctwa_referrals_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ctwa_referrals_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      custom_fields: {
        Row: {
          account_id: string;
          created_at: string | null;
          field_name: string;
          field_options: Json | null;
          field_type: string;
          id: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          field_name: string;
          field_options?: Json | null;
          field_type?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          field_name?: string;
          field_options?: Json | null;
          field_type?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'custom_fields_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'custom_fields_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_co_broker_payouts: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          created_by: string | null;
          deal_id: string;
          id: string;
          instrument_ref: string | null;
          notes: string | null;
          paid_amount: number | null;
          paid_at: string | null;
          payee_name: string;
          position: number;
          share_percent: number | null;
          side: string | null;
          stakeholder_id: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          created_by?: string | null;
          deal_id: string;
          id?: string;
          instrument_ref?: string | null;
          notes?: string | null;
          paid_amount?: number | null;
          paid_at?: string | null;
          payee_name: string;
          position?: number;
          share_percent?: number | null;
          side?: string | null;
          stakeholder_id?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          deal_id?: string;
          id?: string;
          instrument_ref?: string | null;
          notes?: string | null;
          paid_amount?: number | null;
          paid_at?: string | null;
          payee_name?: string;
          position?: number;
          share_percent?: number | null;
          side?: string | null;
          stakeholder_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_co_broker_payouts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_co_broker_payouts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_co_broker_payouts_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_co_broker_payouts_stakeholder_id_fkey';
            columns: ['stakeholder_id'];
            isOneToOne: false;
            referencedRelation: 'deal_stakeholders';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_documents: {
        Row: {
          account_id: string;
          category: string;
          contact_id: string | null;
          created_at: string;
          deal_id: string;
          expires_at: string | null;
          extracted: Json | null;
          extracted_at: string | null;
          extraction_error: string | null;
          extraction_status: string | null;
          id: string;
          mime_type: string | null;
          size_bytes: number | null;
          status: string | null;
          storage_path: string;
          superseded_at: string | null;
          superseded_by: string | null;
          title: string;
          updated_at: string;
          uploaded_by: string | null;
          visibility: string;
        };
        Insert: {
          account_id: string;
          category?: string;
          contact_id?: string | null;
          created_at?: string;
          deal_id: string;
          expires_at?: string | null;
          extracted?: Json | null;
          extracted_at?: string | null;
          extraction_error?: string | null;
          extraction_status?: string | null;
          id?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          status?: string | null;
          storage_path: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
          title: string;
          updated_at?: string;
          uploaded_by?: string | null;
          visibility?: string;
        };
        Update: {
          account_id?: string;
          category?: string;
          contact_id?: string | null;
          created_at?: string;
          deal_id?: string;
          expires_at?: string | null;
          extracted?: Json | null;
          extracted_at?: string | null;
          extraction_error?: string | null;
          extraction_status?: string | null;
          id?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          status?: string | null;
          storage_path?: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
          title?: string;
          updated_at?: string;
          uploaded_by?: string | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_documents_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_documents_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_documents_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_documents_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_documents_superseded_by_fkey';
            columns: ['superseded_by'];
            isOneToOne: false;
            referencedRelation: 'deal_documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_documents_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_events: {
        Row: {
          account_id: string;
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          deal_id: string;
          dedupe_key: string | null;
          event_type: string;
          id: string;
          metadata: Json;
          source: string;
          title: string;
          visibility: string;
        };
        Insert: {
          account_id: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          deal_id: string;
          dedupe_key?: string | null;
          event_type: string;
          id?: string;
          metadata?: Json;
          source?: string;
          title: string;
          visibility?: string;
        };
        Update: {
          account_id?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          deal_id?: string;
          dedupe_key?: string | null;
          event_type?: string;
          id?: string;
          metadata?: Json;
          source?: string;
          title?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_events_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_groups: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_groups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_groups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_milestones: {
        Row: {
          account_id: string;
          completed_at: string | null;
          created_at: string;
          deal_id: string;
          id: string;
          notes: string | null;
          owner_id: string | null;
          position: number;
          status: string;
          target_date: string | null;
          template_key: string | null;
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          account_id: string;
          completed_at?: string | null;
          created_at?: string;
          deal_id: string;
          id?: string;
          notes?: string | null;
          owner_id?: string | null;
          position?: number;
          status?: string;
          target_date?: string | null;
          template_key?: string | null;
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          account_id?: string;
          completed_at?: string | null;
          created_at?: string;
          deal_id?: string;
          id?: string;
          notes?: string | null;
          owner_id?: string | null;
          position?: number;
          status?: string;
          target_date?: string | null;
          template_key?: string | null;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_milestones_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_milestones_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_milestones_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_payment_tranches: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          created_by: string | null;
          deal_id: string;
          due_date: string | null;
          id: string;
          instrument_ref: string | null;
          label: string;
          notes: string | null;
          position: number;
          received_amount: number | null;
          received_at: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          created_by?: string | null;
          deal_id: string;
          due_date?: string | null;
          id?: string;
          instrument_ref?: string | null;
          label: string;
          notes?: string | null;
          position?: number;
          received_amount?: number | null;
          received_at?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          deal_id?: string;
          due_date?: string | null;
          id?: string;
          instrument_ref?: string | null;
          label?: string;
          notes?: string | null;
          position?: number;
          received_amount?: number | null;
          received_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_payment_tranches_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_payment_tranches_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_payment_tranches_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_rooms: {
        Row: {
          agreed_amount: number;
          bid_id: string;
          bidder_account_id: string;
          created_at: string;
          id: string;
          meeting_at: string | null;
          notes: string | null;
          owner_account_id: string;
          property_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          agreed_amount: number;
          bid_id: string;
          bidder_account_id: string;
          created_at?: string;
          id?: string;
          meeting_at?: string | null;
          notes?: string | null;
          owner_account_id: string;
          property_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          agreed_amount?: number;
          bid_id?: string;
          bidder_account_id?: string;
          created_at?: string;
          id?: string;
          meeting_at?: string | null;
          notes?: string | null;
          owner_account_id?: string;
          property_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_rooms_bid_id_fkey';
            columns: ['bid_id'];
            isOneToOne: true;
            referencedRelation: 'property_bids';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_rooms_bidder_account_id_fkey';
            columns: ['bidder_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_rooms_bidder_account_id_fkey';
            columns: ['bidder_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_rooms_owner_account_id_fkey';
            columns: ['owner_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_rooms_owner_account_id_fkey';
            columns: ['owner_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_rooms_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_share_access_log: {
        Row: {
          account_id: string;
          created_at: string;
          deal_id: string;
          document_id: string | null;
          event: string;
          id: string;
          ip_hash: string | null;
          link_id: string;
          user_agent: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          deal_id: string;
          document_id?: string | null;
          event: string;
          id?: string;
          ip_hash?: string | null;
          link_id: string;
          user_agent?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          deal_id?: string;
          document_id?: string | null;
          event?: string;
          id?: string;
          ip_hash?: string | null;
          link_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_share_access_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_share_access_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_share_access_log_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_share_access_log_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'deal_documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_share_access_log_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'deal_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_share_links: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          deal_id: string;
          expires_at: string;
          id: string;
          last_viewed_at: string | null;
          otp_required: boolean;
          revoked_at: string | null;
          stakeholder_id: string;
          token_hash: string;
          token_prefix: string;
          updated_at: string;
          view_count: number;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string | null;
          deal_id: string;
          expires_at: string;
          id?: string;
          last_viewed_at?: string | null;
          otp_required?: boolean;
          revoked_at?: string | null;
          stakeholder_id: string;
          token_hash: string;
          token_prefix: string;
          updated_at?: string;
          view_count?: number;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string | null;
          deal_id?: string;
          expires_at?: string;
          id?: string;
          last_viewed_at?: string | null;
          otp_required?: boolean;
          revoked_at?: string | null;
          stakeholder_id?: string;
          token_hash?: string;
          token_prefix?: string;
          updated_at?: string;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_share_links_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_share_links_stakeholder_id_fkey';
            columns: ['stakeholder_id'];
            isOneToOne: false;
            referencedRelation: 'deal_stakeholders';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_share_otp_challenges: {
        Row: {
          attempts: number;
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          link_id: string;
          verified_at: string | null;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          link_id: string;
          verified_at?: string | null;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          link_id?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_share_otp_challenges_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'deal_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_stakeholders: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          deal_id: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          role: string;
          side: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deal_id: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          role: string;
          side: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deal_id?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          role?: string;
          side?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_stakeholders_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_stakeholders_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_stakeholders_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_stakeholders_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_update_recipients: {
        Row: {
          account_id: string;
          acknowledged_at: string | null;
          acknowledged_via: string | null;
          channel: string;
          contact_id: string | null;
          created_at: string;
          deal_id: string;
          delivery_mode: string | null;
          failed_reason: string | null;
          id: string;
          link_delivered_at: string | null;
          link_id: string | null;
          link_otp_required: boolean;
          link_ttl_ms: number | null;
          message_id: string | null;
          opened_at: string | null;
          sent_at: string | null;
          stakeholder_id: string;
          status: string;
          update_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          acknowledged_at?: string | null;
          acknowledged_via?: string | null;
          channel: string;
          contact_id?: string | null;
          created_at?: string;
          deal_id: string;
          delivery_mode?: string | null;
          failed_reason?: string | null;
          id?: string;
          link_delivered_at?: string | null;
          link_id?: string | null;
          link_otp_required?: boolean;
          link_ttl_ms?: number | null;
          message_id?: string | null;
          opened_at?: string | null;
          sent_at?: string | null;
          stakeholder_id: string;
          status?: string;
          update_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          acknowledged_at?: string | null;
          acknowledged_via?: string | null;
          channel?: string;
          contact_id?: string | null;
          created_at?: string;
          deal_id?: string;
          delivery_mode?: string | null;
          failed_reason?: string | null;
          id?: string;
          link_delivered_at?: string | null;
          link_id?: string | null;
          link_otp_required?: boolean;
          link_ttl_ms?: number | null;
          message_id?: string | null;
          opened_at?: string | null;
          sent_at?: string | null;
          stakeholder_id?: string;
          status?: string;
          update_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_update_recipients_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_link_id_fkey';
            columns: ['link_id'];
            isOneToOne: false;
            referencedRelation: 'deal_share_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_stakeholder_id_fkey';
            columns: ['stakeholder_id'];
            isOneToOne: false;
            referencedRelation: 'deal_stakeholders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_update_recipients_update_id_fkey';
            columns: ['update_id'];
            isOneToOne: false;
            referencedRelation: 'deal_updates';
            referencedColumns: ['id'];
          },
        ];
      };
      deal_updates: {
        Row: {
          account_id: string;
          body: string | null;
          created_at: string;
          deal_id: string;
          headline: string;
          id: string;
          published_by: string | null;
          published_by_name: string | null;
          snapshot: Json;
          source: string;
          supersedes_update_id: string | null;
          visibility: string;
        };
        Insert: {
          account_id: string;
          body?: string | null;
          created_at?: string;
          deal_id: string;
          headline: string;
          id?: string;
          published_by?: string | null;
          published_by_name?: string | null;
          snapshot?: Json;
          source?: string;
          supersedes_update_id?: string | null;
          visibility: string;
        };
        Update: {
          account_id?: string;
          body?: string | null;
          created_at?: string;
          deal_id?: string;
          headline?: string;
          id?: string;
          published_by?: string | null;
          published_by_name?: string | null;
          snapshot?: Json;
          source?: string;
          supersedes_update_id?: string | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deal_updates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deal_updates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_updates_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deal_updates_supersedes_update_id_fkey';
            columns: ['supersedes_update_id'];
            isOneToOne: false;
            referencedRelation: 'deal_updates';
            referencedColumns: ['id'];
          },
        ];
      };
      deals: {
        Row: {
          account_id: string;
          actual_close_date: string | null;
          agreed_consideration: number | null;
          assigned_to: string | null;
          brokerage_amount: number | null;
          brokerage_paid_at: string | null;
          brokerage_received_amount: number | null;
          brokerage_type: string | null;
          brokerage_value: number | null;
          co_broker_payout_total: number;
          contact_id: string | null;
          conversation_id: string | null;
          created_at: string | null;
          currency: string | null;
          deal_group_id: string | null;
          deal_position: string | null;
          deal_room_id: string | null;
          expected_close_date: string | null;
          id: string;
          lost_note: string | null;
          lost_reason: string | null;
          notes: string | null;
          other_component: number | null;
          payment_instrument_refs: string | null;
          pipeline_id: string;
          property_id: string | null;
          registered_consideration: number | null;
          source_journey_item_id: string | null;
          stage_id: string;
          status: string | null;
          tds_amount: number | null;
          tds_status: string | null;
          title: string;
          token_amount: number | null;
          token_instrument_ref: string | null;
          token_received_at: string | null;
          updated_at: string | null;
          user_id: string;
          value: number;
        };
        Insert: {
          account_id: string;
          actual_close_date?: string | null;
          agreed_consideration?: number | null;
          assigned_to?: string | null;
          brokerage_amount?: number | null;
          brokerage_paid_at?: string | null;
          brokerage_received_amount?: number | null;
          brokerage_type?: string | null;
          brokerage_value?: number | null;
          co_broker_payout_total?: number;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          deal_group_id?: string | null;
          deal_position?: string | null;
          deal_room_id?: string | null;
          expected_close_date?: string | null;
          id?: string;
          lost_note?: string | null;
          lost_reason?: string | null;
          notes?: string | null;
          other_component?: number | null;
          payment_instrument_refs?: string | null;
          pipeline_id: string;
          property_id?: string | null;
          registered_consideration?: number | null;
          source_journey_item_id?: string | null;
          stage_id: string;
          status?: string | null;
          tds_amount?: number | null;
          tds_status?: string | null;
          title: string;
          token_amount?: number | null;
          token_instrument_ref?: string | null;
          token_received_at?: string | null;
          updated_at?: string | null;
          user_id: string;
          value?: number;
        };
        Update: {
          account_id?: string;
          actual_close_date?: string | null;
          agreed_consideration?: number | null;
          assigned_to?: string | null;
          brokerage_amount?: number | null;
          brokerage_paid_at?: string | null;
          brokerage_received_amount?: number | null;
          brokerage_type?: string | null;
          brokerage_value?: number | null;
          co_broker_payout_total?: number;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          deal_group_id?: string | null;
          deal_position?: string | null;
          deal_room_id?: string | null;
          expected_close_date?: string | null;
          id?: string;
          lost_note?: string | null;
          lost_reason?: string | null;
          notes?: string | null;
          other_component?: number | null;
          payment_instrument_refs?: string | null;
          pipeline_id?: string;
          property_id?: string | null;
          registered_consideration?: number | null;
          source_journey_item_id?: string | null;
          stage_id?: string;
          status?: string | null;
          tds_amount?: number | null;
          tds_status?: string | null;
          title?: string;
          token_amount?: number | null;
          token_instrument_ref?: string | null;
          token_received_at?: string | null;
          updated_at?: string | null;
          user_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'deals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_deal_group_id_fkey';
            columns: ['deal_group_id'];
            isOneToOne: false;
            referencedRelation: 'deal_groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_deal_room_id_fkey';
            columns: ['deal_room_id'];
            isOneToOne: false;
            referencedRelation: 'deal_rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_pipeline_id_fkey';
            columns: ['pipeline_id'];
            isOneToOne: false;
            referencedRelation: 'pipelines';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_source_journey_item_id_fkey';
            columns: ['source_journey_item_id'];
            isOneToOne: false;
            referencedRelation: 'journey_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deals_stage_id_fkey';
            columns: ['stage_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_stages';
            referencedColumns: ['id'];
          },
        ];
      };
      deferred_notification_deliveries: {
        Row: {
          account_id: string;
          body: string | null;
          claimed_at: string | null;
          created_at: string;
          due_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          link: string | null;
          notification_type: string;
          processed_at: string | null;
          send_push: boolean;
          send_whatsapp: boolean;
          title: string;
          user_id: string;
          whatsapp_text: string | null;
        };
        Insert: {
          account_id: string;
          body?: string | null;
          claimed_at?: string | null;
          created_at?: string;
          due_at: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          notification_type: string;
          processed_at?: string | null;
          send_push?: boolean;
          send_whatsapp?: boolean;
          title: string;
          user_id: string;
          whatsapp_text?: string | null;
        };
        Update: {
          account_id?: string;
          body?: string | null;
          claimed_at?: string | null;
          created_at?: string;
          due_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          notification_type?: string;
          processed_at?: string | null;
          send_push?: boolean;
          send_whatsapp?: boolean;
          title?: string;
          user_id?: string;
          whatsapp_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'deferred_notification_deliveries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'deferred_notification_deliveries_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      den_contact_links: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          den_user_id: string;
          id: string;
          phone_at_link: string | null;
          status: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          den_user_id: string;
          id?: string;
          phone_at_link?: string | null;
          status?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          den_user_id?: string;
          id?: string;
          phone_at_link?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'den_contact_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'den_contact_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'den_contact_links_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'den_contact_links_den_user_id_fkey';
            columns: ['den_user_id'];
            isOneToOne: false;
            referencedRelation: 'den_users';
            referencedColumns: ['id'];
          },
        ];
      };
      den_match_unlocks: {
        Row: {
          account_id: string;
          created_at: string;
          credits_burned: number;
          id: string;
          match_event_id: string | null;
          property_id: string;
          retry_key: string | null;
          score: number | null;
          unlocked_by_user_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          credits_burned: number;
          id?: string;
          match_event_id?: string | null;
          property_id: string;
          retry_key?: string | null;
          score?: number | null;
          unlocked_by_user_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          credits_burned?: number;
          id?: string;
          match_event_id?: string | null;
          property_id?: string;
          retry_key?: string | null;
          score?: number | null;
          unlocked_by_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'den_match_unlocks_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'den_match_unlocks_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'den_match_unlocks_match_event_id_fkey';
            columns: ['match_event_id'];
            isOneToOne: false;
            referencedRelation: 'match_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'den_match_unlocks_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      den_users: {
        Row: {
          auth_user_id: string;
          created_at: string;
          digest_frequency: string;
          display_name: string | null;
          id: string;
          notify_bids: boolean;
          notify_matches: boolean;
          phone: string;
          phone_normalized: string;
          updated_at: string;
        };
        Insert: {
          auth_user_id: string;
          created_at?: string;
          digest_frequency?: string;
          display_name?: string | null;
          id?: string;
          notify_bids?: boolean;
          notify_matches?: boolean;
          phone: string;
          phone_normalized: string;
          updated_at?: string;
        };
        Update: {
          auth_user_id?: string;
          created_at?: string;
          digest_frequency?: string;
          display_name?: string | null;
          id?: string;
          notify_bids?: boolean;
          notify_matches?: boolean;
          phone?: string;
          phone_normalized?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_sync_configs: {
        Row: {
          account_id: string;
          auto_reply_enabled: boolean;
          auto_reply_template_name: string | null;
          auto_reply_text: string | null;
          created_at: string | null;
          id: string;
          is_active: boolean;
          last_verification_at: string | null;
          last_verification_code: string | null;
          last_verification_link: string | null;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          auto_reply_enabled?: boolean;
          auto_reply_template_name?: string | null;
          auto_reply_text?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean;
          last_verification_at?: string | null;
          last_verification_code?: string | null;
          last_verification_link?: string | null;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          auto_reply_enabled?: boolean;
          auto_reply_template_name?: string | null;
          auto_reply_text?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean;
          last_verification_at?: string | null;
          last_verification_code?: string | null;
          last_verification_link?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'email_sync_configs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'email_sync_configs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      email_sync_logs: {
        Row: {
          account_id: string;
          body_preview: string | null;
          created_at: string | null;
          error_message: string | null;
          extracted_email: string | null;
          extracted_name: string | null;
          extracted_phone: string | null;
          id: string;
          lead_portal: string | null;
          lead_portal_listing_id: string | null;
          ledger_id: string | null;
          match_score: number | null;
          matched_property_id: string | null;
          parsed_area_sqft: number | null;
          parsed_bedrooms: number | null;
          parsed_location: string | null;
          parsed_price: number | null;
          parsed_property_type: string | null;
          sender: string | null;
          status: string;
          subject: string | null;
        };
        Insert: {
          account_id: string;
          body_preview?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          extracted_email?: string | null;
          extracted_name?: string | null;
          extracted_phone?: string | null;
          id?: string;
          lead_portal?: string | null;
          lead_portal_listing_id?: string | null;
          ledger_id?: string | null;
          match_score?: number | null;
          matched_property_id?: string | null;
          parsed_area_sqft?: number | null;
          parsed_bedrooms?: number | null;
          parsed_location?: string | null;
          parsed_price?: number | null;
          parsed_property_type?: string | null;
          sender?: string | null;
          status: string;
          subject?: string | null;
        };
        Update: {
          account_id?: string;
          body_preview?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          extracted_email?: string | null;
          extracted_name?: string | null;
          extracted_phone?: string | null;
          id?: string;
          lead_portal?: string | null;
          lead_portal_listing_id?: string | null;
          ledger_id?: string | null;
          match_score?: number | null;
          matched_property_id?: string | null;
          parsed_area_sqft?: number | null;
          parsed_bedrooms?: number | null;
          parsed_location?: string | null;
          parsed_price?: number | null;
          parsed_property_type?: string | null;
          sender?: string | null;
          status?: string;
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'email_sync_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'email_sync_logs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_sync_logs_matched_property_id_fkey';
            columns: ['matched_property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      flow_nodes: {
        Row: {
          config: Json;
          created_at: string;
          flow_id: string;
          id: string;
          node_key: string;
          node_type: string;
          position_x: number;
          position_y: number;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          flow_id: string;
          id?: string;
          node_key: string;
          node_type: string;
          position_x?: number;
          position_y?: number;
        };
        Update: {
          config?: Json;
          created_at?: string;
          flow_id?: string;
          id?: string;
          node_key?: string;
          node_type?: string;
          position_x?: number;
          position_y?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'flow_nodes_flow_id_fkey';
            columns: ['flow_id'];
            isOneToOne: false;
            referencedRelation: 'flows';
            referencedColumns: ['id'];
          },
        ];
      };
      flow_run_events: {
        Row: {
          created_at: string;
          event_type: string;
          flow_run_id: string;
          id: string;
          node_key: string | null;
          payload: Json;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          flow_run_id: string;
          id?: string;
          node_key?: string | null;
          payload?: Json;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          flow_run_id?: string;
          id?: string;
          node_key?: string | null;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'flow_run_events_flow_run_id_fkey';
            columns: ['flow_run_id'];
            isOneToOne: false;
            referencedRelation: 'flow_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      flow_runs: {
        Row: {
          account_id: string;
          contact_id: string | null;
          conversation_id: string | null;
          current_node_key: string | null;
          end_reason: string | null;
          ended_at: string | null;
          flow_id: string;
          id: string;
          last_advanced_at: string;
          last_prompt_message_id: string | null;
          reprompt_count: number;
          started_at: string;
          status: string;
          user_id: string;
          vars: Json;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          current_node_key?: string | null;
          end_reason?: string | null;
          ended_at?: string | null;
          flow_id: string;
          id?: string;
          last_advanced_at?: string;
          last_prompt_message_id?: string | null;
          reprompt_count?: number;
          started_at?: string;
          status?: string;
          user_id: string;
          vars?: Json;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          current_node_key?: string | null;
          end_reason?: string | null;
          ended_at?: string | null;
          flow_id?: string;
          id?: string;
          last_advanced_at?: string;
          last_prompt_message_id?: string | null;
          reprompt_count?: number;
          started_at?: string;
          status?: string;
          user_id?: string;
          vars?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'flow_runs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'flow_runs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flow_runs_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flow_runs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flow_runs_flow_id_fkey';
            columns: ['flow_id'];
            isOneToOne: false;
            referencedRelation: 'flows';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flow_runs_last_prompt_message_id_fkey';
            columns: ['last_prompt_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      flows: {
        Row: {
          account_id: string;
          created_at: string;
          description: string | null;
          entry_node_id: string | null;
          execution_count: number;
          fallback_policy: Json;
          id: string;
          last_executed_at: string | null;
          name: string;
          status: string;
          trigger_config: Json;
          trigger_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          description?: string | null;
          entry_node_id?: string | null;
          execution_count?: number;
          fallback_policy?: Json;
          id?: string;
          last_executed_at?: string | null;
          name: string;
          status?: string;
          trigger_config?: Json;
          trigger_type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          description?: string | null;
          entry_node_id?: string | null;
          execution_count?: number;
          fallback_policy?: Json;
          id?: string;
          last_executed_at?: string | null;
          name?: string;
          status?: string;
          trigger_config?: Json;
          trigger_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'flows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'flows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      follow_up_nudges: {
        Row: {
          account_id: string;
          agent_disposition: string | null;
          contact_id: string;
          created_at: string;
          disposition_updated_at: string | null;
          id: string;
          last_nudged_at: string | null;
          snoozed_until: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          agent_disposition?: string | null;
          contact_id: string;
          created_at?: string;
          disposition_updated_at?: string | null;
          id?: string;
          last_nudged_at?: string | null;
          snoozed_until?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          agent_disposition?: string | null;
          contact_id?: string;
          created_at?: string;
          disposition_updated_at?: string | null;
          id?: string;
          last_nudged_at?: string | null;
          snoozed_until?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'follow_up_nudges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'follow_up_nudges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'follow_up_nudges_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      guidance_value_batches: {
        Row: {
          applied_at: string | null;
          chunks: Json;
          created_at: string | null;
          error: string | null;
          failed_count: number;
          gemini_name: string;
          id: string;
          key_id: string | null;
          key_label: string;
          model: string;
          request_count: number;
          state: string;
          updated_at: string | null;
        };
        Insert: {
          applied_at?: string | null;
          chunks: Json;
          created_at?: string | null;
          error?: string | null;
          failed_count?: number;
          gemini_name: string;
          id?: string;
          key_id?: string | null;
          key_label: string;
          model: string;
          request_count: number;
          state?: string;
          updated_at?: string | null;
        };
        Update: {
          applied_at?: string | null;
          chunks?: Json;
          created_at?: string | null;
          error?: string | null;
          failed_count?: number;
          gemini_name?: string;
          id?: string;
          key_id?: string | null;
          key_label?: string;
          model?: string;
          request_count?: number;
          state?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'guidance_value_batches_key_id_fkey';
            columns: ['key_id'];
            isOneToOne: false;
            referencedRelation: 'ai_provider_keys';
            referencedColumns: ['id'];
          },
        ];
      };
      guidance_value_rates: {
        Row: {
          created_at: string | null;
          district: string | null;
          hobli: string | null;
          id: string;
          land_class: string | null;
          locality: string | null;
          page: number | null;
          property_class: string;
          rate: number;
          road: string | null;
          search_text: string | null;
          seq: number;
          source_id: string;
          survey_numbers: string | null;
          taluk: string | null;
          unit: string;
          updated_at: string | null;
          village: string | null;
        };
        Insert: {
          created_at?: string | null;
          district?: string | null;
          hobli?: string | null;
          id?: string;
          land_class?: string | null;
          locality?: string | null;
          page?: number | null;
          property_class: string;
          rate: number;
          road?: string | null;
          search_text?: string | null;
          seq?: number;
          source_id: string;
          survey_numbers?: string | null;
          taluk?: string | null;
          unit: string;
          updated_at?: string | null;
          village?: string | null;
        };
        Update: {
          created_at?: string | null;
          district?: string | null;
          hobli?: string | null;
          id?: string;
          land_class?: string | null;
          locality?: string | null;
          page?: number | null;
          property_class?: string;
          rate?: number;
          road?: string | null;
          search_text?: string | null;
          seq?: number;
          source_id?: string;
          survey_numbers?: string | null;
          taluk?: string | null;
          unit?: string;
          updated_at?: string | null;
          village?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'guidance_value_rates_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'guidance_value_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      guidance_value_sources: {
        Row: {
          batch_id: string | null;
          batch_requested_at: string | null;
          created_at: string | null;
          district: string;
          effective_from: string | null;
          error: string | null;
          id: string;
          page_count: number | null;
          pages_parsed: number;
          row_count: number;
          single_pages: number[];
          source_url: string | null;
          sro: string | null;
          state_code: string;
          status: string;
          storage_path: string;
          taluk: string | null;
          title: string;
          updated_at: string | null;
          uploaded_by: string | null;
        };
        Insert: {
          batch_id?: string | null;
          batch_requested_at?: string | null;
          created_at?: string | null;
          district: string;
          effective_from?: string | null;
          error?: string | null;
          id?: string;
          page_count?: number | null;
          pages_parsed?: number;
          row_count?: number;
          single_pages?: number[];
          source_url?: string | null;
          sro?: string | null;
          state_code?: string;
          status?: string;
          storage_path: string;
          taluk?: string | null;
          title: string;
          updated_at?: string | null;
          uploaded_by?: string | null;
        };
        Update: {
          batch_id?: string | null;
          batch_requested_at?: string | null;
          created_at?: string | null;
          district?: string;
          effective_from?: string | null;
          error?: string | null;
          id?: string;
          page_count?: number | null;
          pages_parsed?: number;
          row_count?: number;
          single_pages?: number[];
          source_url?: string | null;
          sro?: string | null;
          state_code?: string;
          status?: string;
          storage_path?: string;
          taluk?: string | null;
          title?: string;
          updated_at?: string | null;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'guidance_value_sources_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'guidance_value_batches';
            referencedColumns: ['id'];
          },
        ];
      };
      image_cleanup_log: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          image_count: number;
          phase: string;
          property_id: string | null;
          snapshot: Json | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          image_count?: number;
          phase: string;
          property_id?: string | null;
          snapshot?: Json | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          image_count?: number;
          phase?: string;
          property_id?: string | null;
          snapshot?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'image_cleanup_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'image_cleanup_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      invoice_events: {
        Row: {
          account_id: string;
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          document_hash: string | null;
          event: string;
          id: string;
          invoice_id: string;
          ip_address: string | null;
          metadata: Json;
          user_agent: string | null;
        };
        Insert: {
          account_id: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          document_hash?: string | null;
          event: string;
          id?: string;
          invoice_id: string;
          ip_address?: string | null;
          metadata?: Json;
          user_agent?: string | null;
        };
        Update: {
          account_id?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          document_hash?: string | null;
          event?: string;
          id?: string;
          invoice_id?: string;
          ip_address?: string | null;
          metadata?: Json;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'invoice_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_events_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
        ];
      };
      invoice_settings: {
        Row: {
          account_id: string;
          address_lines: string[];
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          created_at: string;
          default_particulars: string;
          default_sac: string;
          default_share_percent: number;
          gst_mode: string;
          gst_note: string;
          gst_rate: number;
          gstin: string | null;
          id: string;
          legal_name: string;
          number_prefix: string;
          number_resets_yearly: boolean;
          pan: string | null;
          rera_number: string | null;
          signatory_designation: string | null;
          signatory_label: string;
          signatory_name: string | null;
          signature_image_path: string | null;
          signature_mode: string;
          signature_place: string | null;
          starting_number: number;
          state_code: string | null;
          state_name: string | null;
          terms: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          address_lines?: string[];
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          created_at?: string;
          default_particulars?: string;
          default_sac?: string;
          default_share_percent?: number;
          gst_mode?: string;
          gst_note?: string;
          gst_rate?: number;
          gstin?: string | null;
          id?: string;
          legal_name?: string;
          number_prefix?: string;
          number_resets_yearly?: boolean;
          pan?: string | null;
          rera_number?: string | null;
          signatory_designation?: string | null;
          signatory_label?: string;
          signatory_name?: string | null;
          signature_image_path?: string | null;
          signature_mode?: string;
          signature_place?: string | null;
          starting_number?: number;
          state_code?: string | null;
          state_name?: string | null;
          terms?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          address_lines?: string[];
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          created_at?: string;
          default_particulars?: string;
          default_sac?: string;
          default_share_percent?: number;
          gst_mode?: string;
          gst_note?: string;
          gst_rate?: number;
          gstin?: string | null;
          id?: string;
          legal_name?: string;
          number_prefix?: string;
          number_resets_yearly?: boolean;
          pan?: string | null;
          rera_number?: string | null;
          signatory_designation?: string | null;
          signatory_label?: string;
          signatory_name?: string | null;
          signature_image_path?: string | null;
          signature_mode?: string;
          signature_place?: string | null;
          starting_number?: number;
          state_code?: string | null;
          state_name?: string | null;
          terms?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'invoice_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      invoices: {
        Row: {
          account_id: string;
          amount_in_words: string | null;
          bill_to: Json;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cgst: number;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          deal_id: string | null;
          document_hash: string | null;
          financial_year: string | null;
          grand_total: number;
          gst_mode: string;
          gst_rate: number;
          id: string;
          igst: number;
          invoice_date: string;
          invoice_number: string | null;
          issued_at: string | null;
          issuer: Json;
          line_items: Json;
          notes: string | null;
          paid_at: string | null;
          party_id: string | null;
          pdf_path: string | null;
          place_of_supply: string | null;
          place_of_supply_code: string | null;
          property_id: string | null;
          sent_at: string | null;
          sequence_number: number | null;
          sgst: number;
          share_percent: number;
          side: string;
          signature: Json | null;
          signed_at: string | null;
          status: string;
          taxable_total: number;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          amount_in_words?: string | null;
          bill_to?: Json;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cgst?: number;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deal_id?: string | null;
          document_hash?: string | null;
          financial_year?: string | null;
          grand_total?: number;
          gst_mode?: string;
          gst_rate?: number;
          id?: string;
          igst?: number;
          invoice_date?: string;
          invoice_number?: string | null;
          issued_at?: string | null;
          issuer?: Json;
          line_items?: Json;
          notes?: string | null;
          paid_at?: string | null;
          party_id?: string | null;
          pdf_path?: string | null;
          place_of_supply?: string | null;
          place_of_supply_code?: string | null;
          property_id?: string | null;
          sent_at?: string | null;
          sequence_number?: number | null;
          sgst?: number;
          share_percent?: number;
          side?: string;
          signature?: Json | null;
          signed_at?: string | null;
          status?: string;
          taxable_total?: number;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          amount_in_words?: string | null;
          bill_to?: Json;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cgst?: number;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deal_id?: string | null;
          document_hash?: string | null;
          financial_year?: string | null;
          grand_total?: number;
          gst_mode?: string;
          gst_rate?: number;
          id?: string;
          igst?: number;
          invoice_date?: string;
          invoice_number?: string | null;
          issued_at?: string | null;
          issuer?: Json;
          line_items?: Json;
          notes?: string | null;
          paid_at?: string | null;
          party_id?: string | null;
          pdf_path?: string | null;
          place_of_supply?: string | null;
          place_of_supply_code?: string | null;
          property_id?: string | null;
          sent_at?: string | null;
          sequence_number?: number | null;
          sgst?: number;
          share_percent?: number;
          side?: string;
          signature?: Json | null;
          signed_at?: string | null;
          status?: string;
          taxable_total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'invoices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_party_id_fkey';
            columns: ['party_id'];
            isOneToOne: false;
            referencedRelation: 'contact_parties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_compartments: {
        Row: {
          account_id: string;
          compartment: string;
          created_at: string | null;
          created_by: string | null;
          id: string;
          mode: string;
          subject_id: string;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          compartment: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          mode: string;
          subject_id: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          compartment?: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          mode?: string;
          subject_id?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_compartments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_compartments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_events: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          dedupe_key: string | null;
          event_type: string;
          from_stage_id: string | null;
          id: string;
          item_id: string;
          metadata: Json;
          reason: string | null;
          to_stage_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          event_type: string;
          from_stage_id?: string | null;
          id?: string;
          item_id: string;
          metadata?: Json;
          reason?: string | null;
          to_stage_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          event_type?: string;
          from_stage_id?: string | null;
          id?: string;
          item_id?: string;
          metadata?: Json;
          reason?: string | null;
          to_stage_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_events_from_stage_id_fkey';
            columns: ['from_stage_id'];
            isOneToOne: false;
            referencedRelation: 'journey_stages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_events_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'journey_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_events_to_stage_id_fkey';
            columns: ['to_stage_id'];
            isOneToOne: false;
            referencedRelation: 'journey_stages';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_items: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          created_by: string | null;
          drop_reason: string | null;
          dropped_at: string | null;
          hidden: boolean;
          id: string;
          notes: string | null;
          planned_at: string | null;
          planned_stage_id: string | null;
          property_id: string;
          source: string;
          stage_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          created_by?: string | null;
          drop_reason?: string | null;
          dropped_at?: string | null;
          hidden?: boolean;
          id?: string;
          notes?: string | null;
          planned_at?: string | null;
          planned_stage_id?: string | null;
          property_id: string;
          source?: string;
          stage_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          created_by?: string | null;
          drop_reason?: string | null;
          dropped_at?: string | null;
          hidden?: boolean;
          id?: string;
          notes?: string | null;
          planned_at?: string | null;
          planned_stage_id?: string | null;
          property_id?: string;
          source?: string;
          stage_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_items_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_items_planned_stage_id_fkey';
            columns: ['planned_stage_id'];
            isOneToOne: false;
            referencedRelation: 'journey_stages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_items_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_items_stage_id_fkey';
            columns: ['stage_id'];
            isOneToOne: false;
            referencedRelation: 'journey_stages';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_overview_states: {
        Row: {
          account_id: string;
          archived_at: string | null;
          closed_at: string | null;
          closure_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          lifecycle_status: string;
          mode: string;
          sort_order: number;
          subject_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          account_id: string;
          archived_at?: string | null;
          closed_at?: string | null;
          closure_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          lifecycle_status?: string;
          mode: string;
          sort_order?: number;
          subject_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          account_id?: string;
          archived_at?: string | null;
          closed_at?: string | null;
          closure_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          lifecycle_status?: string;
          mode?: string;
          sort_order?: number;
          subject_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_overview_states_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_overview_states_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_priorities: {
        Row: {
          account_id: string;
          created_at: string | null;
          created_by: string | null;
          id: string;
          mode: string;
          priority: string;
          subject_id: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          mode: string;
          priority: string;
          subject_id: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          mode?: string;
          priority?: string;
          subject_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_priorities_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_priorities_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_stage_notes: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          id: string;
          item_id: string;
          note: string;
          stage_color: string | null;
          stage_id: string | null;
          stage_name: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          id?: string;
          item_id: string;
          note: string;
          stage_color?: string | null;
          stage_id?: string | null;
          stage_name: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          id?: string;
          item_id?: string;
          note?: string;
          stage_color?: string | null;
          stage_id?: string | null;
          stage_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_stage_notes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_stage_notes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_stage_notes_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'journey_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_stage_notes_stage_id_fkey';
            columns: ['stage_id'];
            isOneToOne: false;
            referencedRelation: 'journey_stages';
            referencedColumns: ['id'];
          },
        ];
      };
      journey_stages: {
        Row: {
          account_id: string;
          color: string;
          created_at: string;
          id: string;
          name: string;
          pipeline_stage_id: string | null;
          position: number;
          stage_kind: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          pipeline_stage_id?: string | null;
          position?: number;
          stage_kind?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          pipeline_stage_id?: string | null;
          position?: number;
          stage_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'journey_stages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'journey_stages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'journey_stages_pipeline_stage_id_fkey';
            columns: ['pipeline_stage_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_stages';
            referencedColumns: ['id'];
          },
        ];
      };
      learned_facts: {
        Row: {
          account_id: string;
          contact_id: string | null;
          conversation_id: string | null;
          created_at: string;
          disposition: string;
          entity_id: string;
          entity_type: string;
          evidence: string;
          field: string;
          id: string;
          message_id: string | null;
          previous_value: Json | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string;
          status: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          disposition: string;
          entity_id: string;
          entity_type: string;
          evidence: string;
          field: string;
          id?: string;
          message_id?: string | null;
          previous_value?: Json | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source: string;
          status?: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          disposition?: string;
          entity_id?: string;
          entity_type?: string;
          evidence?: string;
          field?: string;
          id?: string;
          message_id?: string | null;
          previous_value?: Json | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'learned_facts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'learned_facts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learned_facts_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learned_facts_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learned_facts_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      liaison_job_payments: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          direction: string;
          id: string;
          job_id: string;
          note: string | null;
          paid_on: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          direction: string;
          id?: string;
          job_id: string;
          note?: string | null;
          paid_on?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          direction?: string;
          id?: string;
          job_id?: string;
          note?: string | null;
          paid_on?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'liaison_job_payments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'liaison_job_payments_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'liaison_job_payments_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'liaison_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      liaison_jobs: {
        Row: {
          account_id: string;
          client_charge: number | null;
          completed_at: string | null;
          contact_id: string | null;
          created_at: string;
          id: string;
          liaison_fee: number | null;
          liaison_id: string;
          notes: string | null;
          property_id: string | null;
          service_name: string;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          client_charge?: number | null;
          completed_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          liaison_fee?: number | null;
          liaison_id: string;
          notes?: string | null;
          property_id?: string | null;
          service_name: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          client_charge?: number | null;
          completed_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          liaison_fee?: number | null;
          liaison_id?: string;
          notes?: string | null;
          property_id?: string | null;
          service_name?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'liaison_jobs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'liaison_jobs_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'liaison_jobs_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'liaison_jobs_liaison_id_fkey';
            columns: ['liaison_id'];
            isOneToOne: false;
            referencedRelation: 'liaisons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'liaison_jobs_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      liaison_workflows: {
        Row: {
          account_id: string;
          created_at: string;
          description: string | null;
          id: string;
          service_name: string;
          stages: Json;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          service_name: string;
          stages?: Json;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          service_name?: string;
          stages?: Json;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'liaison_workflows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'liaison_workflows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      liaisons: {
        Row: {
          account_id: string;
          alt_phone: string | null;
          created_at: string;
          email: string | null;
          id: string;
          is_active: boolean;
          name: string;
          notes: string | null;
          office_area: string | null;
          phone: string | null;
          services: Json;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          alt_phone?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          notes?: string | null;
          office_area?: string | null;
          phone?: string | null;
          services?: Json;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          alt_phone?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          notes?: string | null;
          office_area?: string | null;
          phone?: string | null;
          services?: Json;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'liaisons_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'liaisons_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      listing_feedback: {
        Row: {
          account_id: string;
          channel: string;
          contact_id: string;
          created_at: string;
          id: string;
          property_id: string;
          reason: string | null;
          updated_at: string;
          verdict: string;
        };
        Insert: {
          account_id: string;
          channel?: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          property_id: string;
          reason?: string | null;
          updated_at?: string;
          verdict: string;
        };
        Update: {
          account_id?: string;
          channel?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          property_id?: string;
          reason?: string | null;
          updated_at?: string;
          verdict?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'listing_feedback_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'listing_feedback_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'listing_feedback_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'listing_feedback_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      maps_lookup_cache: {
        Row: {
          created_at: string;
          expires_at: string;
          key: string;
          kind: string;
          value: Json | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          key: string;
          kind: string;
          value?: Json | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          key?: string;
          kind?: string;
          value?: Json | null;
        };
        Relationships: [];
      };
      market_stats: {
        Row: {
          accounts_count: number;
          buyer_count: number | null;
          city: string;
          computed_at: string;
          id: string;
          listing_type: string;
          listings_count: number | null;
          locality: string;
          median_area_sqft: number | null;
          median_budget: number | null;
          median_days_to_sell: number | null;
          median_price: number | null;
          median_sold_price: number | null;
          period_month: string;
          property_type: string;
          side: string;
          sold_count: number | null;
        };
        Insert: {
          accounts_count: number;
          buyer_count?: number | null;
          city: string;
          computed_at?: string;
          id?: string;
          listing_type?: string;
          listings_count?: number | null;
          locality: string;
          median_area_sqft?: number | null;
          median_budget?: number | null;
          median_days_to_sell?: number | null;
          median_price?: number | null;
          median_sold_price?: number | null;
          period_month: string;
          property_type: string;
          side: string;
          sold_count?: number | null;
        };
        Update: {
          accounts_count?: number;
          buyer_count?: number | null;
          city?: string;
          computed_at?: string;
          id?: string;
          listing_type?: string;
          listings_count?: number | null;
          locality?: string;
          median_area_sqft?: number | null;
          median_budget?: number | null;
          median_days_to_sell?: number | null;
          median_price?: number | null;
          median_sold_price?: number | null;
          period_month?: string;
          property_type?: string;
          side?: string;
          sold_count?: number | null;
        };
        Relationships: [];
      };
      marketplace_item_nodes: {
        Row: {
          config: Json;
          id: string;
          marketplace_item_id: string;
          node_key: string;
          node_type: string;
          position_x: number;
          position_y: number;
        };
        Insert: {
          config?: Json;
          id?: string;
          marketplace_item_id: string;
          node_key: string;
          node_type: string;
          position_x?: number;
          position_y?: number;
        };
        Update: {
          config?: Json;
          id?: string;
          marketplace_item_id?: string;
          node_key?: string;
          node_type?: string;
          position_x?: number;
          position_y?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_item_nodes_marketplace_item_id_fkey';
            columns: ['marketplace_item_id'];
            isOneToOne: false;
            referencedRelation: 'marketplace_items';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_items: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          entry_node_id: string | null;
          fallback_policy: Json;
          icon: string | null;
          id: string;
          name: string;
          price_cents: number;
          published: boolean;
          source_id: string;
          source_type: string;
          trigger_config: Json;
          trigger_type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          entry_node_id?: string | null;
          fallback_policy?: Json;
          icon?: string | null;
          id?: string;
          name: string;
          price_cents?: number;
          published?: boolean;
          source_id: string;
          source_type: string;
          trigger_config?: Json;
          trigger_type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          entry_node_id?: string | null;
          fallback_policy?: Json;
          icon?: string | null;
          id?: string;
          name?: string;
          price_cents?: number;
          published?: boolean;
          source_id?: string;
          source_type?: string;
          trigger_config?: Json;
          trigger_type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      match_events: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          kind: string;
          matches: Json;
          property_id: string | null;
          sent_at: string | null;
          sent_count: number;
          source: string;
          status: string;
          subject_snapshot: Json | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          matches?: Json;
          property_id?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          source?: string;
          status?: string;
          subject_snapshot?: Json | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          matches?: Json;
          property_id?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          source?: string;
          status?: string;
          subject_snapshot?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'match_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_events_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_events_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      message_reactions: {
        Row: {
          actor_id: string | null;
          actor_type: string;
          conversation_id: string;
          created_at: string;
          emoji: string;
          id: string;
          message_id: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_type: string;
          conversation_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          message_id: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string;
          conversation_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          message_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_reactions_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_reactions_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      message_templates: {
        Row: {
          account_id: string;
          body_text: string;
          buttons: Json | null;
          category: string;
          copy_revision: string | null;
          created_at: string | null;
          footer_text: string | null;
          header_content: string | null;
          header_handle: string | null;
          header_media_url: string | null;
          header_type: string | null;
          id: string;
          language: string | null;
          last_submitted_at: string | null;
          meta_template_id: string | null;
          name: string;
          quality_score: string | null;
          rejection_reason: string | null;
          sample_values: Json | null;
          status: string | null;
          submission_error: string | null;
          translation_reviewed_at: string | null;
          translation_reviewed_by: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          body_text: string;
          buttons?: Json | null;
          category?: string;
          copy_revision?: string | null;
          created_at?: string | null;
          footer_text?: string | null;
          header_content?: string | null;
          header_handle?: string | null;
          header_media_url?: string | null;
          header_type?: string | null;
          id?: string;
          language?: string | null;
          last_submitted_at?: string | null;
          meta_template_id?: string | null;
          name: string;
          quality_score?: string | null;
          rejection_reason?: string | null;
          sample_values?: Json | null;
          status?: string | null;
          submission_error?: string | null;
          translation_reviewed_at?: string | null;
          translation_reviewed_by?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          body_text?: string;
          buttons?: Json | null;
          category?: string;
          copy_revision?: string | null;
          created_at?: string | null;
          footer_text?: string | null;
          header_content?: string | null;
          header_handle?: string | null;
          header_media_url?: string | null;
          header_type?: string | null;
          id?: string;
          language?: string | null;
          last_submitted_at?: string | null;
          meta_template_id?: string | null;
          name?: string;
          quality_score?: string | null;
          rejection_reason?: string | null;
          sample_values?: Json | null;
          status?: string | null;
          submission_error?: string | null;
          translation_reviewed_at?: string | null;
          translation_reviewed_by?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_templates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'message_templates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          account_id: string;
          content_text: string | null;
          content_type: string;
          conversation_id: string;
          created_at: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          error_code: number | null;
          error_info: string | null;
          id: string;
          ingest_seq: number | null;
          interactive_reply_id: string | null;
          media_url: string | null;
          message_id: string | null;
          pin_expires_at: string | null;
          pinned_at: string | null;
          pinned_by: string | null;
          private: boolean;
          reply_to_message_id: string | null;
          retry_after: string | null;
          sender_contact_id: string | null;
          sender_id: string | null;
          sender_type: string;
          sender_wa_id: string | null;
          status: string;
          template_name: string | null;
        };
        Insert: {
          account_id: string;
          content_text?: string | null;
          content_type?: string;
          conversation_id: string;
          created_at?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          error_code?: number | null;
          error_info?: string | null;
          id?: string;
          ingest_seq?: number | null;
          interactive_reply_id?: string | null;
          media_url?: string | null;
          message_id?: string | null;
          pin_expires_at?: string | null;
          pinned_at?: string | null;
          pinned_by?: string | null;
          private?: boolean;
          reply_to_message_id?: string | null;
          retry_after?: string | null;
          sender_contact_id?: string | null;
          sender_id?: string | null;
          sender_type: string;
          sender_wa_id?: string | null;
          status?: string;
          template_name?: string | null;
        };
        Update: {
          account_id?: string;
          content_text?: string | null;
          content_type?: string;
          conversation_id?: string;
          created_at?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          error_code?: number | null;
          error_info?: string | null;
          id?: string;
          ingest_seq?: number | null;
          interactive_reply_id?: string | null;
          media_url?: string | null;
          message_id?: string | null;
          pin_expires_at?: string | null;
          pinned_at?: string | null;
          pinned_by?: string | null;
          private?: boolean;
          reply_to_message_id?: string | null;
          retry_after?: string | null;
          sender_contact_id?: string | null;
          sender_id?: string | null;
          sender_type?: string;
          sender_wa_id?: string | null;
          status?: string;
          template_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'messages_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_reply_to_message_id_fkey';
            columns: ['reply_to_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_sender_contact_id_fkey';
            columns: ['sender_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      meta_ads_config: {
        Row: {
          access_token: string;
          account_id: string;
          ad_account_id: string | null;
          connected_at: string;
          currency: string | null;
          fb_user_id: string | null;
          id: string;
          ig_account_id: string | null;
          page_id: string | null;
          status: string;
          token_expires_at: string | null;
          updated_at: string;
        };
        Insert: {
          access_token: string;
          account_id: string;
          ad_account_id?: string | null;
          connected_at?: string;
          currency?: string | null;
          fb_user_id?: string | null;
          id?: string;
          ig_account_id?: string | null;
          page_id?: string | null;
          status?: string;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string;
          account_id?: string;
          ad_account_id?: string | null;
          connected_at?: string;
          currency?: string | null;
          fb_user_id?: string | null;
          id?: string;
          ig_account_id?: string | null;
          page_id?: string | null;
          status?: string;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meta_ads_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'meta_ads_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_devices: {
        Row: {
          account_id: string;
          created_at: string;
          expo_push_token: string;
          id: string;
          platform: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          expo_push_token: string;
          id?: string;
          platform?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          expo_push_token?: string;
          id?: string;
          platform?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_devices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'notification_devices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          account_id: string;
          app_enabled: boolean;
          created_at: string | null;
          event_key: string;
          id: string;
          updated_at: string | null;
          whatsapp_enabled: boolean;
        };
        Insert: {
          account_id: string;
          app_enabled?: boolean;
          created_at?: string | null;
          event_key: string;
          id?: string;
          updated_at?: string | null;
          whatsapp_enabled?: boolean;
        };
        Update: {
          account_id?: string;
          app_enabled?: boolean;
          created_at?: string | null;
          event_key?: string;
          id?: string;
          updated_at?: string | null;
          whatsapp_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'notification_preferences_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          account_id: string;
          body: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          link: string | null;
          read_at: string | null;
          title: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          title: string;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          title?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'notifications_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      occasion_greetings: {
        Row: {
          account_id: string;
          broadcast_id: string | null;
          created_at: string | null;
          created_by: string;
          id: string;
          image_path: string | null;
          message_text: string;
          occasion_id: string | null;
          occasion_label: string;
          sent_at: string | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          broadcast_id?: string | null;
          created_at?: string | null;
          created_by: string;
          id?: string;
          image_path?: string | null;
          message_text: string;
          occasion_id?: string | null;
          occasion_label: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          broadcast_id?: string | null;
          created_at?: string | null;
          created_by?: string;
          id?: string;
          image_path?: string | null;
          message_text?: string;
          occasion_id?: string | null;
          occasion_label?: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'occasion_greetings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'occasion_greetings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'occasion_greetings_broadcast_id_fkey';
            columns: ['broadcast_id'];
            isOneToOne: false;
            referencedRelation: 'broadcasts';
            referencedColumns: ['id'];
          },
        ];
      };
      outreach_followups: {
        Row: {
          account_id: string;
          action: string;
          call_log_id: string | null;
          contact_id: string;
          context: Json;
          created_at: string;
          disposition: string;
          flow_kind: string;
          id: string;
          opened_at: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          skip_reason: string | null;
          status: string;
          template_used: string | null;
          updated_at: string;
          window_was_open: boolean | null;
        };
        Insert: {
          account_id: string;
          action: string;
          call_log_id?: string | null;
          contact_id: string;
          context?: Json;
          created_at?: string;
          disposition: string;
          flow_kind?: string;
          id?: string;
          opened_at?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          template_used?: string | null;
          updated_at?: string;
          window_was_open?: boolean | null;
        };
        Update: {
          account_id?: string;
          action?: string;
          call_log_id?: string | null;
          contact_id?: string;
          context?: Json;
          created_at?: string;
          disposition?: string;
          flow_kind?: string;
          id?: string;
          opened_at?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          template_used?: string | null;
          updated_at?: string;
          window_was_open?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'outreach_followups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'outreach_followups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'outreach_followups_call_log_id_fkey';
            columns: ['call_log_id'];
            isOneToOne: false;
            referencedRelation: 'contact_call_logs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'outreach_followups_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      owner_details_request_settings: {
        Row: {
          account_id: string;
          body_template: string | null;
          created_at: string;
          id: string;
          sections: string[];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          account_id: string;
          body_template?: string | null;
          created_at?: string;
          id?: string;
          sections?: string[];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          account_id?: string;
          body_template?: string | null;
          created_at?: string;
          id?: string;
          sections?: string[];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'owner_details_request_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'owner_details_request_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      owner_digest_log: {
        Row: {
          account_id: string;
          channel: string | null;
          created_at: string;
          digest_date: string;
          id: string;
          owner_contact_id: string;
          period_end: string;
          period_start: string;
          stats: Json;
        };
        Insert: {
          account_id: string;
          channel?: string | null;
          created_at?: string;
          digest_date: string;
          id?: string;
          owner_contact_id: string;
          period_end: string;
          period_start: string;
          stats?: Json;
        };
        Update: {
          account_id?: string;
          channel?: string | null;
          created_at?: string;
          digest_date?: string;
          id?: string;
          owner_contact_id?: string;
          period_end?: string;
          period_start?: string;
          stats?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'owner_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'owner_digest_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'owner_digest_log_owner_contact_id_fkey';
            columns: ['owner_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      owner_digest_settings: {
        Row: {
          account_id: string;
          created_at: string;
          frequency: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          frequency?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          frequency?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'owner_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'owner_digest_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      party_suggestion_dismissals: {
        Row: {
          account_id: string;
          created_at: string;
          dismissed_by: string | null;
          id: string;
          pair_key: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          dismissed_by?: string | null;
          id?: string;
          pair_key: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          dismissed_by?: string | null;
          id?: string;
          pair_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'party_suggestion_dismissals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'party_suggestion_dismissals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_client_replies: {
        Row: {
          account_id: string;
          contact_id: string;
          conversation_id: string | null;
          created_at: string;
          id: string;
          parsed: Json;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          parsed: Json;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          parsed?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pending_client_replies_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'pending_client_replies_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_client_replies_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: true;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_client_replies_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_contact_updates: {
        Row: {
          account_id: string;
          body: string;
          contact_id: string;
          contact_name: string | null;
          conversation_id: string;
          created_at: string;
          id: string;
          summary: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          body: string;
          contact_id: string;
          contact_name?: string | null;
          conversation_id: string;
          created_at?: string;
          id?: string;
          summary: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          body?: string;
          contact_id?: string;
          contact_name?: string | null;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          summary?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pending_contact_updates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'pending_contact_updates_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_contact_updates_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_contact_updates_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: true;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_map_pins: {
        Row: {
          account_id: string;
          city: string | null;
          contact_id: string;
          conversation_id: string | null;
          created_at: string;
          id: string;
          latitude: number | null;
          location: string | null;
          longitude: number | null;
          map_link: string;
          state: string | null;
          sublocality: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          city?: string | null;
          contact_id: string;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          map_link: string;
          state?: string | null;
          sublocality?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          city?: string | null;
          contact_id?: string;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          map_link?: string;
          state?: string | null;
          sublocality?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pending_map_pins_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'pending_map_pins_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_map_pins_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: true;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_map_pins_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_stages: {
        Row: {
          color: string;
          created_at: string | null;
          id: string;
          name: string;
          pipeline_id: string;
          position: number;
          stage_type: string;
        };
        Insert: {
          color?: string;
          created_at?: string | null;
          id?: string;
          name: string;
          pipeline_id: string;
          position?: number;
          stage_type: string;
        };
        Update: {
          color?: string;
          created_at?: string | null;
          id?: string;
          name?: string;
          pipeline_id?: string;
          position?: number;
          stage_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pipeline_stages_pipeline_id_fkey';
            columns: ['pipeline_id'];
            isOneToOne: false;
            referencedRelation: 'pipelines';
            referencedColumns: ['id'];
          },
        ];
      };
      pipelines: {
        Row: {
          account_id: string;
          created_at: string | null;
          id: string;
          name: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          id?: string;
          name: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pipelines_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'pipelines_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_accounts: {
        Row: {
          account_id: string;
          created_at: string | null;
          id: string;
          plan_expires_on: string | null;
          plan_name: string | null;
          portal: string;
          remaining_listings: number | null;
          remaining_refreshes: number | null;
          synced_at: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          id?: string;
          plan_expires_on?: string | null;
          plan_name?: string | null;
          portal: string;
          remaining_listings?: number | null;
          remaining_refreshes?: number | null;
          synced_at?: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          id?: string;
          plan_expires_on?: string | null;
          plan_name?: string | null;
          portal?: string;
          remaining_listings?: number | null;
          remaining_refreshes?: number | null;
          synced_at?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_accounts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'portal_accounts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_import_items: {
        Row: {
          account_id: string;
          area_sqft: number | null;
          batch_group: string | null;
          bedrooms: number | null;
          city: string | null;
          created_at: string | null;
          expires_on: string | null;
          id: string;
          listing_for: string | null;
          listing_url: string | null;
          locality: string | null;
          match_candidates: Json | null;
          match_confidence: number | null;
          match_reasons: string[] | null;
          match_status: string;
          matched_property_id: string | null;
          portal: string;
          portal_listing_id: string;
          portal_status: string | null;
          posted_on: string | null;
          price: number | null;
          property_type: string | null;
          raw: Json | null;
          raw_text: string | null;
          responses: number | null;
          title: string | null;
          updated_at: string | null;
          user_id: string | null;
          views: number | null;
        };
        Insert: {
          account_id: string;
          area_sqft?: number | null;
          batch_group?: string | null;
          bedrooms?: number | null;
          city?: string | null;
          created_at?: string | null;
          expires_on?: string | null;
          id?: string;
          listing_for?: string | null;
          listing_url?: string | null;
          locality?: string | null;
          match_candidates?: Json | null;
          match_confidence?: number | null;
          match_reasons?: string[] | null;
          match_status?: string;
          matched_property_id?: string | null;
          portal: string;
          portal_listing_id: string;
          portal_status?: string | null;
          posted_on?: string | null;
          price?: number | null;
          property_type?: string | null;
          raw?: Json | null;
          raw_text?: string | null;
          responses?: number | null;
          title?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          views?: number | null;
        };
        Update: {
          account_id?: string;
          area_sqft?: number | null;
          batch_group?: string | null;
          bedrooms?: number | null;
          city?: string | null;
          created_at?: string | null;
          expires_on?: string | null;
          id?: string;
          listing_for?: string | null;
          listing_url?: string | null;
          locality?: string | null;
          match_candidates?: Json | null;
          match_confidence?: number | null;
          match_reasons?: string[] | null;
          match_status?: string;
          matched_property_id?: string | null;
          portal?: string;
          portal_listing_id?: string;
          portal_status?: string | null;
          posted_on?: string | null;
          price?: number | null;
          property_type?: string | null;
          raw?: Json | null;
          raw_text?: string | null;
          responses?: number | null;
          title?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          views?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_import_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'portal_import_items_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portal_import_items_matched_property_id_fkey';
            columns: ['matched_property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_listing_expiry_reminder_log: {
        Row: {
          account_id: string;
          attempted_at: string;
          completed_at: string | null;
          created_at: string;
          delivery_result: Json | null;
          due_on: string;
          error_message: string | null;
          failed_at: string | null;
          id: string;
          listing_id: string;
          reminder_key: string;
          reminder_kind: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          attempted_at?: string;
          completed_at?: string | null;
          created_at?: string;
          delivery_result?: Json | null;
          due_on: string;
          error_message?: string | null;
          failed_at?: string | null;
          id?: string;
          listing_id: string;
          reminder_key: string;
          reminder_kind: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          attempted_at?: string;
          completed_at?: string | null;
          created_at?: string;
          delivery_result?: Json | null;
          due_on?: string;
          error_message?: string | null;
          failed_at?: string | null;
          id?: string;
          listing_id?: string;
          reminder_key?: string;
          reminder_kind?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_listing_expiry_reminder_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'portal_listing_expiry_reminder_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portal_listing_expiry_reminder_log_listing_id_fkey';
            columns: ['listing_id'];
            isOneToOne: false;
            referencedRelation: 'property_portal_listings';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          account_id: string;
          account_role: Database['public']['Enums']['account_role_enum'];
          active_ui_language: string;
          avatar_url: string | null;
          beta_features: string[];
          calendar_archived_view: string;
          coverage_areas: string[] | null;
          created_at: string | null;
          email: string;
          full_name: string;
          id: string;
          is_available: boolean;
          is_read_only: boolean;
          org_role: Database['public']['Enums']['org_role_enum'];
          phone: string | null;
          role: string | null;
          showcase_3d_enabled: boolean | null;
          showcase_style: string | null;
          team_id: string | null;
          ui_languages: string[];
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          account_role: Database['public']['Enums']['account_role_enum'];
          active_ui_language?: string;
          avatar_url?: string | null;
          beta_features?: string[];
          calendar_archived_view?: string;
          coverage_areas?: string[] | null;
          created_at?: string | null;
          email: string;
          full_name: string;
          id?: string;
          is_available?: boolean;
          is_read_only?: boolean;
          org_role: Database['public']['Enums']['org_role_enum'];
          phone?: string | null;
          role?: string | null;
          showcase_3d_enabled?: boolean | null;
          showcase_style?: string | null;
          team_id?: string | null;
          ui_languages?: string[];
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          account_role?: Database['public']['Enums']['account_role_enum'];
          active_ui_language?: string;
          avatar_url?: string | null;
          beta_features?: string[];
          calendar_archived_view?: string;
          coverage_areas?: string[] | null;
          created_at?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          is_available?: boolean;
          is_read_only?: boolean;
          org_role?: Database['public']['Enums']['org_role_enum'];
          phone?: string | null;
          role?: string | null;
          showcase_3d_enabled?: boolean | null;
          showcase_style?: string | null;
          team_id?: string | null;
          ui_languages?: string[];
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'profiles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'profiles_team_id_fkey';
            columns: ['team_id'];
            isOneToOne: false;
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: {
          account_id: string;
          amenities: string[] | null;
          brochure_url: string | null;
          builder: string | null;
          city: string | null;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          id: string;
          images: string[] | null;
          is_published: boolean;
          latitude: number | null;
          location: string | null;
          longitude: number | null;
          name: string;
          possession_date: string | null;
          rera_project_id: string | null;
          slug: string;
          sublocality: string | null;
          total_floors: number | null;
          total_units: number | null;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          amenities?: string[] | null;
          brochure_url?: string | null;
          builder?: string | null;
          city?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_published?: boolean;
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          name: string;
          possession_date?: string | null;
          rera_project_id?: string | null;
          slug: string;
          sublocality?: string | null;
          total_floors?: number | null;
          total_units?: number | null;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          amenities?: string[] | null;
          brochure_url?: string | null;
          builder?: string | null;
          city?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_published?: boolean;
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          name?: string;
          possession_date?: string | null;
          rera_project_id?: string | null;
          slug?: string;
          sublocality?: string | null;
          total_floors?: number | null;
          total_units?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'projects_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'projects_rera_project_id_fkey';
            columns: ['rera_project_id'];
            isOneToOne: false;
            referencedRelation: 'rera_projects';
            referencedColumns: ['id'];
          },
        ];
      };
      properties: {
        Row: {
          account_id: string;
          advance: number | null;
          area_sqft: number | null;
          area_unit: string | null;
          balconies: number | null;
          bathrooms: number | null;
          bedrooms: number | null;
          bts_escalation_percent: number | null;
          bts_lease_years: number | null;
          bts_lock_in_years: number | null;
          builder_share_percent: number | null;
          city: string | null;
          conversion_type: string | null;
          copilot_search_text: string | null;
          created_at: string;
          deal_mode: string;
          deal_mode_set_by: string | null;
          deal_mode_updated_at: string | null;
          deal_remarks: string | null;
          description: string | null;
          dimensions: string | null;
          documents: string[] | null;
          facing_direction: string | null;
          features: string[] | null;
          floor_number: number | null;
          floor_plans: Json;
          floor_tenancies: Json;
          flooring: string | null;
          furnishing: string | null;
          gated_locked_images: string[];
          geocode_attempted_at: string | null;
          goodwill_amount: number | null;
          google_map_link: string | null;
          gst: number | null;
          id: string;
          ideal_for: string | null;
          images: string[] | null;
          images_cleanup_state: string;
          images_cleanup_warned_at: string | null;
          images_dereferenced_at: string | null;
          is_published: boolean | null;
          is_starred: boolean;
          jv_structure: string | null;
          khata_epid: string | null;
          khata_form: string | null;
          land_area: number | null;
          land_area_unit: string | null;
          land_use_zoning: string | null;
          land_zone: string | null;
          latitude: number | null;
          legal_status: string | null;
          like_count: number;
          listing_source: string;
          listing_type: string | null;
          locality_canonical: string | null;
          locality_place_id: string | null;
          location: string;
          location_privacy: string | null;
          longitude: number | null;
          maintenance: number | null;
          meta_catalog_error: string | null;
          meta_catalog_synced_at: string | null;
          min_bid: number | null;
          nearby_highlights: string[] | null;
          notes: string | null;
          owner_contact_id: string | null;
          owner_share_percent: number | null;
          ownership_status: string | null;
          possession_date: string | null;
          power_backup: string | null;
          price: number;
          price_per_sqft: number | null;
          private_images: string[];
          project: string | null;
          project_id: string | null;
          property_code: string | null;
          rating_count: number;
          rating_total: number;
          rent_per_month: number | null;
          rental_income: number | null;
          road_width: number | null;
          road_width_unit: string | null;
          roi: number | null;
          seller_final_price: number | null;
          seller_final_price_at: string | null;
          seller_final_price_per_sqft: number | null;
          seller_final_price_source: string | null;
          showcase_visibility: string | null;
          sold_price: number | null;
          source_property_id: string | null;
          state: string | null;
          status: string;
          status_changed_at: string | null;
          sublocality: string | null;
          super_built_area: number | null;
          tags: string[];
          tags_text: string | null;
          title: string;
          total_floors: number | null;
          tower: string | null;
          type: string;
          unit_no: string | null;
          updated_at: string;
          user_id: string | null;
          video_error: string | null;
          video_generated_at: string | null;
          video_language: string | null;
          video_status: string | null;
          video_url: string | null;
          year_built: number | null;
          youtube_error: string | null;
          youtube_status: string | null;
          youtube_uploaded_at: string | null;
          youtube_video_id: string | null;
        };
        Insert: {
          account_id: string;
          advance?: number | null;
          area_sqft?: number | null;
          area_unit?: string | null;
          balconies?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          bts_escalation_percent?: number | null;
          bts_lease_years?: number | null;
          bts_lock_in_years?: number | null;
          builder_share_percent?: number | null;
          city?: string | null;
          conversion_type?: string | null;
          copilot_search_text?: string | null;
          created_at?: string;
          deal_mode?: string;
          deal_mode_set_by?: string | null;
          deal_mode_updated_at?: string | null;
          deal_remarks?: string | null;
          description?: string | null;
          dimensions?: string | null;
          documents?: string[] | null;
          facing_direction?: string | null;
          features?: string[] | null;
          floor_number?: number | null;
          floor_plans?: Json;
          floor_tenancies?: Json;
          flooring?: string | null;
          furnishing?: string | null;
          gated_locked_images?: string[];
          geocode_attempted_at?: string | null;
          goodwill_amount?: number | null;
          google_map_link?: string | null;
          gst?: number | null;
          id?: string;
          ideal_for?: string | null;
          images?: string[] | null;
          images_cleanup_state?: string;
          images_cleanup_warned_at?: string | null;
          images_dereferenced_at?: string | null;
          is_published?: boolean | null;
          is_starred?: boolean;
          jv_structure?: string | null;
          khata_epid?: string | null;
          khata_form?: string | null;
          land_area?: number | null;
          land_area_unit?: string | null;
          land_use_zoning?: string | null;
          land_zone?: string | null;
          latitude?: number | null;
          legal_status?: string | null;
          like_count?: number;
          listing_source?: string;
          listing_type?: string | null;
          locality_canonical?: string | null;
          locality_place_id?: string | null;
          location: string;
          location_privacy?: string | null;
          longitude?: number | null;
          maintenance?: number | null;
          meta_catalog_error?: string | null;
          meta_catalog_synced_at?: string | null;
          min_bid?: number | null;
          nearby_highlights?: string[] | null;
          notes?: string | null;
          owner_contact_id?: string | null;
          owner_share_percent?: number | null;
          ownership_status?: string | null;
          possession_date?: string | null;
          power_backup?: string | null;
          price: number;
          price_per_sqft?: number | null;
          private_images?: string[];
          project?: string | null;
          project_id?: string | null;
          property_code?: string | null;
          rating_count?: number;
          rating_total?: number;
          rent_per_month?: number | null;
          rental_income?: number | null;
          road_width?: number | null;
          road_width_unit?: string | null;
          roi?: number | null;
          seller_final_price?: number | null;
          seller_final_price_at?: string | null;
          seller_final_price_per_sqft?: number | null;
          seller_final_price_source?: string | null;
          showcase_visibility?: string | null;
          sold_price?: number | null;
          source_property_id?: string | null;
          state?: string | null;
          status?: string;
          status_changed_at?: string | null;
          sublocality?: string | null;
          super_built_area?: number | null;
          tags?: string[];
          tags_text?: string | null;
          title: string;
          total_floors?: number | null;
          tower?: string | null;
          type: string;
          unit_no?: string | null;
          updated_at?: string;
          user_id?: string | null;
          video_error?: string | null;
          video_generated_at?: string | null;
          video_language?: string | null;
          video_status?: string | null;
          video_url?: string | null;
          year_built?: number | null;
          youtube_error?: string | null;
          youtube_status?: string | null;
          youtube_uploaded_at?: string | null;
          youtube_video_id?: string | null;
        };
        Update: {
          account_id?: string;
          advance?: number | null;
          area_sqft?: number | null;
          area_unit?: string | null;
          balconies?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          bts_escalation_percent?: number | null;
          bts_lease_years?: number | null;
          bts_lock_in_years?: number | null;
          builder_share_percent?: number | null;
          city?: string | null;
          conversion_type?: string | null;
          copilot_search_text?: string | null;
          created_at?: string;
          deal_mode?: string;
          deal_mode_set_by?: string | null;
          deal_mode_updated_at?: string | null;
          deal_remarks?: string | null;
          description?: string | null;
          dimensions?: string | null;
          documents?: string[] | null;
          facing_direction?: string | null;
          features?: string[] | null;
          floor_number?: number | null;
          floor_plans?: Json;
          floor_tenancies?: Json;
          flooring?: string | null;
          furnishing?: string | null;
          gated_locked_images?: string[];
          geocode_attempted_at?: string | null;
          goodwill_amount?: number | null;
          google_map_link?: string | null;
          gst?: number | null;
          id?: string;
          ideal_for?: string | null;
          images?: string[] | null;
          images_cleanup_state?: string;
          images_cleanup_warned_at?: string | null;
          images_dereferenced_at?: string | null;
          is_published?: boolean | null;
          is_starred?: boolean;
          jv_structure?: string | null;
          khata_epid?: string | null;
          khata_form?: string | null;
          land_area?: number | null;
          land_area_unit?: string | null;
          land_use_zoning?: string | null;
          land_zone?: string | null;
          latitude?: number | null;
          legal_status?: string | null;
          like_count?: number;
          listing_source?: string;
          listing_type?: string | null;
          locality_canonical?: string | null;
          locality_place_id?: string | null;
          location?: string;
          location_privacy?: string | null;
          longitude?: number | null;
          maintenance?: number | null;
          meta_catalog_error?: string | null;
          meta_catalog_synced_at?: string | null;
          min_bid?: number | null;
          nearby_highlights?: string[] | null;
          notes?: string | null;
          owner_contact_id?: string | null;
          owner_share_percent?: number | null;
          ownership_status?: string | null;
          possession_date?: string | null;
          power_backup?: string | null;
          price?: number;
          price_per_sqft?: number | null;
          private_images?: string[];
          project?: string | null;
          project_id?: string | null;
          property_code?: string | null;
          rating_count?: number;
          rating_total?: number;
          rent_per_month?: number | null;
          rental_income?: number | null;
          road_width?: number | null;
          road_width_unit?: string | null;
          roi?: number | null;
          seller_final_price?: number | null;
          seller_final_price_at?: string | null;
          seller_final_price_per_sqft?: number | null;
          seller_final_price_source?: string | null;
          showcase_visibility?: string | null;
          sold_price?: number | null;
          source_property_id?: string | null;
          state?: string | null;
          status?: string;
          status_changed_at?: string | null;
          sublocality?: string | null;
          super_built_area?: number | null;
          tags?: string[];
          tags_text?: string | null;
          title?: string;
          total_floors?: number | null;
          tower?: string | null;
          type?: string;
          unit_no?: string | null;
          updated_at?: string;
          user_id?: string | null;
          video_error?: string | null;
          video_generated_at?: string | null;
          video_language?: string | null;
          video_status?: string | null;
          video_url?: string | null;
          year_built?: number | null;
          youtube_error?: string | null;
          youtube_status?: string | null;
          youtube_uploaded_at?: string | null;
          youtube_video_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'properties_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_owner_contact_id_fkey';
            columns: ['owner_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_source_property_id_fkey';
            columns: ['source_property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_bid_events: {
        Row: {
          actor: string;
          bid_id: string;
          created_at: string;
          event: string;
          id: string;
          payload: Json | null;
        };
        Insert: {
          actor: string;
          bid_id: string;
          created_at?: string;
          event: string;
          id?: string;
          payload?: Json | null;
        };
        Update: {
          actor?: string;
          bid_id?: string;
          created_at?: string;
          event?: string;
          id?: string;
          payload?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_bid_events_bid_id_fkey';
            columns: ['bid_id'];
            isOneToOne: false;
            referencedRelation: 'property_bids';
            referencedColumns: ['id'];
          },
        ];
      };
      property_bids: {
        Row: {
          amount: number;
          bid_type: string;
          bidder_account_id: string;
          bidder_contact_id: string | null;
          bidder_user_id: string | null;
          counter_amount: number | null;
          counter_message: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          message: string | null;
          owner_account_id: string;
          property_id: string;
          resolved_at: string | null;
          status: string;
          unlock_id: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          bid_type?: string;
          bidder_account_id: string;
          bidder_contact_id?: string | null;
          bidder_user_id?: string | null;
          counter_amount?: number | null;
          counter_message?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          message?: string | null;
          owner_account_id: string;
          property_id: string;
          resolved_at?: string | null;
          status?: string;
          unlock_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          bid_type?: string;
          bidder_account_id?: string;
          bidder_contact_id?: string | null;
          bidder_user_id?: string | null;
          counter_amount?: number | null;
          counter_message?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          message?: string | null;
          owner_account_id?: string;
          property_id?: string;
          resolved_at?: string | null;
          status?: string;
          unlock_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_bids_bidder_account_id_fkey';
            columns: ['bidder_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_bids_bidder_account_id_fkey';
            columns: ['bidder_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_bids_bidder_contact_id_fkey';
            columns: ['bidder_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_bids_owner_account_id_fkey';
            columns: ['owner_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_bids_owner_account_id_fkey';
            columns: ['owner_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_bids_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_bids_unlock_id_fkey';
            columns: ['unlock_id'];
            isOneToOne: false;
            referencedRelation: 'den_match_unlocks';
            referencedColumns: ['id'];
          },
        ];
      };
      property_document_requests: {
        Row: {
          access_password: string | null;
          account_id: string;
          created_at: string;
          id: string;
          last_viewed_at: string | null;
          property_id: string;
          requester_email: string | null;
          requester_name: string;
          requester_phone: string;
          share_sent_at: string | null;
          share_token: string | null;
          share_token_expires_at: string | null;
          status: string;
          updated_at: string;
          view_count: number;
          viewed_at: string | null;
        };
        Insert: {
          access_password?: string | null;
          account_id: string;
          created_at?: string;
          id?: string;
          last_viewed_at?: string | null;
          property_id: string;
          requester_email?: string | null;
          requester_name: string;
          requester_phone: string;
          share_sent_at?: string | null;
          share_token?: string | null;
          share_token_expires_at?: string | null;
          status?: string;
          updated_at?: string;
          view_count?: number;
          viewed_at?: string | null;
        };
        Update: {
          access_password?: string | null;
          account_id?: string;
          created_at?: string;
          id?: string;
          last_viewed_at?: string | null;
          property_id?: string;
          requester_email?: string | null;
          requester_name?: string;
          requester_phone?: string;
          share_sent_at?: string | null;
          share_token?: string | null;
          share_token_expires_at?: string | null;
          status?: string;
          updated_at?: string;
          view_count?: number;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_document_requests_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_draft_sessions: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          draft_data: Json;
          id: string;
          requirement_link_id: string | null;
          session_mode: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          draft_data?: Json;
          id?: string;
          requirement_link_id?: string | null;
          session_mode?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          draft_data?: Json;
          id?: string;
          requirement_link_id?: string | null;
          session_mode?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_draft_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_draft_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_draft_sessions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: true;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_draft_sessions_requirement_link_id_fkey';
            columns: ['requirement_link_id'];
            isOneToOne: false;
            referencedRelation: 'requirement_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      property_guidance_values: {
        Row: {
          account_id: string;
          building_value: number | null;
          built_up_area_sqft: number | null;
          created_at: string | null;
          created_by: string | null;
          deal_id: string | null;
          id: string;
          land_area_sqft: number | null;
          land_value: number | null;
          property_id: string | null;
          rate_id: string | null;
          rate_snapshot: Json;
          schedule: Json;
          total_value: number;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          building_value?: number | null;
          built_up_area_sqft?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          deal_id?: string | null;
          id?: string;
          land_area_sqft?: number | null;
          land_value?: number | null;
          property_id?: string | null;
          rate_id?: string | null;
          rate_snapshot?: Json;
          schedule?: Json;
          total_value: number;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          building_value?: number | null;
          built_up_area_sqft?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          deal_id?: string | null;
          id?: string;
          land_area_sqft?: number | null;
          land_value?: number | null;
          property_id?: string | null;
          rate_id?: string | null;
          rate_snapshot?: Json;
          schedule?: Json;
          total_value?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_guidance_values_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_guidance_values_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_guidance_values_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_guidance_values_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_guidance_values_rate_id_fkey';
            columns: ['rate_id'];
            isOneToOne: false;
            referencedRelation: 'guidance_value_rates';
            referencedColumns: ['id'];
          },
        ];
      };
      property_likes: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          property_id: string;
          session_key: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          property_id: string;
          session_key: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          property_id?: string;
          session_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_likes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_likes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_likes_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_likes_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_location_repair_log: {
        Row: {
          account_id: string;
          id: string;
          location_after: string;
          location_before: string;
          property_id: string;
          repaired_at: string;
        };
        Insert: {
          account_id: string;
          id?: string;
          location_after: string;
          location_before: string;
          property_id: string;
          repaired_at?: string;
        };
        Update: {
          account_id?: string;
          id?: string;
          location_after?: string;
          location_before?: string;
          property_id?: string;
          repaired_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_location_repair_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_location_repair_log_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_repair_log_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_location_requests: {
        Row: {
          account_id: string;
          approved_at: string | null;
          approved_by: string | null;
          consent_chain: Json;
          consent_requested_at: string | null;
          contact_id: string | null;
          created_at: string;
          granted_share_id: string | null;
          id: string;
          last_viewed_at: string | null;
          pending_consent_contact_id: string | null;
          property_id: string;
          requester_name: string;
          requester_phone: string;
          scope: string;
          share_sent_at: string | null;
          share_token: string | null;
          share_token_expires_at: string | null;
          status: string;
          updated_at: string;
          via_contact_id: string | null;
          via_share_id: string | null;
          view_count: number;
        };
        Insert: {
          account_id: string;
          approved_at?: string | null;
          approved_by?: string | null;
          consent_chain?: Json;
          consent_requested_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          granted_share_id?: string | null;
          id?: string;
          last_viewed_at?: string | null;
          pending_consent_contact_id?: string | null;
          property_id: string;
          requester_name: string;
          requester_phone: string;
          scope?: string;
          share_sent_at?: string | null;
          share_token?: string | null;
          share_token_expires_at?: string | null;
          status?: string;
          updated_at?: string;
          via_contact_id?: string | null;
          via_share_id?: string | null;
          view_count?: number;
        };
        Update: {
          account_id?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          consent_chain?: Json;
          consent_requested_at?: string | null;
          contact_id?: string | null;
          created_at?: string;
          granted_share_id?: string | null;
          id?: string;
          last_viewed_at?: string | null;
          pending_consent_contact_id?: string | null;
          property_id?: string;
          requester_name?: string;
          requester_phone?: string;
          scope?: string;
          share_sent_at?: string | null;
          share_token?: string | null;
          share_token_expires_at?: string | null;
          status?: string;
          updated_at?: string;
          via_contact_id?: string | null;
          via_share_id?: string | null;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'property_location_requests_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_location_requests_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_granted_share_id_fkey';
            columns: ['granted_share_id'];
            isOneToOne: false;
            referencedRelation: 'property_share_grants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_pending_consent_contact_id_fkey';
            columns: ['pending_consent_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_via_contact_id_fkey';
            columns: ['via_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_location_requests_via_share_id_fkey';
            columns: ['via_share_id'];
            isOneToOne: false;
            referencedRelation: 'showcase_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      property_portal_listing_aliases: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          portal: string;
          portal_listing_id: string;
          property_id: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          portal: string;
          portal_listing_id: string;
          property_id: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          portal?: string;
          portal_listing_id?: string;
          property_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_portal_listing_aliases_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_portal_listing_aliases_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_portal_listing_aliases_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_portal_listings: {
        Row: {
          account_id: string;
          created_at: string | null;
          expires_on: string | null;
          expiry_reminder_sent: boolean;
          id: string;
          last_refreshed_at: string | null;
          last_synced_at: string | null;
          listing_url: string | null;
          notes: string | null;
          portal: string;
          portal_listing_id: string | null;
          posted_at: string;
          property_id: string;
          responses: number | null;
          status: string;
          updated_at: string | null;
          user_id: string | null;
          views: number | null;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          expires_on?: string | null;
          expiry_reminder_sent?: boolean;
          id?: string;
          last_refreshed_at?: string | null;
          last_synced_at?: string | null;
          listing_url?: string | null;
          notes?: string | null;
          portal: string;
          portal_listing_id?: string | null;
          posted_at?: string;
          property_id: string;
          responses?: number | null;
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
          views?: number | null;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          expires_on?: string | null;
          expiry_reminder_sent?: boolean;
          id?: string;
          last_refreshed_at?: string | null;
          last_synced_at?: string | null;
          listing_url?: string | null;
          notes?: string | null;
          portal?: string;
          portal_listing_id?: string | null;
          posted_at?: string;
          property_id?: string;
          responses?: number | null;
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
          views?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_portal_listings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_portal_listings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_portal_listings_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_ratings: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          miss_reasons: string[];
          property_id: string;
          rating: number;
          session_key: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          miss_reasons?: string[];
          property_id: string;
          rating: number;
          session_key: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          miss_reasons?: string[];
          property_id?: string;
          rating?: number;
          session_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_ratings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_ratings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_ratings_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_ratings_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_reshare_links: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          id: string;
          parent_contact_id: string | null;
          property_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          parent_contact_id?: string | null;
          property_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          parent_contact_id?: string | null;
          property_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_reshare_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_reshare_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reshare_links_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reshare_links_parent_contact_id_fkey';
            columns: ['parent_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reshare_links_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_share_grants: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          last_viewed_at: string | null;
          property_id: string;
          reveal_documents: boolean;
          reveal_listing: boolean;
          reveal_location: boolean;
          reveal_private_images: boolean;
          revoked_at: string | null;
          token: string;
          updated_at: string;
          view_count: number;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          last_viewed_at?: string | null;
          property_id: string;
          reveal_documents?: boolean;
          reveal_listing?: boolean;
          reveal_location?: boolean;
          reveal_private_images?: boolean;
          revoked_at?: string | null;
          token: string;
          updated_at?: string;
          view_count?: number;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          last_viewed_at?: string | null;
          property_id?: string;
          reveal_documents?: boolean;
          reveal_listing?: boolean;
          reveal_location?: boolean;
          reveal_private_images?: boolean;
          revoked_at?: string | null;
          token?: string;
          updated_at?: string;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'property_share_grants_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_share_grants_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_share_grants_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_share_grants_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_shares: {
        Row: {
          account_id: string;
          channel: string;
          contact_id: string;
          created_at: string;
          created_by: string | null;
          feedback_message_id: string | null;
          feedback_sent_at: string | null;
          feedback_status: string;
          id: string;
          journey_visible: boolean;
          property_id: string;
          recipient_kind: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          channel?: string;
          contact_id: string;
          created_at?: string;
          created_by?: string | null;
          feedback_message_id?: string | null;
          feedback_sent_at?: string | null;
          feedback_status?: string;
          id?: string;
          journey_visible?: boolean;
          property_id: string;
          recipient_kind?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          channel?: string;
          contact_id?: string;
          created_at?: string;
          created_by?: string | null;
          feedback_message_id?: string | null;
          feedback_sent_at?: string | null;
          feedback_status?: string;
          id?: string;
          journey_visible?: boolean;
          property_id?: string;
          recipient_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_shares_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'property_shares_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_shares_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_shares_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      public_listing_submissions: {
        Row: {
          account_id: string;
          code: string;
          created_at: string;
          created_property_id: string | null;
          documents: string[];
          expires_at: string;
          id: string;
          images: string[];
          raw_text: string;
          requirement_link_id: string | null;
          status: string;
          submitter_name: string | null;
          verified_at: string | null;
          verified_phone: string | null;
        };
        Insert: {
          account_id: string;
          code: string;
          created_at?: string;
          created_property_id?: string | null;
          documents?: string[];
          expires_at?: string;
          id?: string;
          images?: string[];
          raw_text: string;
          requirement_link_id?: string | null;
          status?: string;
          submitter_name?: string | null;
          verified_at?: string | null;
          verified_phone?: string | null;
        };
        Update: {
          account_id?: string;
          code?: string;
          created_at?: string;
          created_property_id?: string | null;
          documents?: string[];
          expires_at?: string;
          id?: string;
          images?: string[];
          raw_text?: string;
          requirement_link_id?: string | null;
          status?: string;
          submitter_name?: string | null;
          verified_at?: string | null;
          verified_phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'public_listing_submissions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'public_listing_submissions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'public_listing_submissions_created_property_id_fkey';
            columns: ['created_property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'public_listing_submissions_requirement_link_id_fkey';
            columns: ['requirement_link_id'];
            isOneToOne: false;
            referencedRelation: 'requirement_share_links';
            referencedColumns: ['id'];
          },
        ];
      };
      razorpay_orders: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          order_id: string;
          package_key: string;
          payment_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          currency?: string;
          id?: string;
          order_id: string;
          package_key: string;
          payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          order_id?: string;
          package_key?: string;
          payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'razorpay_orders_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'razorpay_orders_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      referrals: {
        Row: {
          activated_at: string | null;
          converted_at: string | null;
          id: string;
          passive_earn_expires_at: string | null;
          passive_earn_months: number;
          referee_account_id: string;
          referee_phone_verified: boolean;
          referee_plan: string | null;
          referrer_account_id: string;
          signed_up_at: string;
          signup_ip: unknown;
          status: string;
        };
        Insert: {
          activated_at?: string | null;
          converted_at?: string | null;
          id?: string;
          passive_earn_expires_at?: string | null;
          passive_earn_months?: number;
          referee_account_id: string;
          referee_phone_verified?: boolean;
          referee_plan?: string | null;
          referrer_account_id: string;
          signed_up_at?: string;
          signup_ip?: unknown;
          status?: string;
        };
        Update: {
          activated_at?: string | null;
          converted_at?: string | null;
          id?: string;
          passive_earn_expires_at?: string | null;
          passive_earn_months?: number;
          referee_account_id?: string;
          referee_phone_verified?: boolean;
          referee_plan?: string | null;
          referrer_account_id?: string;
          signed_up_at?: string;
          signup_ip?: unknown;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'referrals_referee_account_id_fkey';
            columns: ['referee_account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'referrals_referee_account_id_fkey';
            columns: ['referee_account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'referrals_referrer_account_id_fkey';
            columns: ['referrer_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'referrals_referrer_account_id_fkey';
            columns: ['referrer_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      requirement_account_share_responses: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          note: string | null;
          property_id: string;
          responder_user_id: string | null;
          sender_account_id: string;
          share_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          property_id: string;
          responder_user_id?: string | null;
          sender_account_id: string;
          share_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          property_id?: string;
          responder_user_id?: string | null;
          sender_account_id?: string;
          share_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'requirement_account_share_responses_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'requirement_account_share_responses_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_share_responses_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_share_responses_sender_account_id_fkey';
            columns: ['sender_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'requirement_account_share_responses_sender_account_id_fkey';
            columns: ['sender_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_share_responses_share_id_fkey';
            columns: ['share_id'];
            isOneToOne: false;
            referencedRelation: 'requirement_account_shares';
            referencedColumns: ['id'];
          },
        ];
      };
      requirement_account_shares: {
        Row: {
          account_id: string;
          brief: Json;
          contact_id: string;
          created_at: string;
          declined_at: string | null;
          id: string;
          recipient_account_id: string;
          recipient_contact_id: string | null;
          recipient_user_id: string;
          reference: string;
          responded_at: string | null;
          sender_account_name: string;
          sender_name: string | null;
          sender_user_id: string | null;
          status: string;
          updated_at: string;
          viewed_at: string | null;
        };
        Insert: {
          account_id: string;
          brief: Json;
          contact_id: string;
          created_at?: string;
          declined_at?: string | null;
          id?: string;
          recipient_account_id: string;
          recipient_contact_id?: string | null;
          recipient_user_id: string;
          reference: string;
          responded_at?: string | null;
          sender_account_name: string;
          sender_name?: string | null;
          sender_user_id?: string | null;
          status?: string;
          updated_at?: string;
          viewed_at?: string | null;
        };
        Update: {
          account_id?: string;
          brief?: Json;
          contact_id?: string;
          created_at?: string;
          declined_at?: string | null;
          id?: string;
          recipient_account_id?: string;
          recipient_contact_id?: string | null;
          recipient_user_id?: string;
          reference?: string;
          responded_at?: string | null;
          sender_account_name?: string;
          sender_name?: string | null;
          sender_user_id?: string | null;
          status?: string;
          updated_at?: string;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'requirement_account_shares_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'requirement_account_shares_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_shares_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_shares_recipient_account_id_fkey';
            columns: ['recipient_account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'requirement_account_shares_recipient_account_id_fkey';
            columns: ['recipient_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_account_shares_recipient_contact_id_fkey';
            columns: ['recipient_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      requirement_share_links: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          last_viewed_at: string | null;
          mode: string;
          revoked_at: string | null;
          token: string;
          updated_at: string;
          view_count: number;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          last_viewed_at?: string | null;
          mode?: string;
          revoked_at?: string | null;
          token: string;
          updated_at?: string;
          view_count?: number;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          last_viewed_at?: string | null;
          mode?: string;
          revoked_at?: string | null;
          token?: string;
          updated_at?: string;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'requirement_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'requirement_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requirement_share_links_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      rera_projects: {
        Row: {
          address: string | null;
          city: string | null;
          completion_date: string | null;
          created_at: string | null;
          id: string;
          location_coordinates: string | null;
          name: string;
          project_type: string | null;
          promoter_name: string | null;
          rera_registration_number: string | null;
          source: string | null;
          state: string | null;
          sublocality: string | null;
          total_land_area: number | null;
          total_units: number | null;
          updated_at: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          completion_date?: string | null;
          created_at?: string | null;
          id?: string;
          location_coordinates?: string | null;
          name: string;
          project_type?: string | null;
          promoter_name?: string | null;
          rera_registration_number?: string | null;
          source?: string | null;
          state?: string | null;
          sublocality?: string | null;
          total_land_area?: number | null;
          total_units?: number | null;
          updated_at?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          completion_date?: string | null;
          created_at?: string | null;
          id?: string;
          location_coordinates?: string | null;
          name?: string;
          project_type?: string | null;
          promoter_name?: string | null;
          rera_registration_number?: string | null;
          source?: string | null;
          state?: string | null;
          sublocality?: string | null;
          total_land_area?: number | null;
          total_units?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      routing_rules: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          match_value: string | null;
          priority: number;
          rule_type: string;
          target_agent_id: string | null;
          target_team_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          match_value?: string | null;
          priority?: number;
          rule_type: string;
          target_agent_id?: string | null;
          target_team_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          match_value?: string | null;
          priority?: number;
          rule_type?: string;
          target_agent_id?: string | null;
          target_team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'routing_rules_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'routing_rules_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'routing_rules_target_agent_id_fkey';
            columns: ['target_agent_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'routing_rules_target_team_id_fkey';
            columns: ['target_team_id'];
            isOneToOne: false;
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
        ];
      };
      sandbox_sender_mappings: {
        Row: {
          account_id: string;
          created_at: string | null;
          last_message_at: string | null;
          sandbox_code: string;
          sender_phone: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          last_message_at?: string | null;
          sandbox_code: string;
          sender_phone: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          last_message_at?: string | null;
          sandbox_code?: string;
          sender_phone?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sandbox_sender_mappings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'sandbox_sender_mappings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      sandbox_system_templates: {
        Row: {
          body: string;
          buttons: Json | null;
          category: string;
          created_at: string | null;
          footer: string | null;
          header_text: string | null;
          header_type: string | null;
          id: string;
          language: string;
          name: string;
        };
        Insert: {
          body: string;
          buttons?: Json | null;
          category?: string;
          created_at?: string | null;
          footer?: string | null;
          header_text?: string | null;
          header_type?: string | null;
          id?: string;
          language?: string;
          name: string;
        };
        Update: {
          body?: string;
          buttons?: Json | null;
          category?: string;
          created_at?: string | null;
          footer?: string | null;
          header_text?: string | null;
          header_type?: string | null;
          id?: string;
          language?: string;
          name?: string;
        };
        Relationships: [];
      };
      showcase_events: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          metadata: Json;
          property_id: string | null;
          session_key: string;
          share_id: string | null;
          via_contact_id: string | null;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          metadata?: Json;
          property_id?: string | null;
          session_key: string;
          share_id?: string | null;
          via_contact_id?: string | null;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          metadata?: Json;
          property_id?: string | null;
          session_key?: string;
          share_id?: string | null;
          via_contact_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'showcase_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'showcase_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'showcase_events_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'showcase_events_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'showcase_events_share_id_fkey';
            columns: ['share_id'];
            isOneToOne: false;
            referencedRelation: 'showcase_share_links';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'showcase_events_via_contact_id_fkey';
            columns: ['via_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      showcase_settings: {
        Row: {
          account_id: string;
          brand_image_url: string | null;
          contact_phone: string;
          created_at: string;
          currency: string;
          default_country_code: string | null;
          flyer_ai_provider: string;
          flyer_stability_model: string;
          id: string;
          meta_pixel_id: string | null;
          public_areas_served: string[] | null;
          public_business_description: string | null;
          public_property_expertise: string[] | null;
          showcase_3d_enabled: boolean;
          showcase_style: string;
          subdomain: string | null;
          theme: string;
          updated_at: string;
          whatsapp_message_template: string;
        };
        Insert: {
          account_id: string;
          brand_image_url?: string | null;
          contact_phone?: string;
          created_at?: string;
          currency?: string;
          default_country_code?: string | null;
          flyer_ai_provider?: string;
          flyer_stability_model?: string;
          id?: string;
          meta_pixel_id?: string | null;
          public_areas_served?: string[] | null;
          public_business_description?: string | null;
          public_property_expertise?: string[] | null;
          showcase_3d_enabled?: boolean;
          showcase_style?: string;
          subdomain?: string | null;
          theme?: string;
          updated_at?: string;
          whatsapp_message_template?: string;
        };
        Update: {
          account_id?: string;
          brand_image_url?: string | null;
          contact_phone?: string;
          created_at?: string;
          currency?: string;
          default_country_code?: string | null;
          flyer_ai_provider?: string;
          flyer_stability_model?: string;
          id?: string;
          meta_pixel_id?: string | null;
          public_areas_served?: string[] | null;
          public_business_description?: string | null;
          public_property_expertise?: string[] | null;
          showcase_3d_enabled?: boolean;
          showcase_style?: string;
          subdomain?: string | null;
          theme?: string;
          updated_at?: string;
          whatsapp_message_template?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'showcase_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'showcase_settings_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      showcase_share_links: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'showcase_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'showcase_share_links_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      showcase_visitor_devices: {
        Row: {
          account_id: string;
          contact_id: string;
          created_at: string;
          id: string;
          session_key: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          session_key: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          session_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'showcase_visitor_devices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'showcase_visitor_devices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'showcase_visitor_devices_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      signup_attempts: {
        Row: {
          created_at: string | null;
          email: string | null;
          error_message: string | null;
          gate: string;
          id: string;
          referrer: string | null;
          session_key: string;
          stage: string;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string | null;
          email?: string | null;
          error_message?: string | null;
          gate: string;
          id?: string;
          referrer?: string | null;
          session_key: string;
          stage: string;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string | null;
          error_message?: string | null;
          gate?: string;
          id?: string;
          referrer?: string | null;
          session_key?: string;
          stage?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      subscription_events: {
        Row: {
          account_id: string;
          created_at: string;
          event_type: string;
          from_plan: string | null;
          id: string;
          metadata: Json | null;
          razorpay_event_id: string | null;
          to_plan: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          event_type: string;
          from_plan?: string | null;
          id?: string;
          metadata?: Json | null;
          razorpay_event_id?: string | null;
          to_plan?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          event_type?: string;
          from_plan?: string | null;
          id?: string;
          metadata?: Json | null;
          razorpay_event_id?: string | null;
          to_plan?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'subscription_events_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      subscription_extensions: {
        Row: {
          account_id: string;
          created_at: string;
          customer_message: string | null;
          days: number;
          extended_until: string;
          granted_by: string | null;
          granted_by_email: string | null;
          id: string;
          incident_ref: string | null;
          note: string | null;
          notification_result: Json | null;
          notified_at: string | null;
          period_end_before: string | null;
          reason: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          customer_message?: string | null;
          days: number;
          extended_until: string;
          granted_by?: string | null;
          granted_by_email?: string | null;
          id?: string;
          incident_ref?: string | null;
          note?: string | null;
          notification_result?: Json | null;
          notified_at?: string | null;
          period_end_before?: string | null;
          reason: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          customer_message?: string | null;
          days?: number;
          extended_until?: string;
          granted_by?: string | null;
          granted_by_email?: string | null;
          id?: string;
          incident_ref?: string | null;
          note?: string | null;
          notification_result?: Json | null;
          notified_at?: string | null;
          period_end_before?: string | null;
          reason?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_extensions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'subscription_extensions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          account_id: string;
          billing_currency: string;
          billing_cycle: string | null;
          billing_gateway: string;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          id: string;
          max_contacts_override: number | null;
          max_properties_override: number | null;
          pending_plan: string | null;
          pending_plan_effective_at: string | null;
          plan: string;
          razorpay_customer_id: string | null;
          razorpay_plan_id: string | null;
          razorpay_subscription_id: string | null;
          status: string;
          trial_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          billing_currency?: string;
          billing_cycle?: string | null;
          billing_gateway?: string;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          max_contacts_override?: number | null;
          max_properties_override?: number | null;
          pending_plan?: string | null;
          pending_plan_effective_at?: string | null;
          plan?: string;
          razorpay_customer_id?: string | null;
          razorpay_plan_id?: string | null;
          razorpay_subscription_id?: string | null;
          status?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          billing_currency?: string;
          billing_cycle?: string | null;
          billing_gateway?: string;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          max_contacts_override?: number | null;
          max_properties_override?: number | null;
          pending_plan?: string | null;
          pending_plan_effective_at?: string | null;
          plan?: string;
          razorpay_customer_id?: string | null;
          razorpay_plan_id?: string | null;
          razorpay_subscription_id?: string | null;
          status?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'subscriptions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      support_tickets: {
        Row: {
          account_id: string;
          answer: string | null;
          answer_sent_via: string[];
          answered_at: string | null;
          answered_by_user_id: string | null;
          assigned_at: string | null;
          assigned_to_user_id: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          coverage: string | null;
          created_at: string;
          helper_reply: string | null;
          id: string;
          pathname: string | null;
          platform: string;
          preferred_channel: string;
          question: string;
          reference: string;
          status: Database['public']['Enums']['support_ticket_status'];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          account_id: string;
          answer?: string | null;
          answer_sent_via?: string[];
          answered_at?: string | null;
          answered_by_user_id?: string | null;
          assigned_at?: string | null;
          assigned_to_user_id?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          coverage?: string | null;
          created_at?: string;
          helper_reply?: string | null;
          id?: string;
          pathname?: string | null;
          platform?: string;
          preferred_channel?: string;
          question: string;
          reference: string;
          status?: Database['public']['Enums']['support_ticket_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          account_id?: string;
          answer?: string | null;
          answer_sent_via?: string[];
          answered_at?: string | null;
          answered_by_user_id?: string | null;
          assigned_at?: string | null;
          assigned_to_user_id?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          coverage?: string | null;
          created_at?: string;
          helper_reply?: string | null;
          id?: string;
          pathname?: string | null;
          platform?: string;
          preferred_channel?: string;
          question?: string;
          reference?: string;
          status?: Database['public']['Enums']['support_ticket_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'support_tickets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'support_tickets_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      system_settings: {
        Row: {
          key: string;
          updated_at: string | null;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string | null;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          account_id: string;
          color: string;
          created_at: string | null;
          id: string;
          name: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          color?: string;
          created_at?: string | null;
          id?: string;
          name: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          color?: string;
          created_at?: string | null;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'tags_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      teams: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          leader_id: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          leader_id?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          leader_id?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'teams_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'teams_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'teams_leader_id_fkey';
            columns: ['leader_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      todos: {
        Row: {
          account_id: string;
          assigned_to: string | null;
          completed: boolean;
          contact_id: string | null;
          created_at: string | null;
          deal_id: string | null;
          description: string | null;
          due_date: string | null;
          id: string;
          priority: string;
          property_id: string | null;
          reminder_sent_at: string | null;
          source: string;
          title: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          assigned_to?: string | null;
          completed?: boolean;
          contact_id?: string | null;
          created_at?: string | null;
          deal_id?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          property_id?: string | null;
          reminder_sent_at?: string | null;
          source?: string;
          title: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          assigned_to?: string | null;
          completed?: boolean;
          contact_id?: string | null;
          created_at?: string | null;
          deal_id?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          property_id?: string | null;
          reminder_sent_at?: string | null;
          source?: string;
          title?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'todos_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'todos_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'todos_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'todos_deal_id_fkey';
            columns: ['deal_id'];
            isOneToOne: false;
            referencedRelation: 'deals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'todos_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      token_escrows: {
        Row: {
          amount_minor: number;
          bidder_confirmed_at: string | null;
          created_at: string;
          currency: string;
          deal_room_id: string;
          funded_at: string | null;
          id: string;
          owner_confirmed_at: string | null;
          proposed_by: string;
          provider: string;
          provider_ref: string | null;
          refund_conditions: string | null;
          resolved_at: string | null;
          status: string;
          updated_at: string;
          webhook_log: Json;
        };
        Insert: {
          amount_minor: number;
          bidder_confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          deal_room_id: string;
          funded_at?: string | null;
          id?: string;
          owner_confirmed_at?: string | null;
          proposed_by: string;
          provider?: string;
          provider_ref?: string | null;
          refund_conditions?: string | null;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string;
          webhook_log?: Json;
        };
        Update: {
          amount_minor?: number;
          bidder_confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          deal_room_id?: string;
          funded_at?: string | null;
          id?: string;
          owner_confirmed_at?: string | null;
          proposed_by?: string;
          provider?: string;
          provider_ref?: string | null;
          refund_conditions?: string | null;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string;
          webhook_log?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'token_escrows_deal_room_id_fkey';
            columns: ['deal_room_id'];
            isOneToOne: false;
            referencedRelation: 'deal_rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      update_sessions: {
        Row: {
          account_id: string;
          collected_fields: Json;
          contact_id: string;
          created_at: string;
          id: string;
          pending_fields: Json;
          status: string;
          target_id: string;
          target_identifier: string | null;
          update_type: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          collected_fields?: Json;
          contact_id: string;
          created_at?: string;
          id?: string;
          pending_fields?: Json;
          status?: string;
          target_id: string;
          target_identifier?: string | null;
          update_type: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          collected_fields?: Json;
          contact_id?: string;
          created_at?: string;
          id?: string;
          pending_fields?: Json;
          status?: string;
          target_id?: string;
          target_identifier?: string | null;
          update_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'update_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'update_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'update_sessions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_agent_config: {
        Row: {
          account_id: string;
          agent_ref: string | null;
          api_key_encrypted: string | null;
          created_at: string | null;
          id: string;
          is_active: boolean;
          mode: string;
          phone_number: string | null;
          provider: string | null;
          reminder_audio_enabled: boolean;
          reminder_calls_enabled: boolean;
          updated_at: string | null;
          webhook_token: string;
        };
        Insert: {
          account_id: string;
          agent_ref?: string | null;
          api_key_encrypted?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean;
          mode?: string;
          phone_number?: string | null;
          provider?: string | null;
          reminder_audio_enabled?: boolean;
          reminder_calls_enabled?: boolean;
          updated_at?: string | null;
          webhook_token?: string;
        };
        Update: {
          account_id?: string;
          agent_ref?: string | null;
          api_key_encrypted?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean;
          mode?: string;
          phone_number?: string | null;
          provider?: string | null;
          reminder_audio_enabled?: boolean;
          reminder_calls_enabled?: boolean;
          updated_at?: string | null;
          webhook_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_agent_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'voice_agent_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_announcements: {
        Row: {
          account_id: string;
          audio_url: string | null;
          body_text: string;
          created_at: string | null;
          created_by: string;
          error: string | null;
          id: string;
          language: string;
          last_sent_at: string | null;
          sent_counts: Json;
          status: string;
          title: string;
          updated_at: string | null;
          video_url: string | null;
        };
        Insert: {
          account_id: string;
          audio_url?: string | null;
          body_text: string;
          created_at?: string | null;
          created_by: string;
          error?: string | null;
          id?: string;
          language?: string;
          last_sent_at?: string | null;
          sent_counts?: Json;
          status?: string;
          title: string;
          updated_at?: string | null;
          video_url?: string | null;
        };
        Update: {
          account_id?: string;
          audio_url?: string | null;
          body_text?: string;
          created_at?: string | null;
          created_by?: string;
          error?: string | null;
          id?: string;
          language?: string;
          last_sent_at?: string | null;
          sent_counts?: Json;
          status?: string;
          title?: string;
          updated_at?: string | null;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_announcements_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'voice_announcements_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_campaign_recipients: {
        Row: {
          account_id: string;
          attempts: number;
          call_log_id: string | null;
          campaign_id: string;
          charged_credits: number | null;
          contact_id: string;
          created_at: string | null;
          id: string;
          last_attempt_at: string | null;
          qualification: Json | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          attempts?: number;
          call_log_id?: string | null;
          campaign_id: string;
          charged_credits?: number | null;
          contact_id: string;
          created_at?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          qualification?: Json | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          attempts?: number;
          call_log_id?: string | null;
          campaign_id?: string;
          charged_credits?: number | null;
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          qualification?: Json | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_campaign_recipients_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'voice_campaign_recipients_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'voice_campaign_recipients_call_log_id_fkey';
            columns: ['call_log_id'];
            isOneToOne: false;
            referencedRelation: 'contact_call_logs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'voice_campaign_recipients_campaign_id_fkey';
            columns: ['campaign_id'];
            isOneToOne: false;
            referencedRelation: 'voice_campaigns';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'voice_campaign_recipients_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_campaigns: {
        Row: {
          account_id: string;
          agent_ref: string | null;
          call_window_end_hour: number;
          call_window_start_hour: number;
          created_at: string | null;
          created_by: string;
          id: string;
          max_attempts: number;
          name: string;
          property_id: string | null;
          script_context: Json;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          agent_ref?: string | null;
          call_window_end_hour?: number;
          call_window_start_hour?: number;
          created_at?: string | null;
          created_by: string;
          id?: string;
          max_attempts?: number;
          name: string;
          property_id?: string | null;
          script_context?: Json;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          agent_ref?: string | null;
          call_window_end_hour?: number;
          call_window_start_hour?: number;
          created_at?: string | null;
          created_by?: string;
          id?: string;
          max_attempts?: number;
          name?: string;
          property_id?: string | null;
          script_context?: Json;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_campaigns_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'voice_campaigns_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'voice_campaigns_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_config: {
        Row: {
          access_token: string | null;
          account_id: string;
          auto_qualify_leads: boolean;
          auto_sync_catalog: boolean;
          catalog_id: string | null;
          connected_at: string | null;
          created_at: string | null;
          display_phone_number: string | null;
          flows_key_registered_at: string | null;
          flows_private_key: string | null;
          flows_public_key: string | null;
          groups_enabled: boolean;
          id: string;
          integration_type: string;
          last_registration_error: string | null;
          migrated_from_sandbox_at: string | null;
          migrated_sandbox_code: string | null;
          number_changed_at: string | null;
          phone_number_id: string | null;
          previous_display_phone_number: string | null;
          registered_at: string | null;
          sandbox_code: string | null;
          sandbox_message_count: number;
          sandbox_message_limit: number;
          share_seller_final_price: boolean;
          status: string;
          subscribed_apps_at: string | null;
          trial_ends_at: string | null;
          updated_at: string | null;
          user_id: string;
          verify_token: string | null;
          waba_id: string | null;
        };
        Insert: {
          access_token?: string | null;
          account_id: string;
          auto_qualify_leads?: boolean;
          auto_sync_catalog?: boolean;
          catalog_id?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          display_phone_number?: string | null;
          flows_key_registered_at?: string | null;
          flows_private_key?: string | null;
          flows_public_key?: string | null;
          groups_enabled?: boolean;
          id?: string;
          integration_type?: string;
          last_registration_error?: string | null;
          migrated_from_sandbox_at?: string | null;
          migrated_sandbox_code?: string | null;
          number_changed_at?: string | null;
          phone_number_id?: string | null;
          previous_display_phone_number?: string | null;
          registered_at?: string | null;
          sandbox_code?: string | null;
          sandbox_message_count?: number;
          sandbox_message_limit?: number;
          share_seller_final_price?: boolean;
          status?: string;
          subscribed_apps_at?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_id: string;
          verify_token?: string | null;
          waba_id?: string | null;
        };
        Update: {
          access_token?: string | null;
          account_id?: string;
          auto_qualify_leads?: boolean;
          auto_sync_catalog?: boolean;
          catalog_id?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          display_phone_number?: string | null;
          flows_key_registered_at?: string | null;
          flows_private_key?: string | null;
          flows_public_key?: string | null;
          groups_enabled?: boolean;
          id?: string;
          integration_type?: string;
          last_registration_error?: string | null;
          migrated_from_sandbox_at?: string | null;
          migrated_sandbox_code?: string | null;
          number_changed_at?: string | null;
          phone_number_id?: string | null;
          previous_display_phone_number?: string | null;
          registered_at?: string | null;
          sandbox_code?: string | null;
          sandbox_message_count?: number;
          sandbox_message_limit?: number;
          share_seller_final_price?: boolean;
          status?: string;
          subscribed_apps_at?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_id?: string;
          verify_token?: string | null;
          waba_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_group_participants: {
        Row: {
          account_id: string;
          contact_id: string | null;
          created_at: string | null;
          group_id: string;
          id: string;
          joined_at: string | null;
          left_at: string | null;
          updated_at: string | null;
          wa_id: string;
        };
        Insert: {
          account_id: string;
          contact_id?: string | null;
          created_at?: string | null;
          group_id: string;
          id?: string;
          joined_at?: string | null;
          left_at?: string | null;
          updated_at?: string | null;
          wa_id: string;
        };
        Update: {
          account_id?: string;
          contact_id?: string | null;
          created_at?: string | null;
          group_id?: string;
          id?: string;
          joined_at?: string | null;
          left_at?: string | null;
          updated_at?: string | null;
          wa_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_group_participants_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_group_participants_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_group_participants_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_group_participants_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'whatsapp_groups';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_groups: {
        Row: {
          account_id: string;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          error_message: string | null;
          id: string;
          invite_link: string | null;
          join_approval_mode: string;
          participant_count: number;
          request_id: string | null;
          status: string;
          subject: string;
          updated_at: string | null;
          wa_group_id: string | null;
        };
        Insert: {
          account_id: string;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          error_message?: string | null;
          id?: string;
          invite_link?: string | null;
          join_approval_mode?: string;
          participant_count?: number;
          request_id?: string | null;
          status?: string;
          subject: string;
          updated_at?: string | null;
          wa_group_id?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          error_message?: string | null;
          id?: string;
          invite_link?: string | null;
          join_approval_mode?: string;
          participant_count?: number;
          request_id?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string | null;
          wa_group_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_groups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_groups_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_meta_flow_sessions: {
        Row: {
          account_id: string;
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string | null;
          flow_key: string;
          flow_token: string;
          id: string;
          prefill: Json;
          response: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          completed_at?: string | null;
          contact_id: string;
          created_at?: string;
          expires_at?: string | null;
          flow_key: string;
          flow_token: string;
          id?: string;
          prefill?: Json;
          response?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          completed_at?: string | null;
          contact_id?: string;
          created_at?: string;
          expires_at?: string | null;
          flow_key?: string;
          flow_token?: string;
          id?: string;
          prefill?: Json;
          response?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_meta_flow_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_meta_flow_sessions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_meta_flow_sessions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_meta_flows: {
        Row: {
          account_id: string;
          created_at: string;
          flow_json_version: string | null;
          flow_key: string;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          meta_flow_id: string | null;
          name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          flow_json_version?: string | null;
          flow_key: string;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          meta_flow_id?: string | null;
          name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          flow_json_version?: string | null;
          flow_key?: string;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          meta_flow_id?: string | null;
          name?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_meta_flows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_meta_flows_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_number_change_notices: {
        Row: {
          account_id: string;
          channel: string;
          contact_id: string;
          created_at: string;
          id: string;
          message_id: string | null;
          phone_number_id: string;
          previous_display_phone_number: string | null;
          sent_at: string | null;
          trigger: string;
        };
        Insert: {
          account_id: string;
          channel?: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          message_id?: string | null;
          phone_number_id: string;
          previous_display_phone_number?: string | null;
          sent_at?: string | null;
          trigger: string;
        };
        Update: {
          account_id?: string;
          channel?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          message_id?: string | null;
          phone_number_id?: string;
          previous_display_phone_number?: string | null;
          sent_at?: string | null;
          trigger?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_number_change_notices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_number_change_notices_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_number_change_notices_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_number_change_notices_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_number_profiles: {
        Row: {
          access_token: string;
          account_id: string;
          auto_reply_enabled: boolean;
          auto_reply_message: string | null;
          auto_sync_catalog: boolean;
          catalog_id: string | null;
          created_at: string;
          created_by: string | null;
          display_phone_number: string | null;
          id: string;
          label: string;
          last_activated_at: string | null;
          last_registration_error: string | null;
          phone_number_id: string;
          registered_at: string | null;
          subscribed_apps_at: string | null;
          updated_at: string;
          verified_name: string | null;
          verify_token: string | null;
          waba_id: string | null;
        };
        Insert: {
          access_token: string;
          account_id: string;
          auto_reply_enabled?: boolean;
          auto_reply_message?: string | null;
          auto_sync_catalog?: boolean;
          catalog_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_phone_number?: string | null;
          id?: string;
          label?: string;
          last_activated_at?: string | null;
          last_registration_error?: string | null;
          phone_number_id: string;
          registered_at?: string | null;
          subscribed_apps_at?: string | null;
          updated_at?: string;
          verified_name?: string | null;
          verify_token?: string | null;
          waba_id?: string | null;
        };
        Update: {
          access_token?: string;
          account_id?: string;
          auto_reply_enabled?: boolean;
          auto_reply_message?: string | null;
          auto_sync_catalog?: boolean;
          catalog_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_phone_number?: string | null;
          id?: string;
          label?: string;
          last_activated_at?: string | null;
          last_registration_error?: string | null;
          phone_number_id?: string;
          registered_at?: string | null;
          subscribed_apps_at?: string | null;
          updated_at?: string;
          verified_name?: string | null;
          verify_token?: string | null;
          waba_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_number_profiles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_number_profiles_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_reply_bridges: {
        Row: {
          account_id: string;
          agent_phone: string;
          agent_user_id: string;
          created_at: string;
          id: string;
          last_agent_reply_at: string | null;
          notification_message_id: string;
          target_contact_id: string;
          target_conversation_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          agent_phone: string;
          agent_user_id: string;
          created_at?: string;
          id?: string;
          last_agent_reply_at?: string | null;
          notification_message_id: string;
          target_contact_id: string;
          target_conversation_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          agent_phone?: string;
          agent_user_id?: string;
          created_at?: string;
          id?: string;
          last_agent_reply_at?: string | null;
          notification_message_id?: string;
          target_contact_id?: string;
          target_conversation_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_reply_bridges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_reply_bridges_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_reply_bridges_target_contact_id_fkey';
            columns: ['target_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'whatsapp_reply_bridges_target_conversation_id_fkey';
            columns: ['target_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_retired_number_replies: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          last_replied_at: string;
          phone_number_id: string;
          reply_count: number;
          sender_phone: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          last_replied_at?: string;
          phone_number_id: string;
          reply_count?: number;
          sender_phone: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          last_replied_at?: string;
          phone_number_id?: string;
          reply_count?: number;
          sender_phone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_retired_number_replies_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'whatsapp_retired_number_replies_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      youtube_config: {
        Row: {
          account_id: string;
          auto_upload: boolean;
          channel_id: string | null;
          channel_title: string | null;
          connected_at: string;
          id: string;
          refresh_token: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          auto_upload?: boolean;
          channel_id?: string | null;
          channel_title?: string | null;
          connected_at?: string;
          id?: string;
          refresh_token: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          auto_upload?: boolean;
          channel_id?: string | null;
          channel_title?: string | null;
          connected_at?: string;
          id?: string;
          refresh_token?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'youtube_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'account_plan_limits';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'youtube_config_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: true;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      account_plan_limits: {
        Row: {
          account_id: string | null;
          billing_cycle: string | null;
          current_period_end: string | null;
          effective_period_end: string | null;
          extension_days: number | null;
          has_ai: boolean | null;
          has_api_access: boolean | null;
          has_branded_showcase: boolean | null;
          has_custom_subdomain: boolean | null;
          has_multi_number: boolean | null;
          has_teams: boolean | null;
          max_broadcasts_per_month: number | null;
          max_contacts: number | null;
          max_properties: number | null;
          max_users: number | null;
          pending_plan: string | null;
          pending_plan_effective_at: string | null;
          plan: string | null;
          status: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      _bcast_bump: {
        Args: { bid: string; col: string; delta: number };
        Returns: undefined;
      };
      _bcast_cols_for_status: { Args: { s: string }; Returns: string[] };
      account_alerts_consent_counts: {
        Args: { p_account_id: string };
        Returns: {
          declined: number;
          granted: number;
          pending: number;
        }[];
      };
      account_audience_listings: {
        Args: { p_account_id: string; p_limit?: number };
        Returns: {
          contacts_count: number;
          last_at: string;
          property_code: string;
          property_id: string;
          title: string;
        }[];
      };
      account_locality_medians: {
        Args: { p_account_id: string };
        Returns: {
          city: string;
          listing_type: string;
          listings_count: number;
          locality: string;
          median_area_sqft: number;
          median_price: number;
          property_type: string;
        }[];
      };
      account_property_tags: {
        Args: { target_account_id: string };
        Returns: {
          tag: string;
          uses: number;
        }[];
      };
      add_journey_item_note: {
        Args: { p_account_id: string; p_item_id: string; p_note: string };
        Returns: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          created_by_name: string | null;
          id: string;
          item_id: string;
          note: string;
          stage_color: string | null;
          stage_id: string | null;
          stage_name: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'journey_stage_notes';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      admin_grant_credits_tx: {
        Args: { p_account_id: string; p_amount: number; p_description: string };
        Returns: {
          balance_after: number;
        }[];
      };
      ai_key_daily_usage: {
        Args: { p_days?: number };
        Returns: {
          calls: number;
          day: string;
          failures: number;
          feature: string;
          key_label: string;
          model: string;
          prompt_tokens: number;
          response_tokens: number;
        }[];
      };
      allocate_invoice_number: {
        Args: { p_account_id: string; p_financial_year: string };
        Returns: {
          invoice_number: string;
          sequence_number: number;
        }[];
      };
      appointment_reminder_hand_back: {
        Args: {
          p_account_id: string;
          p_appointment_id: string;
          p_claim_id: string;
          p_claimed_at: string;
          p_contact_id: string;
          p_rearmed_at: string;
          p_rearmed_known: boolean;
          p_reminder_type: string;
        };
        Returns: undefined;
      };
      appointment_reminder_keep_prior_id: {
        Args: {
          p_account_id: string;
          p_appointment_id: string;
          p_claim_id: string;
          p_contact_id: string;
          p_liaison_id: string;
          p_rearmed_at: string;
          p_rearmed_known: boolean;
          p_reminder_type: string;
          p_wa_message_id: string;
        };
        Returns: string;
      };
      automation_analytics: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          automation_id: string;
          failed: number;
          is_active: boolean;
          last_run_at: string;
          name: string;
          partial: number;
          runs: number;
          succeeded: number;
          trigger_type: string;
        }[];
      };
      beta_program_public: { Args: never; Returns: Json };
      beta_seats_taken: { Args: never; Returns: number };
      billing_analytics: { Args: { p_months?: number }; Returns: Json };
      board_focus_deal_ids: {
        Args: { target_account_id: string; target_pipeline_id: string };
        Returns: string[];
      };
      broadcast_outstanding_count: {
        Args: { p_broadcast_id: string };
        Returns: number;
      };
      budget_band_bounds: {
        Args: { p_tag_name: string };
        Returns: Record<string, unknown>;
      };
      budget_band_unit: { Args: { p_unit: string }; Returns: number };
      bulk_tag_properties: {
        Args: {
          add_tags?: string[];
          property_ids: string[];
          remove_tags?: string[];
          target_account_id: string;
        };
        Returns: {
          id: string;
          tags: string[];
        }[];
      };
      bump_copilot_qa_hit: { Args: { p_id: string }; Returns: undefined };
      bump_deal_share_view: { Args: { p_link_id: string }; Returns: undefined };
      burn_credits_tx: {
        Args: {
          p_account_id: string;
          p_cost: number;
          p_feature: string;
          p_hard_block: boolean;
          p_retry_key?: string;
        };
        Returns: {
          balance_after: number;
          deficit: number;
          success: boolean;
        }[];
      };
      call_analytics_dispositions: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          calls: number;
          disposition: string;
          followups_opened: number;
          followups_sent: number;
        }[];
      };
      call_analytics_series: {
        Args: { p_account_id: string; p_start: string; p_time_zone: string };
        Returns: {
          connected: number;
          day: string;
          total: number;
        }[];
      };
      call_analytics_summary: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          avg_duration_seconds: number;
          busy: number;
          callback_requested: number;
          connected: number;
          inbound: number;
          manual: number;
          no_answer: number;
          outbound: number;
          total: number;
          total_duration_seconds: number;
          voice_agent: number;
          voicemail: number;
          wrong_number: number;
        }[];
      };
      call_followup_funnel: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          completed: number;
          failed: number;
          opened: number;
          scheduled: number;
          sent: number;
          skipped: number;
          total: number;
        }[];
      };
      call_followup_skips: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          followups: number;
          skip_reason: string;
        }[];
      };
      claim_automation_pending_executions: {
        Args: {
          p_limit: number;
          p_max_attempts: number;
          p_stale_seconds: number;
        };
        Returns: {
          account_id: string;
          attempts: number;
          automation_id: string;
          branch: string | null;
          claim_token: string | null;
          claimed_at: string | null;
          contact_id: string | null;
          context: Json;
          created_at: string;
          id: string;
          log_id: string | null;
          next_step_position: number;
          parent_step_id: string | null;
          run_at: string;
          status: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'automation_pending_executions';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_broadcast_dispatch: {
        Args: { p_broadcast_id: string; p_lease_seconds?: number };
        Returns: boolean;
      };
      claim_broadcast_recipients: {
        Args: {
          p_broadcast_id: string;
          p_limit?: number;
          p_stale_seconds?: number;
        };
        Returns: {
          broadcast_id: string;
          claimed_at: string | null;
          contact_id: string | null;
          created_at: string | null;
          delivered_at: string | null;
          error_message: string | null;
          id: string;
          read_at: string | null;
          replied_at: string | null;
          retry_after: string | null;
          retry_count: number;
          sent_at: string | null;
          status: string;
          whatsapp_message_id: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'broadcast_recipients';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_conversation_qualification_lease: {
        Args: {
          p_account_id: string;
          p_conversation_id: string;
          p_holder: string;
          p_ttl_seconds: number;
        };
        Returns: boolean;
      };
      complete_copilot_appointment: {
        Args: {
          p_appointment_id: string;
          p_idempotency_key: string;
          p_platform: string;
        };
        Returns: Json;
      };
      contact_area_group_counts: {
        Args: { p_account_id: string; p_groups: Json };
        Returns: {
          key: string;
          n: number;
        }[];
      };
      contact_area_options: {
        Args: { p_account_id: string };
        Returns: {
          area: string;
          n: number;
        }[];
      };
      contact_cleanup_candidates: {
        Args: {
          p_account_id: string;
          p_condition: string;
          p_stale_days?: number;
        };
        Returns: {
          contact_id: string;
        }[];
      };
      contact_cleanup_counts: {
        Args: { p_account_id: string; p_stale_days?: number };
        Returns: {
          dead_or_opted_out: number;
          never_responded: number;
          stale: number;
        }[];
      };
      contacts_inquired_listing_types: {
        Args: { p_account_id: string; p_contact_ids?: string[] };
        Returns: {
          contact_id: string;
          listing_types: string[];
        }[];
      };
      contacts_inquired_properties: {
        Args: {
          p_account_id: string;
          p_contact_ids?: string[];
          p_limit?: number;
        };
        Returns: {
          contact_id: string;
          properties: Json;
        }[];
      };
      contacts_tab_counts: {
        Args: { p_account_id: string };
        Returns: {
          active: number;
          archived: number;
          favorites: number;
          market_active: number;
          pending_review: number;
          transacted: number;
        }[];
      };
      conversation_activity: {
        Args: { p_account_id: string; p_hours?: number };
        Returns: {
          conversation_id: string;
          inbound_count: number;
          message_count: number;
        }[];
      };
      copilot_usage_summary: {
        Args: { p_since: string };
        Returns: {
          accounts: number;
          audience: string;
          event: string;
          events: number;
          platform: string;
          users: number;
        }[];
      };
      dashboard_conversations_series: {
        Args: { p_account_id: string; p_start: string; p_time_zone: string };
        Returns: {
          day: string;
          incoming: number;
          outgoing: number;
        }[];
      };
      dashboard_metrics: {
        Args: {
          p_account_id: string;
          p_today_start: string;
          p_yesterday_start: string;
        };
        Returns: {
          messages_today: number;
          messages_yesterday: number;
          new_contacts_today: number;
          new_contacts_yesterday: number;
          new_conversations_today: number;
          new_conversations_yesterday: number;
          open_conversations: number;
          open_deals_count: number;
          open_deals_value: number;
        }[];
      };
      dashboard_pipeline_donut: {
        Args: { p_account_id: string };
        Returns: {
          deal_count: number;
          stage_color: string;
          stage_id: string;
          stage_name: string;
          total_value: number;
        }[];
      };
      dashboard_response_samples: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          customer_at: string;
          response_at: string;
        }[];
      };
      deal_deadlines: {
        Args: {
          p_horizon_days?: number;
          p_today: string;
          target_account_id: string;
        };
        Returns: {
          assigned_to: string;
          contact_name: string;
          deal_id: string;
          deal_title: string;
          due_date: string;
          kind: string;
          milestone_id: string;
          owner_user_id: string;
          property_title: string;
          property_unit_no: string;
          title: string;
        }[];
      };
      deal_deadlines_for_account: {
        Args: {
          p_account_id: string;
          p_horizon_days?: number;
          p_today: string;
        };
        Returns: {
          assigned_to: string;
          contact_name: string;
          deal_id: string;
          deal_title: string;
          due_date: string;
          kind: string;
          milestone_id: string;
          owner_user_id: string;
          property_title: string;
          property_unit_no: string;
          title: string;
        }[];
      };
      deal_invoice_append: {
        Args: { p_deal_id: string; p_entry: Json };
        Returns: Json;
      };
      deal_invoice_remove: {
        Args: { p_deal_id: string; p_path: string };
        Returns: Json;
      };
      dedupe_location_segments: {
        Args: { p_location: string };
        Returns: string;
      };
      defer_conversation_message: {
        Args: {
          p_account_id: string;
          p_conversation_id: string;
          p_message_id: string;
          p_payload: Json;
        };
        Returns: boolean;
      };
      defer_conversation_qualification: {
        Args: { p_conversation_id: string; p_message_id: string };
        Returns: boolean;
      };
      email_sync_health: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          events: number;
          last_at: string;
          status: string;
        }[];
      };
      ensure_default_pipeline: {
        Args: { p_account_id: string };
        Returns: string;
      };
      find_agent_profile_accounts: {
        Args: { p_phone_last10: string };
        Returns: {
          account_id: string;
          user_id: string;
        }[];
      };
      find_agent_source_contacts: {
        Args: { p_phone_last10: string };
        Returns: {
          account_id: string;
          contact_id: string;
        }[];
      };
      find_buyer_contacts: {
        Args: { p_phone_last10: string };
        Returns: {
          account_id: string;
          classification: string;
          contact_id: string;
          contact_name: string;
        }[];
      };
      find_den_owner_contacts: {
        Args: { p_phone_last10: string };
        Returns: {
          account_id: string;
          classification: string;
          contact_id: string;
          contact_name: string;
        }[];
      };
      find_property_shares_for_phone: {
        Args: { p_phone_last10: string };
        Returns: {
          account_id: string;
          property_id: string;
        }[];
      };
      finish_conversation_qualification_lease: {
        Args: {
          p_conversation_id: string;
          p_holder: string;
          p_ttl_seconds: number;
        };
        Returns: string[];
      };
      flow_analytics: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          active_runs: number;
          avg_reprompts: number;
          completed: number;
          failed: number;
          flow_id: string;
          handed_off: number;
          median_duration_seconds: number;
          name: string;
          paused_by_agent: number;
          runs: number;
          status: string;
          timed_out: number;
        }[];
      };
      flow_node_funnel: {
        Args: { p_account_id: string; p_flow_id: string; p_start: string };
        Returns: {
          node_key: string;
          node_type: string;
          runs_entered: number;
        }[];
      };
      generate_sandbox_code: { Args: never; Returns: string };
      grant_pending_referral_tx: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_description: string;
          p_related_account_id: string;
        };
        Returns: {
          pending_balance: number;
        }[];
      };
      grant_referral_credits_tx: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_description: string;
          p_expires_at?: string;
          p_related_account_id: string;
          p_type: string;
        };
        Returns: {
          balance_after: number;
        }[];
      };
      grant_subscription_credits_tx: {
        Args: {
          p_account_id: string;
          p_bonus_delta: number;
          p_monthly_amount: number;
          p_reset_at: string;
        };
        Returns: {
          balance_after: number;
        }[];
      };
      guidance_place_key: { Args: { p_text: string }; Returns: string };
      guidance_spelling_key: { Args: { p_text: string }; Returns: string };
      handoff_contact: {
        Args: { p_contact_id: string; p_new_agent_id: string };
        Returns: undefined;
      };
      hash_beta_token: { Args: { p_token: string }; Returns: string };
      immutable_array_to_text: { Args: { arr: string[] }; Returns: string };
      increment_automation_execution_count: {
        Args: { p_automation_id: string };
        Returns: undefined;
      };
      increment_flow_execution_count: {
        Args: { p_flow_id: string };
        Returns: undefined;
      };
      increment_sandbox_message_count: {
        Args: { p_account_id: string; p_limit: number };
        Returns: boolean;
      };
      inventory_attention_counts: {
        Args: { p_account_id: string };
        Returns: {
          agent_referred: boolean;
          listings: number;
          no_photos: number;
          no_pin: number;
          no_price: number;
        }[];
      };
      inventory_import_counts: {
        Args: { target_account_id: string };
        Returns: {
          import_count: number;
          property_id: string;
        }[];
      };
      inventory_source_breakdown: {
        Args: { p_account_id: string };
        Returns: {
          agent_referred: boolean;
          is_published: boolean;
          listings: number;
          status: string;
        }[];
      };
      inventory_stats: {
        Args: { p_account_id: string };
        Returns: {
          active_total: number;
          agent_referred: number;
          available: number;
          direct: number;
          pending_review: number;
          published: number;
          sold_or_contract: number;
          total: number;
        }[];
      };
      is_account_member: {
        Args: {
          min_role?: Database['public']['Enums']['account_role_enum'];
          target_account_id: string;
        };
        Returns: boolean;
      };
      is_reengagement_template: {
        Args: { p_template_name: string };
        Returns: boolean;
      };
      issue_beta_invite: {
        Args: {
          p_code: string;
          p_invitee_email?: string;
          p_invitee_phone?: string;
          p_label?: string;
          p_token_hash: string;
        };
        Returns: Json;
      };
      issue_beta_seed: {
        Args: {
          p_code: string;
          p_invitee_email?: string;
          p_invitee_phone?: string;
          p_label?: string;
          p_token_hash: string;
        };
        Returns: Json;
      };
      issue_invoice: {
        Args: { p_invoice_id: string; p_signed_at?: string };
        Returns: {
          account_id: string;
          amount_in_words: string | null;
          bill_to: Json;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cgst: number;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          deal_id: string | null;
          document_hash: string | null;
          financial_year: string | null;
          grand_total: number;
          gst_mode: string;
          gst_rate: number;
          id: string;
          igst: number;
          invoice_date: string;
          invoice_number: string | null;
          issued_at: string | null;
          issuer: Json;
          line_items: Json;
          notes: string | null;
          paid_at: string | null;
          party_id: string | null;
          pdf_path: string | null;
          place_of_supply: string | null;
          place_of_supply_code: string | null;
          property_id: string | null;
          sent_at: string | null;
          sequence_number: number | null;
          sgst: number;
          share_percent: number;
          side: string;
          signature: Json | null;
          signed_at: string | null;
          status: string;
          taxable_total: number;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'invoices';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      journey_close_branches: {
        Args: {
          p_account_id: string;
          p_actor: string;
          p_keep_won: boolean;
          p_mode: string;
          p_reason: string;
          p_subject_id: string;
        };
        Returns: number;
      };
      journey_compartment_row_in_scope: {
        Args: { p_account_id: string; p_user_id: string };
        Returns: boolean;
      };
      journey_deal_listings: {
        Args: { p_account_id: string; p_mode: string; p_subject_id: string };
        Returns: string[];
      };
      journey_open_deal_for_item: {
        Args: { p_item_id: string };
        Returns: string;
      };
      journey_overview_enquiries: {
        Args: { p_account_id: string; p_mode: string };
        Returns: {
          enquiry_count: number;
          enquiry_source_count: number;
          enquiry_sources: string[];
          last_enquired_at: string;
          last_enquiry_source: string;
          subject_id: string;
        }[];
      };
      journey_overview_groups: {
        Args: { p_account_id: string; p_mode: string };
        Returns: Json;
      };
      journey_reopen_branches: {
        Args: {
          p_account_id: string;
          p_actor: string;
          p_mode: string;
          p_subject_id: string;
        };
        Returns: number;
      };
      journey_reopen_overview_for_item: {
        Args: { p_account_id: string; p_actor: string; p_item_id: string };
        Returns: undefined;
      };
      journey_show_captured: {
        Args: { p_account_id: string; p_item_ids: string[] };
        Returns: string[];
      };
      journey_stage_kind_for_pipeline_stage: {
        Args: { stage_name: string };
        Returns: string;
      };
      journey_stage_kind_for_stage_type: {
        Args: { p_stage_type: string };
        Returns: string;
      };
      journey_stages_for_account: {
        Args: { p_account_id: string };
        Returns: {
          account_id: string;
          color: string;
          created_at: string;
          id: string;
          name: string;
          pipeline_stage_id: string | null;
          position: number;
          stage_kind: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'journey_stages';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      journey_stages_mirror_pipeline: {
        Args: { p_account_id: string; p_pipeline_id: string };
        Returns: undefined;
      };
      language_usage_stats: {
        Args: { p_account_id: string };
        Returns: {
          agents: number;
          contacts: number;
          contacts_explicit: number;
          language: string;
        }[];
      };
      lead_source_analytics: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          contacts_added: number;
          deals_created: number;
          deals_won: number;
          source: string;
          won_value: number;
        }[];
      };
      log_copilot_unmet_request: {
        Args: {
          p_account_id: string;
          p_audience?: string;
          p_capability: string;
          p_capability_key: string;
          p_pathname: string;
          p_question: string;
        };
        Returns: undefined;
      };
      mark_bot_instructions_fired: {
        Args: { p_account_id: string; p_instruction_ids: string[] };
        Returns: undefined;
      };
      mark_party_cold_unless_open: {
        Args: {
          p_account_id: string;
          p_contact_ids: string[];
          p_past_stage_kinds: string[];
        };
        Returns: Json;
      };
      match_bot_instructions: {
        Args: {
          p_account_id: string;
          p_contact_classification?: string;
          p_funnel_stage?: string;
          p_language?: string;
          p_listing_type?: string;
        };
        Returns: {
          directive: string;
          id: string;
          influence: string;
        }[];
      };
      match_copilot_qa: {
        Args: {
          p_count?: number;
          p_embedding: string;
          p_kb_version: string;
          p_threshold?: number;
        };
        Returns: {
          coverage: string;
          id: string;
          navigate_to: string;
          question: string;
          reply: string;
          similarity: number;
          source_chunks: Json;
          tour_id: string;
          unsupported_capability: string;
        }[];
      };
      merge_contact_conversations: {
        Args: {
          p_account_id: string;
          p_source_contact_id: string;
          p_target_contact_id: string;
        };
        Returns: string;
      };
      park_automation_wait: {
        Args: {
          p_account_id: string;
          p_automation_id: string;
          p_branch: string;
          p_contact_id: string;
          p_context: Json;
          p_log_id: string;
          p_next_step_position: number;
          p_parent_step_id: string;
          p_run_at: string;
          p_user_id: string;
        };
        Returns: {
          superseded_log_id: string;
        }[];
      };
      peek_beta_invite: { Args: { p_token_hash: string }; Returns: Json };
      peek_invitation: { Args: { p_token_hash: string }; Returns: Json };
      phone_has_profile: { Args: { p_phone_last10: string }; Returns: boolean };
      pipeline_stage_type_from_name: {
        Args: { stage_name: string };
        Returns: string;
      };
      portal_listing_drift: {
        Args: { target_account_id: string };
        Returns: {
          drift_kind: string;
          expires_on: string;
          last_lead_at: string;
          lead_count: number;
          listing_area_sqft: number;
          listing_price: number;
          listing_type: string;
          listing_url: string;
          parsed_area_sqft: number;
          parsed_price: number;
          parsed_property_type: string;
          portal: string;
          portal_listing_id: string;
          property_code: string;
          property_id: string;
          property_status: string;
          property_title: string;
        }[];
      };
      portfolio_buyer_rows: {
        Args: { p_account_id: string; p_limit?: number; p_offset?: number };
        Returns: {
          areas_of_interest: string[];
          buyer_user_id: string;
          contact_id: string;
          contact_name: string;
          contact_phone: string;
          display_name: string;
          linked_at: string;
          max_budget: number;
          min_budget: number;
          no_budget: boolean;
          requirement_active: boolean;
          requirements: string;
          shortlist_count: number;
          total_count: number;
        }[];
      };
      portfolio_buyer_stats: {
        Args: { p_account_id: string };
        Returns: {
          budget_max_avg: number;
          budget_max_highest: number;
          budget_max_lowest: number;
          budget_max_median: number;
          budget_min_avg: number;
          buyers_unconstrained_budget: number;
          buyers_with_budget: number;
          buyers_with_requirement: number;
          buyers_with_shortlist: number;
          linked_buyers: number;
          shortlist_items: number;
        }[];
      };
      portfolio_owner_rows: {
        Args: { p_account_id: string; p_limit?: number; p_offset?: number };
        Returns: {
          asking_value_available: number;
          bids_pending: number;
          contact_id: string;
          contact_name: string;
          contact_phone: string;
          den_user_id: string;
          digest_frequency: string;
          display_name: string;
          linked_at: string;
          properties_available: number;
          properties_sold: number;
          properties_total: number;
          total_count: number;
        }[];
      };
      portfolio_owner_stats: {
        Args: { p_account_id: string };
        Returns: {
          asking_price_avg_available: number;
          asking_value_available: number;
          bids_accepted: number;
          bids_pending: number;
          linked_owners: number;
          owners_with_listings: number;
          properties_available: number;
          properties_published: number;
          properties_sold: number;
          properties_total: number;
          properties_under_contract: number;
        }[];
      };
      project_unit_stats: {
        Args: { p_account_id: string };
        Returns: {
          available: number;
          max_bedrooms: number;
          max_price: number;
          max_rate_per_sqft: number;
          min_bedrooms: number;
          min_price: number;
          min_rate_per_sqft: number;
          project_id: string;
          sold_or_contract: number;
          units: number;
        }[];
      };
      promote_pending_referral_tx: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_related_account_id: string;
        };
        Returns: {
          balance_after: number;
        }[];
      };
      property_audience: {
        Args: { p_account_id: string; p_property_id: string };
        Returns: {
          classification: string;
          contact_id: string;
          enquired: boolean;
          last_at: string;
          name: string;
          name_tag: string;
          phone: string;
          viewed: boolean;
          views_count: number;
        }[];
      };
      property_gate_stats: {
        Args: { target_account_id: string };
        Returns: {
          approved: number;
          last_requested_at: string;
          live_grants: number;
          pending: number;
          property_id: string;
          rejected: number;
          requested: number;
        }[];
      };
      provision_marketplace_item_for_account: {
        Args: { p_account_id: string; p_marketplace_item_id: string };
        Returns: string;
      };
      publish_marketplace_item_to_existing_accounts: {
        Args: { p_marketplace_item_id: string };
        Returns: undefined;
      };
      pulse_property_viewers: {
        Args: { p_account_id: string; p_property_id: string };
        Returns: {
          contact_id: string;
          last_at: string;
          name: string;
          phone: string;
          sessions_count: number;
          views_count: number;
        }[];
      };
      pulse_stats: {
        Args: { p_account_id: string };
        Returns: {
          avg_dwell_sec: number;
          total_views: number;
          unique_sessions: number;
        }[];
      };
      pulse_top_properties: {
        Args: { p_account_id: string; p_limit?: number };
        Returns: {
          price: number;
          property_code: string;
          property_id: string;
          title: string;
          unique_views_count: number;
          views_count: number;
        }[];
      };
      pulse_viewed_properties: {
        Args: { p_account_id: string; p_limit?: number; p_sort?: string };
        Returns: {
          last_viewed_at: string;
          price: number;
          property_code: string;
          property_id: string;
          title: string;
          unique_views_count: number;
          views_count: number;
        }[];
      };
      purchase_credits_tx: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_description: string;
          p_gateway: string;
          p_gateway_order_id: string;
          p_gateway_payment_id: string;
        };
        Returns: {
          balance_after: number;
          success: boolean;
        }[];
      };
      realtime_publication_tables: { Args: never; Returns: string[] };
      recompute_broadcast_counts: { Args: { bid: string }; Returns: undefined };
      reconcile_subscriptions: { Args: never; Returns: undefined };
      redeem_invitation: { Args: { p_token_hash: string }; Returns: string };
      reengagement_batch_split: {
        Args: { p_account_id: string; p_tag_id: string };
        Returns: {
          contact_id: string;
          contact_name: string;
          contact_phone: string;
          has_alternative: boolean;
          has_enquired_property: boolean;
        }[];
      };
      reengagement_batches: {
        Args: { p_account_id: string };
        Returns: {
          broadcast_id: string;
          broadcast_name: string;
          sent_at: string;
          status: string;
          total_recipients: number;
        }[];
      };
      reengagement_leads: {
        Args: {
          p_account_id: string;
          p_broadcast_id?: string;
          p_limit?: number;
          p_offset?: number;
          p_only_matched?: boolean;
          p_sort?: string;
        };
        Returns: {
          areas: string[];
          batch_sent_at: string;
          broadcast_id: string;
          broadcast_name: string;
          budget_max: number;
          budget_min: number;
          contact_id: string;
          contact_name: string;
          contact_phone: string;
          match_count: number;
          match_event_id: string;
          match_event_status: string;
          replied_at: string;
          requirement_updated_at: string;
          status: string;
          total_count: number;
        }[];
      };
      reengagement_summary: {
        Args: { p_account_id: string; p_broadcast_id?: string };
        Returns: {
          batch_count: number;
          delivered_count: number;
          failed_count: number;
          lead_count: number;
          matched_count: number;
          read_count: number;
          replied_count: number;
          requirement_updated_count: number;
          sent_count: number;
        }[];
      };
      refund_credits_tx: {
        Args: {
          p_account_id: string;
          p_cost: number;
          p_description: string;
          p_feature: string;
        };
        Returns: {
          balance_after: number;
        }[];
      };
      release_automation_pending_execution: {
        Args: { p_claim_token: string; p_id: string };
        Returns: boolean;
      };
      release_broadcast_dispatch: {
        Args: { p_broadcast_id: string };
        Returns: undefined;
      };
      remove_account_member: { Args: { p_user_id: string }; Returns: string };
      renew_broadcast_dispatch: {
        Args: { p_broadcast_id: string; p_lease_seconds?: number };
        Returns: undefined;
      };
      renew_broadcast_recipient_claims: {
        Args: { p_ids: string[] };
        Returns: number;
      };
      renew_conversation_qualification_lease: {
        Args: {
          p_conversation_id: string;
          p_holder: string;
          p_ttl_seconds: number;
        };
        Returns: boolean;
      };
      resolve_showcase_visitor: {
        Args: {
          p_account_id: string;
          p_contact_id: string;
          p_session_key: string;
        };
        Returns: {
          contact_id: string;
          via_contact_id: string;
        }[];
      };
      resync_pipeline_stage_deals: {
        Args: { p_stage_id: string };
        Returns: number;
      };
      revoke_beta_invite: { Args: { p_id: string }; Returns: Json };
      rotate_beta_invite: {
        Args: { p_code: string; p_id: string; p_token_hash: string };
        Returns: Json;
      };
      search_guidance_value_rates: {
        Args: {
          p_district_pattern?: string;
          p_limit?: number;
          p_query: string;
        };
        Returns: {
          district: string;
          effective_from: string;
          hobli: string;
          id: string;
          land_class: string;
          locality: string;
          page: number;
          property_class: string;
          rate: number;
          road: string;
          similarity: number;
          source_id: string;
          source_title: string;
          survey_numbers: string;
          taluk: string;
          unit: string;
          village: string;
        }[];
      };
      search_guidance_value_rates_by_key: {
        Args: { p_district_pattern: string; p_key: string; p_limit?: number };
        Returns: {
          district: string;
          effective_from: string;
          hobli: string;
          id: string;
          land_class: string;
          locality: string;
          page: number;
          property_class: string;
          rate: number;
          road: string;
          similarity: number;
          source_id: string;
          source_title: string;
          survey_numbers: string;
          taluk: string;
          unit: string;
          village: string;
        }[];
      };
      search_guidance_value_rates_by_place_key: {
        Args: { p_district_pattern: string; p_key: string; p_limit?: number };
        Returns: {
          district: string;
          effective_from: string;
          hobli: string;
          id: string;
          land_class: string;
          locality: string;
          page: number;
          property_class: string;
          rate: number;
          road: string;
          similarity: number;
          source_id: string;
          source_title: string;
          survey_numbers: string;
          taluk: string;
          unit: string;
          village: string;
        }[];
      };
      seed_default_reminder_templates: {
        Args: { p_account_id: string; p_user_id: string };
        Returns: undefined;
      };
      set_member_org_role: {
        Args: {
          p_new_role: Database['public']['Enums']['org_role_enum'];
          p_user_id: string;
        };
        Returns: undefined;
      };
      set_member_role: {
        Args: {
          p_new_role: Database['public']['Enums']['account_role_enum'];
          p_user_id: string;
        };
        Returns: undefined;
      };
      set_member_team: {
        Args: { p_team_id: string; p_user_id: string };
        Returns: undefined;
      };
      sync_contact_budget_band: {
        Args: { p_contact_id: string };
        Returns: string;
      };
      sync_journey_stages_from_pipeline: {
        Args: { p_account_id: string; p_pipeline_id?: string };
        Returns: {
          account_id: string;
          color: string;
          created_at: string;
          id: string;
          name: string;
          pipeline_stage_id: string | null;
          position: number;
          stage_kind: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'journey_stages';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      sync_listing_status_from_deals: {
        Args: {
          p_account_id: string;
          p_property_id: string;
          p_requested: string;
        };
        Returns: {
          new_status: string;
          previous_status: string;
        }[];
      };
      team_analytics: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          avg_response_seconds: number;
          conversations_closed: number;
          deals_won: number;
          deals_won_value: number;
          full_name: string;
          median_response_seconds: number;
          messages_sent: number;
          open_conversations: number;
          org_role: string;
          response_samples: number;
          team_id: string;
          team_name: string;
          user_id: string;
        }[];
      };
      template_analytics: {
        Args: { p_account_id: string; p_start: string };
        Returns: {
          broadcast_campaigns: number;
          broadcast_delivered: number;
          broadcast_failed: number;
          broadcast_read: number;
          broadcast_replied: number;
          broadcast_sent: number;
          category: string;
          direct_delivered: number;
          direct_failed: number;
          direct_read: number;
          direct_sends: number;
          language: string;
          last_used_at: string;
          name: string;
          quality_score: string;
          status: string;
          template_id: string;
        }[];
      };
      template_language_coverage: {
        Args: { p_account_id: string };
        Returns: {
          approved_templates: number;
          awaiting_review: number;
          language: string;
        }[];
      };
      today_insights: {
        Args: { p_account_id: string; p_end: string; p_start: string };
        Returns: {
          inbound_conversations: number;
          messages_received: number;
          messages_sent: number;
          new_contacts: number;
          new_inquiries: number;
          responded_conversations: number;
          showcase_opens: number;
        }[];
      };
      transaction_workspace_index: {
        Args: { target_account_id: string };
        Returns: {
          actual_close_date: string;
          contact_name: string;
          currency: string;
          deal_group_id: string;
          expected_close_date: string;
          group_name: string;
          id: string;
          milestones_done: number;
          milestones_total: number;
          next_milestone_target_date: string;
          next_milestone_title: string;
          property_title: string;
          property_unit_no: string;
          source_journey_item_id: string;
          stage_color: string;
          stage_name: string;
          status: string;
          title: string;
          updated_at: string;
          value: number;
        }[];
      };
      transfer_account_ownership: {
        Args: { p_new_owner_user_id: string };
        Returns: undefined;
      };
      unmap_portal_ad: {
        Args: {
          p_account_id: string;
          p_portal: string;
          p_portal_listing_id: string;
        };
        Returns: {
          property_id: string;
          untagged_contacts: number;
        }[];
      };
      unmapped_portal_ads: {
        Args: { target_account_id: string };
        Returns: {
          guessed_property_id: string;
          guessed_property_title: string;
          last_seen_at: string;
          lead_count: number;
          portal: string;
          portal_listing_id: string;
          sample_contact_id: string;
          sample_contact_name: string;
        }[];
      };
      voice_campaign_recipient_counts: {
        Args: { target_account_id: string };
        Returns: {
          campaign_id: string;
          recipients: number;
          status: string;
        }[];
      };
      void_pending_referral_tx: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_reason: string;
          p_related_account_id: string;
        };
        Returns: {
          pending_balance: number;
        }[];
      };
      vote_copilot_qa: {
        Args: { p_id: string; p_up: boolean };
        Returns: undefined;
      };
      whatsapp_number_change_audience: {
        Args: {
          p_account_id: string;
          p_phone_number_id: string;
          p_since: string;
        };
        Returns: {
          contact_id: string;
          last_message_at: string;
          name: string;
          preferred_language: string;
        }[];
      };
      whatsapp_number_change_audience_v2: {
        Args: {
          p_account_id: string;
          p_changed_at: string;
          p_phone_number_id: string;
          p_since: string;
        };
        Returns: {
          contact_id: string;
          last_message_at: string;
          name: string;
          preferred_language: string;
        }[];
      };
    };
    Enums: {
      account_role_enum: 'owner' | 'admin' | 'agent' | 'viewer' | 'coordinator';
      beta_invite_status: 'pending' | 'accepted' | 'revoked';
      bug_severity: 'blocker' | 'major' | 'minor' | 'idea';
      bug_status:
        'new' | 'triaged' | 'in_progress' | 'fixed' | 'wont_fix' | 'duplicate';
      org_role_enum:
        'org_manager' | 'org_leader' | 'org_agent' | 'org_coordinator';
      support_ticket_status: 'open' | 'assigned' | 'answered' | 'closed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_role_enum: ['owner', 'admin', 'agent', 'viewer', 'coordinator'],
      beta_invite_status: ['pending', 'accepted', 'revoked'],
      bug_severity: ['blocker', 'major', 'minor', 'idea'],
      bug_status: [
        'new',
        'triaged',
        'in_progress',
        'fixed',
        'wont_fix',
        'duplicate',
      ],
      org_role_enum: [
        'org_manager',
        'org_leader',
        'org_agent',
        'org_coordinator',
      ],
      support_ticket_status: ['open', 'assigned', 'answered', 'closed'],
    },
  },
} as const;
