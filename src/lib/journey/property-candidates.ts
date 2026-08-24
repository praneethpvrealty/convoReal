export interface JourneyPropertyCandidate {
  id: string;
  title: string;
  property_code?: string | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  type?: string | null;
  tags?: string[] | null;
}

export interface RankedPropertyCandidate<T extends JourneyPropertyCandidate> {
  property: T;
  score: number;
  reason: string;
}

const GENERIC = new Set([
  'about',
  'buyer',
  'commercial',
  'company',
  'farm',
  'land',
  'larger',
  'looking',
  'near',
  'owner',
  'property',
  'prospective',
  'space',
  'station',
  'wants',
]);

function normalized(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value?: string | null): Set<string> {
  return new Set(
    normalized(value)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !GENERIC.has(word))
  );
}

function overlap(query: Set<string>, value?: string | null): string[] {
  return [...tokens(value)].filter((word) => query.has(word));
}

export function rankJourneyPropertyCandidates<
  T extends JourneyPropertyCandidate,
>(queryText: string, properties: T[], limit = 3): RankedPropertyCandidate<T>[] {
  const query = tokens(queryText);
  const normalizedQuery = normalized(queryText);

  return properties
    .map((property) => {
      const title = normalized(property.title);
      const locality = normalized(property.sublocality || property.location);
      const titleHits = overlap(query, property.title);
      const locationHits = overlap(
        query,
        [property.sublocality, property.location, property.city]
          .filter(Boolean)
          .join(' ')
      );
      const typeHits = overlap(query, property.type);
      const tagHits = overlap(query, (property.tags || []).join(' '));
      let score =
        titleHits.length * 25 +
        locationHits.length * 35 +
        typeHits.length * 10 +
        tagHits.length * 15;
      if (title.length >= 8 && normalizedQuery.includes(title)) score += 400;
      if (locality.length >= 4 && normalizedQuery.includes(locality)) score += 140;

      const reasonParts = [
        locationHits.length ? `location ${locationHits.slice(0, 2).join(', ')}` : '',
        titleHits.length ? `title ${titleHits.slice(0, 2).join(', ')}` : '',
        tagHits.length ? `tags ${tagHits.slice(0, 2).join(', ')}` : '',
      ].filter(Boolean);
      return {
        property,
        score,
        reason: reasonParts.join(' · '),
      };
    })
    .filter((candidate) => candidate.score >= 25 && candidate.reason)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.property.property_code || '').localeCompare(
          b.property.property_code || ''
        )
    )
    .slice(0, limit);
}
