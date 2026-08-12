// Wire shapes returned by /api/v1. Mirrors src/lib/v1/projections.ts.

export interface V1Property {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  city: string | null;
  type: string | null;
  listing_type: string | null;
  status: string | null;
  project: string | null;
  bedrooms: number | null;
  area_sqft: number | null;
  rent_per_month: number | null;
  roi: number | null;
  is_published: boolean;
  updated_at: string | null;
}

export interface V1PropertyDetail extends V1Property {
  description: string | null;
  state: string | null;
  price_per_sqft: number | null;
  bathrooms: number | null;
  area_unit: string | null;
  land_area: number | null;
  land_area_unit: string | null;
  rental_income: number | null;
  possession_date: string | null;
  created_at: string | null;
}

export interface V1Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  classification: string | null;
  lead_temp: string | null;
  budget: { min: number | null; max: number | null; unconstrained: boolean };
  areas_of_interest: string[];
  requirements: string | null;
  requirement_active: boolean;
  last_contacted_at: string | null;
}

export interface V1ContactDetail extends V1Contact {
  company: string | null;
  status: string | null;
  projects_of_interest: string[];
  property_interests: string[];
  strict_area_match: boolean;
  strict_project_match: boolean;
  created_at: string | null;
}

/** Per-field verdicts from the matching engine (src/lib/matching.ts). */
export interface MatchDetails {
  type: string;
  location: string;
  budget: string;
  bhk: string;
  roi: string;
  project?: string;
}

export interface ContactMatch {
  contact: V1Contact;
  score: number;
  details: MatchDetails;
  reasons: string[];
}

export interface PropertyMatch {
  property: V1Property;
  score: number;
  details: MatchDetails;
  reasons: string[];
}

export interface V1Note {
  id: string;
  note_text: string;
  created_at: string;
  user_id: string | null;
}

export interface V1RadarEvent {
  id: string;
  kind: 'new_property' | 'buyer_updated';
  status: string;
  created_at: string;
  sent_count: number;
  sent_at: string | null;
  subject: Record<string, unknown> & { type: string };
  matches: { id?: string; name?: string; score?: number; chips?: string[] }[];
}

export interface V1Deal {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  status: string | null;
  expected_close_date: string | null;
  notes: string | null;
  stage: { id: string; name: string } | null;
  pipeline: { id: string; name: string } | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  property: { id: string; title: string; location: string | null } | null;
  updated_at: string | null;
}

export interface V1Appointment {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
  property: { id: string; title: string } | null;
}

export interface V1Todo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  completed: boolean;
  contact?: { id: string; name: string | null } | null;
  property?: { id: string; title: string } | null;
}

export interface V1Agenda {
  from: string;
  to: string;
  appointments: V1Appointment[];
  todos: V1Todo[];
  truncated: { appointments: boolean; todos: boolean };
  note?: string;
}

// ── Portfolio (owner + buyer portals), from /api/v1/portfolio ──

export interface OwnerPortfolioStats {
  linked_owners: number;
  owners_with_listings: number;
  properties: {
    total: number;
    available: number;
    under_contract: number;
    sold: number;
    published: number;
  };
  asking_value_available: number | null;
  asking_price_avg_available: number | null;
  bids: { pending: number; accepted: number };
}

export interface BuyerPortfolioStats {
  linked_buyers: number;
  buyers_with_budget: number;
  buyers_unconstrained_budget: number;
  buyers_with_requirement: number;
  budget: {
    min_avg: number | null;
    max_avg: number | null;
    max_median: number | null;
    max_lowest: number | null;
    max_highest: number | null;
  };
  shortlist: { items: number; buyers_with_items: number };
}

export interface PortfolioSummary {
  owners: OwnerPortfolioStats;
  buyers: BuyerPortfolioStats;
}

export interface OwnerPortfolioRow {
  den_user_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  linked_at: string | null;
  digest_frequency: string | null;
  properties: { total: number; available: number; sold: number };
  asking_value_available: number | null;
  bids_pending: number;
}

export interface BuyerPortfolioRow {
  buyer_user_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  linked_at: string | null;
  budget: { min: number | null; max: number | null; unconstrained: boolean };
  areas_of_interest: string[];
  requirements: string | null;
  requirement_active: boolean;
  shortlist_count: number;
}
