import type { Property } from '@/types';

export interface AuthorityService {
  slug: string;
  name: string;
  summary: string;
  details: string[];
  faq: Array<{ question: string; answer: string }>;
}

export const AUTHORITY_SERVICES: AuthorityService[] = [
  {
    slug: 'property-sourcing',
    name: 'Property sourcing',
    summary:
      'A requirements-led search across current residential, commercial, and land opportunities.',
    details: [
      'Clarify location, property type, budget, timing, and intended use.',
      'Compare suitable published opportunities and explain material trade-offs.',
      'Coordinate viewings and introductions after the buyer chooses to proceed.',
    ],
    faq: [
      {
        question: 'What information should I share for a property search?',
        answer:
          'Share your preferred locations, property type, budget range, intended use, and target timeline. This helps the consultant narrow the live inventory without making assumptions.',
      },
      {
        question: 'Does a published listing guarantee availability?',
        answer:
          'No. Published inventory is kept current, but availability and commercial terms should be reconfirmed with the consultant before making a decision.',
      },
    ],
  },
  {
    slug: 'land-due-diligence',
    name: 'Land due-diligence coordination',
    summary:
      'Structured coordination of the legal, planning, access, and site checks relevant to a land decision.',
    details: [
      'Organise the property facts and documents available from the owner or seller.',
      'Identify questions that need review by qualified legal and technical professionals.',
      'Keep findings and open items visible before a commercial commitment.',
    ],
    faq: [
      {
        question: 'Is the consultancy a substitute for a property lawyer?',
        answer:
          'No. The consultancy can coordinate the process and organise property information, but legal opinions and title verification should come from an appropriately qualified lawyer.',
      },
      {
        question: 'Which checks may be relevant for land?',
        answer:
          'The appropriate checks depend on the property and intended use. They can include title and encumbrance review, access, survey boundaries, planning restrictions, conversion status, and utility feasibility.',
      },
    ],
  },
  {
    slug: 'land-investment-advisory',
    name: 'Land investment advisory',
    summary:
      'Decision support for comparing land opportunities against use case, risk, holding period, and budget.',
    details: [
      'Compare opportunities using consistent property and location criteria.',
      'Separate verified property facts from assumptions and future expectations.',
      'Coordinate specialist review before the buyer makes a final decision.',
    ],
    faq: [
      {
        question: 'Does advisory include a return guarantee?',
        answer:
          'No. Property values and outcomes can change. Advisory helps structure a decision using available facts and risks; it does not guarantee appreciation, income, or resale timing.',
      },
      {
        question: 'How are land opportunities compared?',
        answer:
          'Relevant factors can include location, access, permitted use, documentation status, physical characteristics, surrounding development, total cost, and fit with the buyer’s intended use.',
      },
    ],
  },
  {
    slug: 'commercial-property-advisory',
    name: 'Commercial property advisory',
    summary:
      'Search and comparison support for offices, retail, industrial, and other commercial requirements.',
    details: [
      'Define operational needs, preferred micro-markets, budget, and occupancy timeline.',
      'Compare current opportunities using relevant commercial property facts.',
      'Coordinate site visits, owner discussions, and professional review where needed.',
    ],
    faq: [
      {
        question:
          'Can the consultant help with both purchase and lease requirements?',
        answer:
          'Yes, when matching published or sourced opportunities are available. The requirement should state whether the business wants to buy, lease, or compare both routes.',
      },
      {
        question: 'What should a commercial requirement include?',
        answer:
          'Useful details include business use, preferred locations, area, budget, possession timeline, access needs, parking, power, frontage, and any property-type-specific operational constraints.',
      },
    ],
  },
];

export function getAuthorityService(slug: string): AuthorityService | null {
  return AUTHORITY_SERVICES.find((service) => service.slug === slug) ?? null;
}

export function localitySlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function publishedLocalities(properties: Property[]) {
  const localities = new Map<
    string,
    { name: string; properties: Property[] }
  >();
  for (const property of properties) {
    const name = property.city?.trim();
    if (!name) continue;
    const slug = localitySlug(name);
    if (!slug) continue;
    const existing = localities.get(slug);
    if (existing) existing.properties.push(property);
    else localities.set(slug, { name, properties: [property] });
  }
  return localities;
}
