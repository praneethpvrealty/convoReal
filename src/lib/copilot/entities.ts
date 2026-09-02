export const ENTITY_SYMBOLS = ['#', '@', '&'] as const;

export type EntitySymbol = (typeof ENTITY_SYMBOLS)[number];
export type EntityKind = 'property' | 'contact' | 'event';

export interface EntityReference {
  kind: EntityKind;
  id: string;
  label: string;
}

export interface EntitySuggestion extends EntityReference {
  symbol: EntitySymbol;
  subtitle: string;
  href: string;
  status?: string;
}

export interface ActiveEntityQuery {
  symbol: EntitySymbol;
  query: string;
  start: number;
  end: number;
}

const KIND_BY_SYMBOL: Record<EntitySymbol, EntityKind> = {
  '#': 'property',
  '@': 'contact',
  '&': 'event',
};

const SYMBOL_BY_KIND: Record<EntityKind, EntitySymbol> = {
  property: '#',
  contact: '@',
  event: '&',
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function entityKindForSymbol(symbol: string): EntityKind | null {
  return ENTITY_SYMBOLS.includes(symbol as EntitySymbol)
    ? KIND_BY_SYMBOL[symbol as EntitySymbol]
    : null;
}

export function entitySymbolForKind(kind: EntityKind): EntitySymbol {
  return SYMBOL_BY_KIND[kind];
}

export function entityHref(kind: EntityKind, id: string): string {
  const encodedId = encodeURIComponent(id);
  if (kind === 'property') return `/inventory?propertyId=${encodedId}`;
  if (kind === 'contact') return `/contacts?contactId=${encodedId}`;
  return `/calendar?eventId=${encodedId}`;
}

export function sanitizeEntitySearchQuery(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s.\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function readEntityReferences(raw: unknown): EntityReference[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const references: EntityReference[] = [];

  for (const value of raw.slice(0, 8)) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as {
      kind?: unknown;
      id?: unknown;
      label?: unknown;
    };
    if (
      (candidate.kind !== 'property' &&
        candidate.kind !== 'contact' &&
        candidate.kind !== 'event') ||
      typeof candidate.id !== 'string' ||
      !UUID_PATTERN.test(candidate.id) ||
      typeof candidate.label !== 'string'
    ) {
      continue;
    }
    const label = candidate.label.trim().slice(0, 120);
    const key = `${candidate.kind}:${candidate.id}`;
    if (!label || seen.has(key)) continue;
    seen.add(key);
    references.push({ kind: candidate.kind, id: candidate.id, label });
  }

  return references;
}

export function activeEntityQuery(
  input: string,
  selected: EntityReference[] = []
): ActiveEntityQuery | null {
  const match = /(^|\s)([#@&])([^#@&\n]*)$/u.exec(input);
  if (!match) return null;
  const symbol = match[2] as EntitySymbol;
  const query = match[3].trimStart();
  const token = `${symbol}${query.trim()}`.toLocaleLowerCase();
  const alreadySelected = selected.some(
    (entity) =>
      `${entitySymbolForKind(entity.kind)}${entity.label}`.toLocaleLowerCase() ===
      token
  );
  if (alreadySelected) return null;

  const start = match.index + match[1].length;
  return { symbol, query, start, end: input.length };
}

export function insertEntityReference(
  input: string,
  active: ActiveEntityQuery,
  entity: EntityReference
): string {
  const token = `${entitySymbolForKind(entity.kind)}${entity.label}`;
  return `${input.slice(0, active.start)}${token} ${input.slice(active.end)}`;
}

export function requestedEntityNavigation(
  message: string,
  entities: EntityReference[]
): EntityReference | null {
  if (!/\b(open|show|view|take\s+me\s+to|go\s+to)\b/i.test(message)) {
    return null;
  }
  const lower = message.toLocaleLowerCase();
  return (
    entities.find((entity) =>
      lower.includes(
        `${entitySymbolForKind(entity.kind)}${entity.label}`.toLocaleLowerCase()
      )
    ) ?? (entities.length === 1 ? entities[0] : null)
  );
}
