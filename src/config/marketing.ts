export interface MarketingConfig {
  vertical: 'real_estate' | 'ecommerce' | 'generic';
  hero: {
    badge: string;
    headlineStart: string;
    headlineHighlight: string;
    headlineEnd: string;
    subheadline: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  features: Array<{
    title: string;
    description: string;
    icon: 'message' | 'bot' | 'zap' | 'globe' | 'send' | 'bell';
  }>;
  demo: {
    title: string;
    subtitle: string;
    mockMessage: string;
    parsedCard: {
      name: string;
      contact: string;
      badge: string;
      fields: Array<{ label: string; value: string; isHighlight?: boolean }>;
      matchedItem: {
        title: string;
        description: string;
        percentage: string;
      };
    };
  };
  pricing: Array<{
    name: string;
    description: string;
    price: string;
    period: string;
    features: string[];
    isPopular?: boolean;
  }>;
  faqs: Array<{ q: string; a: string }>;
}

export const REAL_ESTATE_CONFIG: MarketingConfig = {
  vertical: 'real_estate',
  hero: {
    badge: "WhatsApp-First Real Estate CRM",
    headlineStart: "Turn WhatsApp Chats into ",
    headlineHighlight: "Closed Property Deals",
    headlineEnd: "",
    subheadline: "Automate lead capturing, write professional property descriptions, and instantly match buyers to listings. Deliver listings and get inquiries directly inside WhatsApp.",
    ctaPrimary: "Get Started for Free",
    ctaSecondary: "See How It Works",
  },
  features: [
    {
      title: "WhatsApp Lead Ingestion",
      description: "Forward vCards, property texts, or even lead list screenshots directly to the CRM. Our AI processes them and saves structured drafts in bulk.",
      icon: "message",
    },
    {
      title: "Gemini Description Writer",
      description: "Provide basic details about a flat, land plot, or layout. Gemini generates highly engaging, ready-to-publish real estate copywriting automatically.",
      icon: "bot",
    },
    {
      title: "Smart Match & ROI Filters",
      description: "Auto-match buyers to listings based on price, area limits, and expected ROI yield percentage. Prioritize high-yield preferences for commercial investors.",
      icon: "zap",
    },
    {
      title: "Branded Showcase Portals",
      description: "Every agent and agency gets their own showcase URL or custom subdomain mapping (e.g. agency.convoreal.com) to present inventory to clients with quick WhatsApp CTAs.",
      icon: "globe",
    },
    {
      title: "Template Broadcasts",
      description: "Deliver Meta-approved WhatsApp templates in bulk. Reach targeted leads who match specific areas or price brackets, and monitor receipt logs.",
      icon: "send",
    },
    {
      title: "Visit Reminder Engine",
      description: "Schedule site visits on a visual calendar. The CRM fires automated WhatsApp reminder alerts to buyers and host agents to prevent missed appointments.",
      icon: "bell",
    },
  ],
  demo: {
    title: "See the AI Parser in Action",
    subtitle: "Simulate how a messy text message forwarded from WhatsApp is automatically organized and mapped into a structured client lead card.",
    mockMessage: "Hi PV Realty team, I got your contact from JP Nagar brochure. My name is Sridhar Rao. Looking for a 3 BHK duplex flat or villa plot near JP Nagar 7th Phase. Budget is strictly within 2.2 Crores. I also want at least a 4% ROI if I go for a commercial building. Email is sridhar.rao@outlook.com, phone 9845012345. Let me know if you have direct owner listings.",
    parsedCard: {
      name: "Sridhar Rao",
      contact: "9845012345 · sridhar.rao@outlook.com",
      badge: "Buyer Lead",
      fields: [
        { label: "Areas of Interest", value: "JP Nagar 7th Phase" },
        { label: "Budget Range", value: "Max ₹2.2 Cr" },
        { label: "Property Formats", value: "3 BHK Flat, Villa Plot" },
        { label: "Expected Min ROI", value: "4.0% Yield", isHighlight: true },
      ],
      matchedItem: {
        title: "JP Nagar Residential Plot (₹2.1 Cr)",
        description: "1200 Sq.Ft · Available · Owner Direct",
        percentage: "96% Match",
      },
    },
  },
  pricing: [
    {
      name: "Starter",
      description: "Try it free",
      price: "₹0",
      period: "month",
      features: [
        "1 Connected WhatsApp Number",
        "Up to 150 Ingested Contacts",
        "Up to 50 Property Listings",
        "Standard Client Showcase Portal",
        "100 Monthly AI Credits",
      ],
    },
    {
      name: "Solo Pro",
      description: "For individual agents",
      price: "₹799",
      period: "month",
      features: [
        "1 Connected WhatsApp Number",
        "Unlimited Contacts & Properties",
        "AI Description, Chatbot & Images",
        "500 Broadcasts/month",
        "Branded Showcase (Logo & Colors)",
        "Email Lead Sync (Portals)",
        "Automations & Flows",
      ],
    },
    {
      name: "Team",
      description: "For small brokerage teams",
      price: "₹2,499",
      period: "month",
      features: [
        "Up to 10 Connected Users",
        "Unlimited Contacts & Properties",
        "Everything in Solo Pro",
        "Teams & Org Hierarchy",
        "Smart Inbound Lead Routing",
        "2,000 Broadcasts/month",
      ],
      isPopular: true,
    },
    {
      name: "Agency",
      description: "For established agencies",
      price: "₹5,999",
      period: "month",
      features: [
        "Unlimited Connected Users",
        "Unlimited Contacts & Properties",
        "Everything in Team",
        "Multi-number WhatsApp Routing",
        "Custom Subdomain Showcase",
        "5,000 Broadcasts/month",
        "API Access & Webhooks",
      ],
    },
  ],
  faqs: [
    {
      q: "How does the WhatsApp Lead Ingestion work?",
      a: "Simply forward any lead message, client preference text, vCard, or screenshot from your clients to your designated CRM WhatsApp number. Our AI engine (powered by Google Gemini) automatically extracts contact details, budget constraints, and property preferences, and inserts them directly into your database within seconds.",
    },
    {
      q: "Do my clients need to install any app?",
      a: "No! Your clients use standard WhatsApp. They can browse your properties via your branded Showcase portal, ask questions, or send requirements on WhatsApp. The CRM communicates with them seamlessly, sending automated site visit reminders and property links.",
    },
    {
      q: "Can I connect my own custom domain?",
      a: "Yes! The Grow and Enterprise plans allow you to host your public property listings showcase on your own custom subdomain (e.g., listings.yourdomain.com) or root domain. We handle SSL certificates and CDN caching automatically.",
    },
    {
      q: "What is ROI Yield Matching?",
      a: "For commercial listings and investor clients, you can input expected ROI/Yield percentages. Our matching engine automatically matches investors to properties that meet or exceed their yield threshold, prioritising financial preferences over specific locations when requested.",
    },
    {
      q: "Is there a setup fee or long-term contract?",
      a: "No. ConvoReal is a month-to-month subscription service. You can upgrade, downgrade, or cancel your plan at any time directly from your billing portal.",
    },
  ],
};

export const ECOMMERCE_CONFIG: MarketingConfig = {
  vertical: 'ecommerce',
  hero: {
    badge: "WhatsApp-First E-Commerce CRM",
    headlineStart: "Turn WhatsApp Chats into ",
    headlineHighlight: "Shopify & Retail Sales",
    headlineEnd: "",
    subheadline: "Automate order ingestion, write engaging product descriptions, and instantly match customers to stock catalog items inside WhatsApp. Drive automated sales conversations on autopilot.",
    ctaPrimary: "Start My Store Free",
    ctaSecondary: "Watch Demo Video",
  },
  features: [
    {
      title: "WhatsApp Order Capture",
      description: "Auto-ingest product purchases, sizing preferences, and address details directly from customer chats. The AI automatically structures them into customer orders.",
      icon: "message",
    },
    {
      title: "AI Catalog Copywriter",
      description: "Provide simple attributes or photos. Gemini generates high-converting, SEO-optimized product listings and promotional pitches automatically.",
      icon: "bot",
    },
    {
      title: "Smart Catalog Matching",
      description: "Auto-match customers to items in your catalog based on size availability, budget, and styles. Immediately send matching options in the chat.",
      icon: "zap",
    },
    {
      title: "Mobile Showcase Catalogs",
      description: "Every merchant gets their own high-converting shopping showcase portal URL or subdomain (e.g. shop.convoreal.com) to present catalogs to clients with WhatsApp Checkout CTAs.",
      icon: "globe",
    },
    {
      title: "Template Campaigns",
      description: "Broadcast promotional catalogs and back-in-stock alerts in bulk. Reach targeted lists who bought specific sizes or categories before, with tracking metrics.",
      icon: "send",
    },
    {
      title: "Abandoned Cart Recovery",
      description: "Follow up automatically. The CRM fires automated WhatsApp reminder alerts to shoppers who left items in their checkout cart, recovered in minutes.",
      icon: "bell",
    },
  ],
  demo: {
    title: "See the Order Parser in Action",
    subtitle: "Simulate how a messy customer inquiry sent to your business profile is automatically organized into a structured retail lead card.",
    mockMessage: "Hey there! I got your contact from JP Nagar boutique card. My name is Sridhar Rao. Looking for a premium leather watch strap in dark brown, size 22mm. Budget is under 2,000 INR. Email is sridhar.rao@outlook.com, phone 9845012345. Let me know if you have direct stock.",
    parsedCard: {
      name: "Sridhar Rao",
      contact: "9845012345 · sridhar.rao@outlook.com",
      badge: "Shopping Lead",
      fields: [
        { label: "Product Interest", value: "Leather Watch Strap" },
        { label: "Size Preference", value: "22mm (Dark Brown)" },
        { label: "Budget Limit", value: "Max ₹2,000" },
        { label: "Sync Status", value: "Catalog Matched", isHighlight: true },
      ],
      matchedItem: {
        title: "Classic Brown Leather Band (₹1,800)",
        description: "22mm Italian Calfskin · In Stock · boutique item",
        percentage: "95% Match",
      },
    },
  },
  pricing: [
    {
      name: "Starter",
      description: "Try it free",
      price: "₹0",
      period: "month",
      features: [
        "1 Connected WhatsApp Business Number",
        "Up to 150 Ingested Customer Leads",
        "Up to 50 Catalog Items",
        "Standard Mobile Showcase Catalog",
        "100 Monthly AI Credits",
      ],
    },
    {
      name: "Solo Pro",
      description: "For independent online sellers",
      price: "₹799",
      period: "month",
      features: [
        "1 Connected WhatsApp Business Number",
        "Unlimited Customer Leads & Catalog Items",
        "AI Order Ingestion & Text Parsing",
        "500 Broadcasts/month",
        "Standard Mobile Showcase Catalog",
        "Stock Size & Color Specific Matching",
        "Automations & Campaigns",
      ],
    },
    {
      name: "Team",
      description: "For growing e-commerce brands",
      price: "₹2,499",
      period: "month",
      features: [
        "Up to 10 Connected Users",
        "Unlimited Customer Leads & Catalog Items",
        "Everything in Solo Pro",
        "Teams & Org Hierarchy",
        "Smart Inbound Routing",
        "2,000 Broadcasts/month",
      ],
      isPopular: true,
    },
    {
      name: "Agency",
      description: "For established retail brands",
      price: "₹5,999",
      period: "month",
      features: [
        "Unlimited Connected Users",
        "Unlimited Customer Leads & Catalog Items",
        "Everything in Team",
        "Multi-number WhatsApp Business",
        "Custom Subdomain Shop Mapping",
        "5,000 Broadcasts/month",
        "Shopify / WooCommerce Integration",
      ],
    },
  ],
  faqs: [
    {
      q: "How does the WhatsApp Order Ingestion work?",
      a: "Simply receive customer inquiries, product requests, or screenshots on your business WhatsApp. Our AI engine (powered by Google Gemini) automatically extracts the items, sizes, budgets, and delivery details, saving them directly as structured orders in your inbox panel.",
    },
    {
      q: "Can I sync ConvoReal with Shopify?",
      a: "Yes! The Enterprise plan features native Shopify and WooCommerce integrations, allowing products, inventory levels, and order syncs to happen automatically in real-time.",
    },
    {
      q: "Do shoppers need to install an app?",
      a: "No. Shoppers talk to your brand using standard WhatsApp. They can search products, make inquiries, and receive automated checkout reminders and order tracking notifications.",
    },
    {
      q: "Can I use my own custom domain for the catalog?",
      a: "Absolutely. Under our Grow and Enterprise plans, you can host your mobile showcase catalog on your own custom domain or subdomain (e.g. shop.yourbrand.com) with automated SSL security.",
    },
    {
      q: "Is there a setup fee or contract?",
      a: "No setup fees. ConvoReal is billed monthly, and you can cancel or change plans whenever you need directly in your dashboard.",
    },
  ],
};

const activeVertical = process.env.NEXT_PUBLIC_CRM_VERTICAL || 'real_estate';
export const MARKETING_CONFIG = activeVertical === 'ecommerce' ? ECOMMERCE_CONFIG : REAL_ESTATE_CONFIG;
