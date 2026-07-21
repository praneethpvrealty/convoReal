import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  applyEscrowAction,
  type DealRoomRow,
  type EscrowParty,
  type EscrowStatus,
  type TokenEscrowRow,
} from './token-safe';

// ── Faithful in-memory escrow store ────────────────────────────────
// Models one deal room + its active escrow and honors the conditional
// update semantics the state machine relies on: an UPDATE guarded by
// `.in('status', from)` / `.eq('status', x)` only applies (and returns a
// row) when the CURRENT status matches — otherwise it returns null, the
// same "someone else moved it first" miss the real conditional update
// produces. That is what makes the transition guards real here.
function makeDb(state: { escrow: TokenEscrowRow | null; room: DealRoomRow }) {
  return {
    from(table: string) {
      const q: {
        op: 'select' | 'insert' | 'update';
        patch: Record<string, unknown> | null;
        id?: unknown;
        eqStatus?: string;
        inStatus?: string[] | null;
      } = { op: 'select', patch: null, inStatus: null };

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: Record<string, unknown>) => {
          q.op = 'insert';
          q.patch = payload;
          return builder;
        },
        update: (patch: Record<string, unknown>) => {
          q.op = 'update';
          q.patch = patch;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          if (col === 'id') q.id = val;
          if (col === 'status') q.eqStatus = String(val);
          return builder;
        },
        in: (col: string, vals: string[]) => {
          if (col === 'status') q.inStatus = vals;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        single: () => settle(),
        maybeSingle: () => settle(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(settleAwaited()).then(res),
      };

      function settle() {
        if (table === 'token_escrows') {
          if (q.op === 'insert') {
            const row = {
              id: 'esc-new',
              status: 'proposed',
              owner_confirmed_at: null,
              bidder_confirmed_at: null,
              ...q.patch,
            } as unknown as TokenEscrowRow;
            state.escrow = row;
            return Promise.resolve({ data: row, error: null });
          }
          const e = state.escrow;
          if (q.op === 'update') {
            const statusOk = q.inStatus
              ? !!e && q.inStatus.includes(e.status)
              : q.eqStatus
                ? !!e && e.status === q.eqStatus
                : true;
            if (e && q.id === e.id && statusOk) {
              Object.assign(e, q.patch);
              return Promise.resolve({ data: { ...e }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          // select → loadRoomEscrow
          if (e && (!q.inStatus || q.inStatus.includes(e.status))) {
            return Promise.resolve({ data: { ...e }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: state.room, error: null });
      }

      function settleAwaited() {
        if (table === 'deal_rooms' && q.op === 'update') {
          const r = state.room;
          const statusOk = q.eqStatus ? r.status === q.eqStatus : true;
          if (q.id === r.id && statusOk) Object.assign(r, q.patch);
        }
        return { data: null, error: null };
      }

      return builder;
    },
  } as unknown as SupabaseClient;
}

function room(overrides: Partial<DealRoomRow> = {}): DealRoomRow {
  return {
    id: 'room-1',
    bid_id: 'bid-1',
    property_id: 'prop-1',
    owner_account_id: 'acc-owner',
    bidder_account_id: 'acc-bidder',
    agreed_amount: 5_000_000,
    status: 'open',
    meeting_at: null,
    notes: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function escrow(overrides: Partial<TokenEscrowRow> = {}): TokenEscrowRow {
  return {
    id: 'esc-1',
    deal_room_id: 'room-1',
    amount_minor: 100_000,
    currency: 'INR',
    refund_conditions: null,
    provider: 'manual_escrow',
    provider_ref: null,
    status: 'proposed' as EscrowStatus,
    proposed_by: 'owner' as EscrowParty,
    owner_confirmed_at: null,
    bidder_confirmed_at: null,
    funded_at: null,
    resolved_at: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('applyEscrowAction — accept', () => {
  it('rejects the proposer accepting their own proposal', async () => {
    const db = makeDb({ escrow: escrow({ proposed_by: 'owner', status: 'proposed' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'accept', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/other party/i);
  });

  it('lets the counterparty accept a proposed escrow', async () => {
    const state = { escrow: escrow({ proposed_by: 'owner', status: 'proposed' }), room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'bidder', 'accept', {});
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('accepted');
  });

  it('errors when there is nothing to accept', async () => {
    const db = makeDb({ escrow: null, room: room() });
    const res = await applyEscrowAction(db, room(), 'bidder', 'accept', {});
    expect(res.ok).toBe(false);
  });
});

describe('applyEscrowAction — mark-funded (bidder only)', () => {
  it('rejects the owner recording the payment', async () => {
    const db = makeDb({ escrow: escrow({ status: 'accepted' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'mark-funded', { provider_ref: 'UTR123' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/buyer side/i);
  });

  it('requires a payment reference', async () => {
    const db = makeDb({ escrow: escrow({ status: 'accepted' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'bidder', 'mark-funded', { provider_ref: '   ' });
    expect(res.ok).toBe(false);
  });

  it('funds an accepted escrow when the bidder records a reference', async () => {
    const state = { escrow: escrow({ status: 'accepted' }), room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'bidder', 'mark-funded', { provider_ref: 'UTR123' });
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('funded');
    expect(res.escrow?.provider_ref).toBe('UTR123');
  });

  it('cannot fund an escrow that was never accepted', async () => {
    const db = makeDb({ escrow: escrow({ status: 'proposed' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'bidder', 'mark-funded', { provider_ref: 'UTR123' });
    expect(res.ok).toBe(false);
  });
});

describe('applyEscrowAction — cancel cannot touch funded money', () => {
  it('cancels a proposed escrow', async () => {
    const state = { escrow: escrow({ status: 'proposed' }), room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'owner', 'cancel', {});
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('cancelled');
  });

  it('refuses to cancel a funded escrow', async () => {
    const db = makeDb({ escrow: escrow({ status: 'funded' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'cancel', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/released or refunded/i);
  });
});

describe('applyEscrowAction — confirm-release (dual confirmation)', () => {
  it('rejects release before the token is funded', async () => {
    const db = makeDb({ escrow: escrow({ status: 'accepted' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'confirm-release', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/funded before release/i);
  });

  it('a single confirmation records the party but keeps the escrow funded', async () => {
    const state = { escrow: escrow({ status: 'funded' }), room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'owner', 'confirm-release', {});
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('funded');
    expect(res.escrow?.owner_confirmed_at).toBeTruthy();
    expect(res.escrow?.bidder_confirmed_at).toBeNull();
  });

  it('releases only when BOTH parties have confirmed, and secures the room', async () => {
    const state = {
      escrow: escrow({ status: 'funded', bidder_confirmed_at: '2026-07-02T00:00:00Z' }),
      room: room({ status: 'open' }),
    };
    const db = makeDb(state);
    const res = await applyEscrowAction(db, room({ status: 'open' }), 'owner', 'confirm-release', {});
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('released');
    expect(state.room.status).toBe('token_secured');
  });

  it('is idempotent when the same party confirms twice', async () => {
    const state = {
      escrow: escrow({ status: 'funded', owner_confirmed_at: '2026-07-02T00:00:00Z' }),
      room: room(),
    };
    const res = await applyEscrowAction(makeDb(state), room(), 'owner', 'confirm-release', {});
    expect(res.ok).toBe(true);
    expect(res.escrow?.status).toBe('funded');
  });
});

describe('applyEscrowAction — propose', () => {
  it('rejects a second active escrow on the same deal', async () => {
    const db = makeDb({ escrow: escrow({ status: 'proposed' }), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'propose', { amount: 50_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already an active/i);
  });

  it('rejects a non-positive amount', async () => {
    const db = makeDb({ escrow: null, room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'propose', { amount: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid token amount/i);
  });

  it('creates a proposed escrow, storing the amount in minor units', async () => {
    const state = { escrow: null as TokenEscrowRow | null, room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'owner', 'propose', { amount: 500 });
    expect(res.ok).toBe(true);
    expect(res.escrow?.amount_minor).toBe(50_000);
    expect(res.escrow?.proposed_by).toBe('owner');
  });

  it('falls back to manual_escrow for an unknown provider', async () => {
    const state = { escrow: null as TokenEscrowRow | null, room: room() };
    const res = await applyEscrowAction(makeDb(state), room(), 'owner', 'propose', {
      amount: 500,
      provider: 'definitely_not_a_provider',
    });
    expect(res.ok).toBe(true);
    expect(res.escrow?.provider).toBe('manual_escrow');
  });
});

describe('applyEscrowAction — unknown action', () => {
  it('rejects an unrecognized action', async () => {
    const db = makeDb({ escrow: escrow(), room: room() });
    const res = await applyEscrowAction(db, room(), 'owner', 'frobnicate', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/i);
  });
});
