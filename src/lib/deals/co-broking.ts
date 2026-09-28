/**
 * Co-broking: the brokerage collects the whole commission on a deal and
 * pays the other brokers — the buyer's agent, the seller's agent — their
 * share out of it.
 *
 * `deals.brokerage_amount` stays what the brokerage collects. Each
 * payout is one broker it owes; the database keeps their sum on
 * `deals.co_broker_payout_total`, and the brokerage's own share is the
 * difference. The routes under /api/deals/[id]/co-broking are the only
 * writers and the summary is computed on the server, so neither web nor
 * mobile adds money of its own.
 *
 * Every field is internal only (TXW-004), like the rest of the
 * financials: never selected by /api/v1, a public route or a
 * stakeholder link, and amounts never ride a timeline event.
 */

export type DealPosition =
  'direct' | 'buyer_side' | 'seller_side' | 'intermediary';

export const DEAL_POSITIONS: readonly DealPosition[] = [
  'direct',
  'buyer_side',
  'seller_side',
  'intermediary',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const DEAL_POSITION_LABELS: Record<DealPosition, string> = {
  direct: 'Direct — both sides are mine',
  buyer_side: "Buyer's side — co-broking with the seller's agent",
  seller_side: "Seller's side — co-broking with the buyer's agent",
  intermediary: "In the middle — between the buyer's and seller's agents",
};

export type PayoutSide = 'buyer' | 'seller';

export type PayoutStatus = 'paid' | 'partial' | 'owed';

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  paid: 'Paid',
  partial: 'Part paid',
  owed: 'To pay',
};

export const CO_BROKER_PAYOUT_MAX_PER_DEAL = 20;
export const PAYEE_NAME_MAX = 120;

export interface DealCoBrokerPayout {
  id: string;
  account_id: string;
  deal_id: string;
  stakeholder_id: string | null;
  payee_name: string;
  side: PayoutSide | null;
  share_percent: number | null;
  amount: number;
  paid_at: string | null;
  paid_amount: number | null;
  instrument_ref: string | null;
  notes: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoBrokingSummary {
  /** What the brokerage collects; null while no brokerage is recorded. */
  collected: number | null;
  payouts: number;
  paid_out: number;
  to_pay: number;
  /** The brokerage's own share; null while no brokerage is recorded. */
  net: number | null;
}

export interface CoBrokingBroker {
  id: string;
  name: string;
  side: 'buyer' | 'seller' | 'internal';
}

export interface CoBrokingView {
  position: DealPosition | null;
  deal_value: number | null;
  payouts: DealCoBrokerPayout[];
  summary: CoBrokingSummary;
  /** The deal's broker stakeholders, offered as payees. */
  brokers: CoBrokingBroker[];
}

export interface PayoutInput {
  payee_name: string;
  stakeholder_id: string | null;
  side: PayoutSide | null;
  share_percent: number | null;
  amount: number;
  paid_at: string | null;
  paid_amount: number | null;
  instrument_ref: string | null;
  notes: string | null;
}

export type PayoutPatch = Partial<PayoutInput> & { position?: number };

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(v: unknown, label: string): ParseResult<number | null> {
  if (v === null || v === '' || v === undefined) {
    return { ok: true, value: null };
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative amount` };
  }
  if (n > 999_999_999_999) {
    return { ok: false, error: `${label} is out of range` };
  }
  return { ok: true, value: round2(n) };
}

function text(
  v: unknown,
  label: string,
  max: number
): ParseResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') {
    return { ok: false, error: `${label} must be text` };
  }
  const t = v.trim();
  if (t.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or less` };
  }
  return { ok: true, value: t || null };
}

export function parseDealPosition(
  v: unknown
): ParseResult<DealPosition | null> {
  if (v === null || v === '') return { ok: true, value: null };
  if (
    typeof v === 'string' &&
    (DEAL_POSITIONS as readonly string[]).includes(v)
  ) {
    return { ok: true, value: v as DealPosition };
  }
  return { ok: false, error: 'Unknown deal position' };
}

/** A new payout: who and how much are required; the rest is filled in
 *  when the money goes out. */
export function parsePayoutInput(raw: unknown): ParseResult<PayoutInput> {
  const patch = parsePayoutPatch(raw);
  if (!patch.ok) return patch;
  const { position: _position, ...rest } = patch.value;
  void _position;
  if (!rest.payee_name) return { ok: false, error: 'Name the broker you pay' };
  if (rest.amount === undefined) {
    return { ok: false, error: 'Give the payout an amount' };
  }
  return {
    ok: true,
    value: {
      payee_name: rest.payee_name,
      stakeholder_id: rest.stakeholder_id ?? null,
      side: rest.side ?? null,
      share_percent: rest.share_percent ?? null,
      amount: rest.amount,
      paid_at: rest.paid_at ?? null,
      paid_amount: rest.paid_amount ?? null,
      instrument_ref: rest.instrument_ref ?? null,
      notes: rest.notes ?? null,
    },
  };
}

/** Only the keys present are returned, so a PATCH that names one field
 *  touches one column. */
