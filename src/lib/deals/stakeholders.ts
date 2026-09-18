/**
 * Stakeholders on a transaction: the people on each side of one deal.
 *
 * A stakeholder never gets a login. They are a name, a side and a
 * role, and — when the agent chooses — a tokenised link
 * (src/lib/deals/share-links.ts) that shows them their side's slice of
 * the deal through the visibility resolver.
 */

import type { DealSide } from './visibility';

export type StakeholderRole =
  'buyer' | 'seller' | 'advocate' | 'banker' | 'broker' | 'witness' | 'other';

export const STAKEHOLDER_ROLES: readonly StakeholderRole[] = [
  'buyer',
  'seller',
  'advocate',
  'banker',
  'broker',
  'witness',
  'other',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const STAKEHOLDER_ROLE_LABELS: Record<StakeholderRole, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  advocate: 'Advocate',
  banker: 'Banker',
  broker: 'Broker',
  witness: 'Witness',
  other: 'Other',
};

export const STAKEHOLDER_SIDES: readonly DealSide[] = [
  'buyer',
  'seller',
  'internal',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const STAKEHOLDER_SIDE_LABELS: Record<DealSide, string> = {
  buyer: 'Buyer side',
  seller: 'Seller side',
  internal: 'Internal',
};

/** The side a role sits on unless the agent says otherwise. An
 *  advocate or banker can act for either side, so they default to the
 *  buyer's and the form asks. */
export function defaultSideForRole(role: StakeholderRole): DealSide {
  switch (role) {
    case 'seller':
      return 'seller';
    case 'broker':
      return 'internal';
    default:
      return 'buyer';
  }
}

export interface DealStakeholder {
  id: string;
  account_id: string;
  deal_id: string;
  contact_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  role: StakeholderRole;
  side: DealSide;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function isStakeholderRole(v: unknown): v is StakeholderRole {
  return (
    typeof v === 'string' &&
    (STAKEHOLDER_ROLES as readonly string[]).includes(v)
  );
}

export function isDealSide(v: unknown): v is DealSide {
  return (
    typeof v === 'string' &&
    (STAKEHOLDER_SIDES as readonly string[]).includes(v)
  );
}

export interface StakeholderInput {
  name: string;
  role: StakeholderRole;
  side: DealSide;
  phone: string | null;
  email: string | null;
  contact_id: string | null;
  notes: string | null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function parseStakeholderInput(
  raw: unknown
): ParseResult<StakeholderInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'name, role and side are required' };
  }
  const input = raw as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120) {
    return { ok: false, error: 'Name must be 1–120 characters' };
  }
  if (!isStakeholderRole(input.role)) {
    return { ok: false, error: 'Unknown stakeholder role' };
  }
  const side =
    input.side === undefined ? defaultSideForRole(input.role) : input.side;
  if (!isDealSide(side)) {
    return { ok: false, error: 'Side must be buyer, seller or internal' };
  }

  let phone: string | null = null;
  if (typeof input.phone === 'string' && input.phone.trim()) {
    phone = normalizePhone(input.phone);
    if (!phone) return { ok: false, error: 'Phone number looks wrong' };
  }
  let email: string | null = null;
  if (typeof input.email === 'string' && input.email.trim()) {
    email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) {
      return { ok: false, error: 'Email address looks wrong' };
    }
  }
  const contactId =
    typeof input.contact_id === 'string' && input.contact_id.trim()
      ? input.contact_id.trim()
      : null;
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (notes.length > 1000) {
    return { ok: false, error: 'Notes must be 1,000 characters or less' };
  }

  return {
    ok: true,
    value: {
      name,
      role: input.role,
      side,
      phone,
      email,
      contact_id: contactId,
      notes: notes || null,
    },
  };
}

/** Stakeholders on other deals in the same bundle that are the same
 *  person as `me`: same contact, or the same phone digits. This is
 *  how a buyer on two plots sees both while each seller sees one. */
export function isSamePerson(
  me: Pick<DealStakeholder, 'contact_id' | 'phone' | 'email'>,
  other: Pick<DealStakeholder, 'contact_id' | 'phone' | 'email'>
): boolean {
  if (me.contact_id && other.contact_id)
    return me.contact_id === other.contact_id;
  if (me.phone && other.phone) return me.phone === other.phone;
  if (me.email && other.email) return me.email === other.email;
  return false;
}
