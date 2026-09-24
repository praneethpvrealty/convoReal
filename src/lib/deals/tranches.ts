/**
 * Payment schedule: the tranches a deal's consideration is paid in.
 *
 * Record-keeping, like the rest of the financials. A tranche is a
 * label, an amount, when it is due, and when and how it came in. The
 * routes under /api/deals/[id]/tranches are the only writers; the
 * summary is computed here on the server and read by both surfaces,
 * so neither web nor mobile adds money of its own.
 *
 * Every field is internal only (TXW-004): the table is never selected
 * by /api/v1, a public route or a stakeholder link, and amounts never
 * ride a timeline event.
 */

export const TRANCHE_MAX_PER_DEAL = 40;
export const TRANCHE_LABEL_MAX = 120;

export type TrancheStatus =
  'received' | 'partial' | 'overdue' | 'due' | 'scheduled';

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const TRANCHE_STATUS_LABELS: Record<TrancheStatus, string> = {
  received: 'Received',
  partial: 'Part received',
  overdue: 'Overdue',
  due: 'Due today',
  scheduled: 'Scheduled',
};

/** The tranches a resale is usually paid in. Offered as the first
 *  label suggestions; the agent names them however the deal reads. */
export const TRANCHE_LABEL_SUGGESTIONS: readonly string[] = [
  'Token',
  'On agreement',
  'On registration',
  'On possession',
  'Bank loan disbursement',
];

export interface DealPaymentTranche {
  id: string;
  account_id: string;
  deal_id: string;
  position: number;
  label: string;
  amount: number;
  due_date: string | null;
  received_at: string | null;
  received_amount: number | null;
  instrument_ref: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrancheSummary {
  count: number;
  scheduled: number;
  received: number;
  outstanding: number;
}

export interface TrancheInput {
  label: string;
  amount: number;
  due_date: string | null;
  received_at: string | null;
  received_amount: number | null;
  instrument_ref: string | null;
  notes: string | null;
}

export type TranchePatch = Partial<TrancheInput> & { position?: number };

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function dateOnly(v: unknown, label: string): ParseResult<string | null> {
  if (v === null || v === '' || v === undefined) {
    return { ok: true, value: null };
  }
  if (typeof v === 'string' && DATE_ONLY.test(v)) return { ok: true, value: v };
  return { ok: false, error: `${label} must be YYYY-MM-DD` };
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

/** A new tranche: a label and an amount are required, the rest may be
 *  filled in as the money moves. */
export function parseTrancheInput(raw: unknown): ParseResult<TrancheInput> {
  const patch = parseTranchePatch(raw);
  if (!patch.ok) return patch;
  const { position: _position, ...rest } = patch.value;
  void _position;
  if (!rest.label) return { ok: false, error: 'Give the tranche a label' };
  if (rest.amount === undefined) {
    return { ok: false, error: 'Give the tranche an amount' };
  }
  return {
    ok: true,
    value: {
      label: rest.label,
      amount: rest.amount,
      due_date: rest.due_date ?? null,
      received_at: rest.received_at ?? null,
      received_amount: rest.received_amount ?? null,
      instrument_ref: rest.instrument_ref ?? null,
      notes: rest.notes ?? null,
    },
  };
}

/** Only the keys present are returned, so a PATCH that names one field
 *  touches one column. */
export function parseTranchePatch(raw: unknown): ParseResult<TranchePatch> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Nothing to update' };
  }
  const input = raw as Record<string, unknown>;
  const patch: TranchePatch = {};

  if (input.label !== undefined) {
    const r = text(input.label, 'Label', TRANCHE_LABEL_MAX);
    if (!r.ok) return r;
    if (!r.value) return { ok: false, error: 'Give the tranche a label' };
    patch.label = r.value;
  }
  if (input.amount !== undefined) {
    const r = money(input.amount, 'Amount');
    if (!r.ok) return r;
    if (r.value === null)
      return { ok: false, error: 'Give the tranche an amount' };
    patch.amount = r.value;
  }
  if (input.received_amount !== undefined) {
    const r = money(input.received_amount, 'Received amount');
    if (!r.ok) return r;
    patch.received_amount = r.value;
  }
  for (const [key, label] of [
    ['due_date', 'Due date'],
    ['received_at', 'Received on'],
  ] as const) {
    if (input[key] === undefined) continue;
    const r = dateOnly(input[key], label);
    if (!r.ok) return r;
    patch[key] = r.value;
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

/** What has come in on a tranche: the recorded receipt, else the full
 *  amount once a receipt date is set. */
export function trancheReceived(
  t: Pick<DealPaymentTranche, 'amount' | 'received_at' | 'received_amount'>
): number {
  if (t.received_amount !== null && t.received_amount !== undefined) {
    return Math.min(t.received_amount, t.amount);
  }
  return t.received_at ? t.amount : 0;
}

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts.
 *  `today` is a YYYY-MM-DD in the reader's calendar. */
export function trancheStatus(
  t: Pick<
    DealPaymentTranche,
    'amount' | 'due_date' | 'received_at' | 'received_amount'
  >,
  today: string
): TrancheStatus {
  const received = trancheReceived(t);
  if (received >= t.amount && (t.received_at || received > 0))
    return 'received';
  if (received > 0) return 'partial';
  if (!t.due_date) return 'scheduled';
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'due';
  return 'scheduled';
}

export function summarizeTranches(
  rows: readonly Pick<
    DealPaymentTranche,
    'amount' | 'received_at' | 'received_amount'
  >[]
): TrancheSummary {
  const scheduled = rows.reduce((sum, t) => sum + t.amount, 0);
  const received = rows.reduce((sum, t) => sum + trancheReceived(t), 0);
  return {
    count: rows.length,
    scheduled: Math.round(scheduled * 100) / 100,
    received: Math.round(received * 100) / 100,
    outstanding: Math.round(Math.max(0, scheduled - received) * 100) / 100,
  };
}

/** Due date first, undated last, then the agent's own order. */
export function sortTranches<
  T extends Pick<DealPaymentTranche, 'due_date' | 'position' | 'created_at'>,
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date.localeCompare(b.due_date);
    }
    if (Boolean(a.due_date) !== Boolean(b.due_date)) return a.due_date ? -1 : 1;
    return a.position - b.position || a.created_at.localeCompare(b.created_at);
  });
}
