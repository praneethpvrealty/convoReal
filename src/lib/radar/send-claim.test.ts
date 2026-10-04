import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { memorySupabase } from '@/test/memory-supabase';
import {
  RADAR_SEND_CLAIM_TTL_MS,
  claimRadarSend,
  finishRadarSend,
  isLiveRadarSendClaim,
  recordRadarSendProgress,
} from './send-claim';
import { radarSendRefusalMessage } from './send-refusal';

type Row = Record<string, unknown>;

function setup(overrides: Row = {}) {
  const row: Row = {
    id: 'event-1',
    account_id: 'account-1',
    status: 'new',
    sent_count: 0,
    send_claimed_at: null,
    sent_target_ids: null,
    ...overrides,
  };
  const db = memorySupabase({
    match_events: [row],
  }) as unknown as SupabaseClient;
  const snapshot = () =>
    ({ ...row }) as unknown as Parameters<typeof claimRadarSend>[2];
  return { row, db, snapshot };
}

const now = new Date('2026-10-04T10:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('isLiveRadarSendClaim', () => {
  it('[RDR-001] holds a claim for longer than the route can run', () => {
    expect(RADAR_SEND_CLAIM_TTL_MS).toBeGreaterThan(300_000);
    expect(isLiveRadarSendClaim(ago(299_000), now)).toBe(true);
    expect(isLiveRadarSendClaim(ago(RADAR_SEND_CLAIM_TTL_MS + 1), now)).toBe(
      false
    );
    expect(isLiveRadarSendClaim(null, now)).toBe(false);
  });
});

describe('claimRadarSend', () => {
  it('[RDR-001] claims an unclaimed event and returns who already has the alert', async () => {
    const { row, db, snapshot } = setup({
      status: 'sent',
      sent_target_ids: ['contact-1'],
    });
    const claim = await claimRadarSend(db, 'account-1', snapshot(), { now });

    expect(claim).toEqual({
      ok: true,
      claimedAt: now.toISOString(),
      deliveredIds: ['contact-1'],
    });
    expect(row.send_claimed_at).toBe(now.toISOString());
  });

  it('[RDR-001] loses the race when another send claimed the event after it was read', async () => {
    const { row, db, snapshot } = setup();
    const stale = snapshot();
    row.send_claimed_at = ago(1_000);

    const claim = await claimRadarSend(db, 'account-1', stale, { now });

    expect(claim).toEqual({ ok: false, code: 'SEND_IN_PROGRESS' });
    expect(row.send_claimed_at).toBe(ago(1_000));
  });

  it('[RDR-001] picks up recipients a send delivered after the event was read', async () => {
    const { row, db, snapshot } = setup();
    const stale = snapshot();
    Object.assign(row, { status: 'sent', sent_target_ids: ['contact-1'] });

    expect(await claimRadarSend(db, 'account-1', stale, { now })).toEqual({
      ok: true,
      claimedAt: now.toISOString(),
      deliveredIds: ['contact-1'],
    });
  });

  it('[RDR-001] refuses and releases an event sent before recipients were recorded', async () => {
    const { row, db, snapshot } = setup();
    const stale = snapshot();
    row.status = 'sent';

    expect(await claimRadarSend(db, 'account-1', stale, { now })).toEqual({
      ok: false,
      code: 'ALREADY_SENT',
    });
    expect(row.send_claimed_at).toBeNull();
    expect(
      await claimRadarSend(db, 'account-1', stale, { now, resend: true })
    ).toMatchObject({ ok: true, deliveredIds: [] });
  });

  it('[RDR-001] takes over a stale claim and keeps what it delivered', async () => {
    const { row, db, snapshot } = setup({
      send_claimed_at: ago(RADAR_SEND_CLAIM_TTL_MS + 60_000),
      sent_target_ids: ['contact-1'],
    });
    const claim = await claimRadarSend(db, 'account-1', snapshot(), { now });

    expect(claim).toEqual({
      ok: true,
      claimedAt: now.toISOString(),
      deliveredIds: ['contact-1'],
    });
    expect(row.sent_target_ids).toEqual(['contact-1']);
  });

  it('[RDR-001] never claims another account’s event', async () => {
    const { row, db, snapshot } = setup();
    const claim = await claimRadarSend(db, 'account-2', snapshot(), { now });

    expect(claim).toEqual({ ok: false, code: 'SEND_IN_PROGRESS' });
    expect(row.send_claimed_at).toBeNull();
  });
});

describe('recordRadarSendProgress and finishRadarSend', () => {
  it('[RDR-001] stop writing once the claim was taken over', async () => {
    const { row, db, snapshot } = setup();
    const claim = await claimRadarSend(db, 'account-1', snapshot(), { now });
    if (!claim.ok) throw new Error('expected a claim');

    expect(
      await recordRadarSendProgress(
        db,
        'account-1',
        'event-1',
        claim.claimedAt,
        ['contact-1']
      )
    ).toBe(true);
    row.send_claimed_at = '2026-10-04T10:07:00.000Z';
    expect(
      await recordRadarSendProgress(
        db,
        'account-1',
        'event-1',
        claim.claimedAt,
        ['contact-1', 'contact-2']
      )
    ).toBe(false);

    await finishRadarSend(
      db,
      'account-1',
      snapshot(),
      claim.claimedAt,
      ['contact-1', 'contact-2'],
      2
    );
    expect(row).toMatchObject({
      status: 'new',
      sent_target_ids: ['contact-1'],
      send_claimed_at: '2026-10-04T10:07:00.000Z',
    });
  });
});

describe('radarSendRefusalMessage', () => {
  it('[RDR-001] names both refusals and nothing else', () => {
    expect(radarSendRefusalMessage('SEND_IN_PROGRESS')).toBe(
      'This alert is already being sent.'
    );
    expect(radarSendRefusalMessage('ALREADY_SENT')).toBe(
      'This alert was already sent.'
    );
    expect(radarSendRefusalMessage('toString')).toBeNull();
    expect(radarSendRefusalMessage(undefined)).toBeNull();
  });
});