export function parsePayoutPatch(raw: unknown): ParseResult<PayoutPatch> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Nothing to update' };
  }
  const input = raw as Record<string, unknown>;
  const patch: PayoutPatch = {};

  if (input.payee_name !== undefined) {
    const r = text(input.payee_name, 'Broker name', PAYEE_NAME_MAX);
    if (!r.ok) return r;
    if (!r.value) return { ok: false, error: 'Name the broker you pay' };
    patch.payee_name = r.value;
  }
  if (input.stakeholder_id !== undefined) {
    const v = input.stakeholder_id;
    if (v === null || v === '') patch.stakeholder_id = null;
    else if (typeof v === 'string' && UUID.test(v)) patch.stakeholder_id = v;
    else return { ok: false, error: 'Unknown stakeholder' };
  }
  if (input.side !== undefined) {
    const v = input.side;
    if (v === null || v === '') patch.side = null;
    else if (v === 'buyer' || v === 'seller') patch.side = v;
    else
      return { ok: false, error: "Side must be the buyer's or the seller's" };
  }
  if (input.share_percent !== undefined) {
    const v = input.share_percent;
    if (v === null || v === '') patch.share_percent = null;
    else {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
        return { ok: false, error: 'Share must be a percentage from 0 to 100' };
      }
      patch.share_percent = Math.round(n * 1000) / 1000;
    }
  }
  if (input.amount !== undefined) {
    const r = money(input.amount, 'Amount');
    if (!r.ok) return r;
    if (r.value === null) {
      return { ok: false, error: 'Give the payout an amount' };
    }
    patch.amount = r.value;
  }
  if (input.paid_amount !== undefined) {
    const r = money(input.paid_amount, 'Paid amount');
    if (!r.ok) return r;
    patch.paid_amount = r.value;
  }
  if (input.paid_at !== undefined) {
    const v = input.paid_at;
    if (v === null || v === '') patch.paid_at = null;
    else if (typeof v === 'string' && DATE_ONLY.test(v)) patch.paid_at = v;
    else return { ok: false, error: 'Paid on must be YYYY-MM-DD' };
  }
  for (const [key, label, max] of [
    ['instrument_ref', 'Instrument reference', 200],
    ['notes', 'Notes', 1000],
  ] as const) {
    if (input[key] === undefined) continue;
    const r = text(input[key], label, max);
    if (!r.ok) return r;
    patch[key] = r.value;
  }
  if (input.position !== undefined) {
    const n = Number(input.position);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) {
      return { ok: false, error: 'Position must be a whole number' };
    }
    patch.position = n;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update' };
  }
  return { ok: true, value: patch };
}

/** A share quoted as a percentage of the deal value, in rupees. */
export function payoutFromPercent(
  dealValue: number | null | undefined,
  percent: number | string | null | undefined
): number {
  const value = Number(dealValue ?? 0);
  const pct = typeof percent === 'string' ? Number(percent) : (percent ?? 0);
  if (!Number.isFinite(value) || !Number.isFinite(pct) || pct <= 0) return 0;
  return round2((value * pct) / 100);
}

/** What has gone out on a payout: the recorded amount, else the full
 *  amount once a paid date is set. */
export function payoutPaid(
  p: Pick<DealCoBrokerPayout, 'amount' | 'paid_at' | 'paid_amount'>
): number {
  if (p.paid_amount !== null && p.paid_amount !== undefined) {
    return Math.min(p.paid_amount, p.amount);
  }
  return p.paid_at ? p.amount : 0;
}

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export function payoutStatus(
  p: Pick<DealCoBrokerPayout, 'amount' | 'paid_at' | 'paid_amount'>
): PayoutStatus {
  const paid = payoutPaid(p);
  if (paid >= p.amount && (p.paid_at || paid > 0)) return 'paid';
  if (paid > 0) return 'partial';
  return 'owed';
}

/** A paid payout is corrected, never turned back into an unpaid one:
 *  true when the patch would leave a paid row with no payment at all. */
export function patchClearsPayment(
  before: Pick<DealCoBrokerPayout, 'paid_at' | 'paid_amount'>,
  patch: Pick<PayoutPatch, 'paid_at' | 'paid_amount'>
): boolean {
  const wasPaid =
    Boolean(before.paid_at) || Number(before.paid_amount ?? 0) > 0;
  if (!wasPaid) return false;
  const paidAt = patch.paid_at === undefined ? before.paid_at : patch.paid_at;
  const paidAmount =
    patch.paid_amount === undefined ? before.paid_amount : patch.paid_amount;
  return !paidAt && Number(paidAmount ?? 0) === 0;
}

/** The brokerage's own share of what it collects. Floored at zero only
 *  when there are payouts, as the dashboard functions floor it. */
export function netOfPayouts(
  collected: number,
  payoutTotal: number | null | undefined
): number {
  const payouts = Number(payoutTotal ?? 0);
  if (!payouts) return collected;
  return Math.max(0, round2(collected - payouts));
}

export function summarizeCoBroking(
  collected: number | null,
  rows: readonly Pick<
    DealCoBrokerPayout,
    'amount' | 'paid_at' | 'paid_amount'
  >[]
): CoBrokingSummary {
  const payouts = round2(rows.reduce((sum, p) => sum + p.amount, 0));
  const paidOut = round2(rows.reduce((sum, p) => sum + payoutPaid(p), 0));
  return {
    collected,
    payouts,
    paid_out: paidOut,
    to_pay: round2(Math.max(0, payouts - paidOut)),
    net: collected === null ? null : netOfPayouts(collected, payouts),
  };
}

export function sortPayouts<
  T extends Pick<DealCoBrokerPayout, 'position' | 'created_at'>,
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position || a.created_at.localeCompare(b.created_at)
  );
}
