/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  SendPropertyListingsNodeConfig,
  StartNodeConfig,
  StartPropertyIntakeNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_property_listings"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "start_property_intake"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | StartPropertyIntakeNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Real Estate Onboarding & Showcase — list-message and buttons template
// ============================================================
const REAL_ESTATE_ONBOARDING: FlowTemplate = {
  slug: "real_estate_onboarding",
  name: "Real Estate Showcase",
  description:
    "Onboard real estate customers, segment by Buy/Rent preferences, showcase matching property listings, and capture details for agents.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["hi", "hello", "invest", "buy", "rent", "properties", "homes", "listing", "show properties"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Welcome to PV Realty! 🏡 Let's help you find your dream property. What are you looking to do?",
        footer_text: "Select a requirement option below:",
        buttons: [
          {
            reply_id: "buy",
            title: "Buy Property",
            next_node_key: "buy_menu",
          },
          {
            reply_id: "rent",
            title: "Rent Property",
            next_node_key: "rent_menu",
          },
          {
            reply_id: "list",
            title: "List My Property",
            next_node_key: "seller_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "buy_menu",
      node_type: "send_list",
      config: {
        text: "Great choice! Let's explore our buying options. What type of property interests you?",
        button_label: "View Collections",
        sections: [
          {
            title: "Residential Properties",
            rows: [
              {
                reply_id: "buy_villas",
                title: "Luxury Villas",
                description: "Premium villas in gated communities",
                next_node_key: "villas_showcase",
              },
              {
                reply_id: "buy_apartments",
                title: "Premium Apartments",
                description: "2, 3, & 4 BHK luxury residences",
                next_node_key: "apartments_showcase",
              },
              {
                reply_id: "buy_pgs",
                title: "PGs / Hostels",
                description: "Paying guest accommodations",
                next_node_key: "pgs_showcase",
              },
              {
                reply_id: "buy_vacant_plots",
                title: "Vacant Plots",
                description: "Residential plots for construction",
                next_node_key: "vacant_plots_showcase",
              },
            ],
          },
          {
            title: "Commercial & Industrial",
            rows: [
              {
                reply_id: "buy_commercial_plots",
                title: "Commercial Vacant Plots",
                description: "Plots zoned for commercial use",
                next_node_key: "commercial_plots_showcase",
              },
              {
                reply_id: "buy_farmland",
                title: "Farm Land",
                description: "Agricultural and farm land parcels",
                next_node_key: "farmland_showcase",
              },
              {
                reply_id: "buy_yield_buildings",
                title: "Rent Yielding Buildings",
                description: "Commercial buildings with tenants",
                next_node_key: "yield_buildings_showcase",
              },
              {
                reply_id: "buy_industry_land",
                title: "Industry Lands",
                description: "Industrial zones and KIADB plots",
                next_node_key: "industry_land_showcase",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "rent_menu",
      node_type: "send_buttons",
      config: {
        text: "Looking for rental properties? We have excellent listings in prime locations. Select your preference:",
        buttons: [
          {
            reply_id: "rent_2bhk",
            title: "2 BHK Apartments",
            next_node_key: "rent_2bhk_info",
          },
          {
            reply_id: "rent_3bhk",
            title: "3 BHK & Penthouse",
            next_node_key: "rent_3bhk_info",
          },
          {
            reply_id: "rent_commercial",
            title: "Commercial Space",
            next_node_key: "rent_commercial_info",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "villas_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏡 *Luxury Villas & Independent Houses*\n\nHere are our current listings:",
        empty_text: "🏡 *Luxury Villas*\n\nSorry, no villa listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Villa", "Residential House"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "apartments_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏢 *Premium Apartments & Flats*\n\nHere are our current listings:",
        empty_text: "🏢 *Premium Apartments*\n\nSorry, no apartment listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Flat/ Apartment", "Builder Floor Apartment", "Penthouse", "Studio Apartment"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "plots_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🌾 *Residential Plots & Land*\n\nHere are our current listings:",
        empty_text: "🌾 *Residential Plots*\n\nSorry, no plot listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Residential Land/ Plot"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "pgs_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏠 *PGs & Hostels*\n\nHere are our current listings:",
        empty_text: "🏠 *PGs & Hostels*\n\nSorry, no PG/hostel listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Residential PG building", "PG/ Hostel"],
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "vacant_plots_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "📐 *Residential Vacant Plots*\n\nHere are our current listings:",
        empty_text: "📐 *Residential Vacant Plots*\n\nSorry, no vacant plot listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Residential Land/ Plot"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "commercial_plots_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏗️ *Commercial Vacant Plots*\n\nHere are our current listings:",
        empty_text: "🏗️ *Commercial Vacant Plots*\n\nSorry, no commercial plot listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Commercial Land"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "farmland_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🌱 *Farm Land*\n\nHere are our current listings:",
        empty_text: "🌱 *Farm Land*\n\nSorry, no farm land listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Agricultural Land", "Farm House"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "yield_buildings_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏦 *Rent Yielding Buildings*\n\nHere are our current listings:",
        empty_text: "🏦 *Rent Yielding Buildings*\n\nSorry, no rent yielding building listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Commercial Office Space", "Office in IT Park/ SEZ", "Commercial Shop", "Commercial Showroom", "Commercial Building", "Warehouse/ Godown"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "industry_land_showcase",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏭 *Industry Lands*\n\nHere are our current listings:",
        empty_text: "🏭 *Industry Lands*\n\nSorry, no industrial land listings are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_types: ["Industrial Land", "Industrial Building", "Industrial Shed"],
        filter_listing_type: "Sale",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "rent_2bhk_info",
      node_type: "send_property_listings",
      config: {
        intro_text: "🔑 *Properties for Rent*\n\nHere are our current rental listings:",
        empty_text: "🔑 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_listing_type: "Rent",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "rent_3bhk_info",
      node_type: "send_property_listings",
      config: {
        intro_text: "🔑 *Properties for Rent*\n\nHere are our current rental listings:",
        empty_text: "🔑 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_listing_type: "Rent",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "rent_commercial_info",
      node_type: "send_property_listings",
      config: {
        intro_text: "🏢 *Properties for Rent*\n\nHere are our current rental listings:",
        empty_text: "🏢 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.",
        limit: 5,
        filter_listing_type: "Rent",
        next_node_key: "post_listings",
      } as SendPropertyListingsNodeConfig,
    },
    {
      node_key: "post_listings",
      node_type: "send_buttons",
      config: {
        text: "Interested in any of these? Our specialist can share more details, photos, and arrange a site visit. 👇",
        buttons: [
          {
            reply_id: "explore_more",
            title: "View More Categories",
            next_node_key: "buy_menu",
          },
          {
            reply_id: "talk_to_agent",
            title: "Talk to an Agent",
            next_node_key: "collect_email",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "collect_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Please reply with your email address to receive files and contact from our specialist:",
        var_key: "email",
        validation: "email",
        next_node_key: "thank_you",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "thank_you",
      node_type: "send_message",
      config: {
        text: "🙏 *Thank you!* We've received your details and will get back to you shortly.\n\nFor any urgent queries, feel free to call us: *{{account.contact_phone}}*\n\nWe look forward to helping you find your perfect property! 🏡",
        next_node_key: "handoff_onboarding",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "handoff_onboarding",
      node_type: "handoff",
      config: {
        note: "Real Estate Buyer/Tenant Lead! Captured email: {{vars.email}}.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "seller_handoff",
      node_type: "start_property_intake",
      config: {
        intro_text:
          "📋 *List Your Property*\n\n" +
          "Ready to get your property in front of serious buyers? Just share a few details and photos, " +
          "and we'll put together a polished listing for you.\n\n" +
          "• 📸 *Photos* — any angle, as many as you have\n" +
          "• 📝 *Details* — location, price, type, BHK, area, amenities, anything else worth mentioning\n\n" +
          "Send it all at once or a bit at a time — we'll piece it together and show you a preview before it goes live.\n\n" +
          "_Type *cancel* anytime to stop._",
      } as StartPropertyIntakeNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  real_estate_onboarding: REAL_ESTATE_ONBOARDING,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
