/**
 * Transaction Workspace financials — record-keeping, not accounting.
 *
 * The workspace records what was agreed and what has moved; it does
 * not ledger, reconcile, compute tax or produce reports. Every column
 * here is INTERNAL ONLY: `INTERNAL_ONLY_DEAL_FIELDS` is the deny-list
 * that `projectDealForExternal` strips and that financials.test.ts
 * checks against every external representation of a deal (the v1
 * API's SELECT, the public routes). A field added here is denied
 * everywhere by construction.
 *
 * Token money has one source of truth per deal. A deal that closes an
 * Owners Den bid room (`deal_room_id` set) reads its token from
 * `token_escrows` and refuses the token_* columns; any other deal
 * records token/advance directly.
 */

export type TdsStatus = 'not_applicable' | 'expected' | 'deducted' | 'deposited';

export const TDS_STATUSES: readonly TdsStatus[] = [
  'not_applicable',
  'expected',
  'deducted',
  'deposited',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const TDS_STATUS_LABELS: Record<TdsStatus, string> = {
  not_applicable: 'Not applicable',
  expected: 'Expected',
  deducted: 'Deducted',
  deposited: 'Deposited',
};

export interface DealFinancials {
  agreed_consideration: number | null;
  registered_consideration: number | null;
  other_component: number | null;
  token_amount: number | null;
  token_received_at: string | null;
  token_instrument_ref: string | null;
  tds_status: TdsStatus | null;
  tds_amount: number | null;
  payment_instrument_refs: string | null;
  brokerage_received_amount: number | null;
}

export const DEAL_FINANCIAL_FIELDS = [
  'agreed_consideration',
  'registered_consideration',
  'other_component',
  'token_amount',
  'token_received_at',
  'token_instrument_ref',
  'tds_status',
  'tds_amount',
  'payment_instrument_refs',
  'brokerage_received_amount',
] as const satisfies readonly (keyof DealFinancials)[];

/** Never leaves the account — not through /api/v1, not through a
 *  public route, not through a stakeholder link. The full financial
 *  set plus the linkage ids an outsider could correlate records with. */
export const INTERNAL_ONLY_DEAL_FIELDS: readonly string[] = [
  ...DEAL_FINANCIAL_FIELDS,
  'deal_room_id',
  'source_journey_item_id',
];

/** Hidden from every stakeholder audience (buyer, seller, advocate…).
 *  A superset of the internal-only list: the account's own API key may
 *  read `notes`, a stakeholder link never does. */
export const STAKEHOLDER_HIDDEN_DEAL_FIELDS: readonly string[] = [
  ...INTERNAL_ONLY_DEAL_FIELDS,
  'notes',
];

export const TOKEN_FIELDS = [
  'token_amount',
  'token_received_at',
  'token_instrument_ref',
] as const;

export type TokenSource = 'deal' | 'token_safe';

/** Where a deal's token money lives. Linkage decides, not the caller. */
export function tokenSourceFor(deal: { deal_room_id: string | null }): TokenSource {
  return deal.deal_room_id ? 'token_safe' : 'deal';
}

export function projectDealForExternal<T extends Record<string, unknown>>(
  row: T
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!STAKEHOLDER_HIDDEN_DEAL_FIELDS.includes(key)) out[key] = value;
  }
  return out as Partial<T>;
}

export function containsInternalDealField(text: string): string[] {
  return INTERNAL_ONLY_DEAL_FIELDS.filter((field) =>
    new RegExp(`\\b${field}\\b`).test(text)
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function money(v: unknown, label: string): ParseResult<number | null> {
  if (v === null || v === '' || v === undefined) return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative amount` };
  }
  if (n > 999_999_999_999) {
    return { ok: false, error: `${label} is out of range` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function text(v: unknown, label: string, max: number): ParseResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${label} must be text` };
  const t = v.trim();
  if (t.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or less` };
  }
  return { ok: true, value: t || null };
}

/**
 * Parse a financials patch. Only the keys present are returned, so a
 * PATCH that names one field touches one column.
 */
export function parseFinancialsPatch(
  raw: unknown,
  tokenSource: TokenSource
): ParseResult<Partial<DealFinancials>> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Nothing to update' };
  }
  const input = raw as Record<string, unknown>;
  const patch: Partial<DealFinancials> = {};

  const touchedToken = TOKEN_FIELDS.filter((f) => input[f] !== undefined);
  if (tokenSource === 'token_safe' && touchedToken.length > 0) {
    return {
      ok: false,
      error:
        'Token money for this deal is recorded in Token Safe and cannot be edited here.',
    };
  }

  const moneyFields = [
    ['agreed_consideration', 'Agreed consideration'],
    ['registered_consideration', 'Registered consideration'],
    ['other_component', 'Other component'],
    ['token_amount', 'Token amount'],
    ['tds_amount', 'TDS amount'],
    ['brokerage_received_amount', 'Brokerage received'],
  ] as const;
  for (const [key, label] of moneyFields) {
    if (input[key] === undefined) continue;
    const r = money(input[key], label);
    if (!r.ok) return r;
    patch[key] = r.value;
  }

  if (input.token_received_at !== undefined) {
    const v = input.token_received_at;
    if (v === null || v === '') patch.token_received_at = null;
    else if (typeof v === 'string' && DATE_ONLY.test(v)) patch.token_received_at = v;
    else return { ok: false, error: 'token_received_at must be YYYY-MM-DD' };
  }

  if (input.tds_status !== undefined) {
    const v = input.tds_status;
    if (v === null || v === '') patch.tds_status = null;
    else if (typeof v === 'string' && (TDS_STATUSES as readonly string[]).includes(v))
      patch.tds_status = v as TdsStatus;
    else return { ok: false, error: 'Unknown TDS status' };
  }

  const textFields = [
    ['token_instrument_ref', 'Token instrument reference', 200],
    ['payment_instrument_refs', 'Payment instrument references', 2000],
  ] as const;
  for (const [key, label, max] of textFields) {
    if (input[key] === undefined) continue;
    const r = text(input[key], label, max);
    if (!r.ok) return r;
    patch[key] = r.value;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update' };
  }
  return { ok: true, value: patch };
}

/** The token figure the workspace shows, whichever table holds it. A
 *  Den-linked deal only counts a funded or released escrow as money in. */
export function derivedToken(
  deal: Pick<DealFinancials, 'token_amount' | 'token_received_at' | 'token_instrument_ref'> & {
    deal_room_id: string | null;
  },
  escrow: {
    amount_minor: number;
    status: string;
    provider_ref: string | null;
    funded_at: string | null;
  } | null
): {
  source: TokenSource;
  amount: number | null;
  received_at: string | null;
  reference: string | null;
  status: string | null;
} {
  if (deal.deal_room_id) {
    if (!escrow) {
      return { source: 'token_safe', amount: null, received_at: null, reference: null, status: null };
    }
    const funded = escrow.status === 'funded' || escrow.status === 'released';
    return {
      source: 'token_safe',
      amount: funded ? escrow.amount_minor / 100 : null,
      received_at: funded ? (escrow.funded_at?.slice(0, 10) ?? null) : null,
      reference: escrow.provider_ref,
      status: escrow.status,
    };
  }
  return {
    source: 'deal',
    amount: deal.token_amount,
    received_at: deal.token_received_at,
    reference: deal.token_instrument_ref,
    status: null,
  };
}
