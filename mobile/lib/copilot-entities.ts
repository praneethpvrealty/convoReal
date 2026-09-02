export type CopilotEntitySymbol = '#' | '@' | '&';
export type CopilotEntityKind = 'property' | 'contact' | 'event';

export interface CopilotEntityReference {
  kind: CopilotEntityKind;
  id: string;
  label: string;
}

export interface CopilotEntitySuggestion extends CopilotEntityReference {
  symbol: CopilotEntitySymbol;
  subtitle: string;
  href: string;
  status?: string;
}

export interface ActiveCopilotEntityQuery {
  symbol: CopilotEntitySymbol;
  query: string;
  start: number;
  end: number;
}

const SYMBOL_BY_KIND: Record<CopilotEntityKind, CopilotEntitySymbol> = {
  property: '#',
  contact: '@',
  event: '&',
};

export function copilotEntitySymbol(
  kind: CopilotEntityKind
): CopilotEntitySymbol {
  return SYMBOL_BY_KIND[kind];
}

export function activeCopilotEntityQuery(
  input: string,
  selected: CopilotEntityReference[] = []
): ActiveCopilotEntityQuery | null {
  const match = /(^|\s)([#@&])([^#@&\n]*)$/u.exec(input);
  if (!match) return null;
  const symbol = match[2] as CopilotEntitySymbol;
  const query = match[3].trimStart();
  const token = `${symbol}${query.trim()}`.toLocaleLowerCase();
  if (
    selected.some(
      (entity) =>
        `${copilotEntitySymbol(entity.kind)}${entity.label}`.toLocaleLowerCase() ===
        token
    )
  ) {
    return null;
  }
  return {
    symbol,
    query,
    start: match.index + match[1].length,
    end: input.length,
  };
}

export function insertCopilotEntity(
  input: string,
  active: ActiveCopilotEntityQuery,
  entity: CopilotEntityReference
): string {
  const token = `${copilotEntitySymbol(entity.kind)}${entity.label}`;
  return `${input.slice(0, active.start)}${token} ${input.slice(active.end)}`;
}
