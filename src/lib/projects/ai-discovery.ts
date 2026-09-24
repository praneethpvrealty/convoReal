import { generateJson } from '@/lib/ai/gemini';

export type ProjectSource = 'rera' | 'curated' | 'ai';

export const PROJECT_TYPES = ['Flat/ Apartment', 'Villa', 'Residential Land/ Plot'] as const;

export interface AiDiscoveredProject {
  name: string;
  promoter_name: string | null;
  project_type: string;
  sublocality: string;
  city: string;
  state: string;
  address: string;
  total_units: number | null;
  total_land_area: number | null;
  rera_registration_number: null;
  source: 'ai';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function toAiDiscoveredProject(raw: unknown): AiDiscoveredProject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name);
  if (!name) return null;
  const type = text(r.project_type);
  const units = positiveNumber(r.total_units);
  return {
    name,
    promoter_name: text(r.promoter_name) || null,
    project_type: (PROJECT_TYPES as readonly string[]).includes(type) ? type : 'Flat/ Apartment',
    sublocality: text(r.sublocality),
    city: text(r.city) || 'Bangalore',
    state: text(r.state) || 'Karnataka',
    address: text(r.address),
    total_units: units === null ? null : Math.round(units),
    total_land_area: positiveNumber(r.total_land_area),
    rera_registration_number: null,
    source: 'ai',
  };
}

const LOOKUP_SYSTEM =
  'You identify real estate projects in and around Bangalore. Reply with a JSON object, or the JSON literal null when you do not recognise the project. Never guess a builder or location you are unsure of; leave that field empty instead.';

export function buildProjectLookupPrompt(term: string): string {
  return `Identify the real estate project (apartment, villa, or layout/plot) matching the query: "${term}" in Bangalore or its outskirts.
Return a JSON object with:
- name: project name
- promoter_name: builder name, or "" if unsure
- project_type: one of "Flat/ Apartment", "Villa", "Residential Land/ Plot"
- sublocality: area or road name, or "" if unsure
- city: "Bangalore"
- state: "Karnataka"
- address: street location, or "" if unsure

If the project cannot be identified as a real project in Bangalore, return null.`;
}

export async function lookupProject(term: string): Promise<AiDiscoveredProject | null> {
  const raw = await generateJson(buildProjectLookupPrompt(term), LOOKUP_SYSTEM, {
    feature: 'project_lookup',
  });
  return toAiDiscoveredProject(JSON.parse(raw));
}
