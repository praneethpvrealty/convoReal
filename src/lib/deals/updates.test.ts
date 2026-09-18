import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEAL_SHARE_MAX_TTL_MS } from './share-links';
import {
  buildUpdateSnapshot,
  engineDeliveryMode,
  isEligibleRecipient,
  parseUpdateInput,
  personalWhatsAppUrl,
  recipientStage,
  renderUpdateNotice,
  sidesForUpdate,
  snapshotItemAllowed,
  updateNoticeUrl,
  UPDATE_CHANNEL_LABELS,
  UPDATE_STAGE_LABELS,
  type SnapshotSources,
} from './updates';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260918050000_transaction_workspace_updates.sql'
  ),
  'utf8'
);

const sources: SnapshotSources = {
  property_label: 'Property No. 19',
  stage: 'Token & Legal',
  milestones: [
    {
      id: 'm1',
      title: 'Token paid',
      status: 'completed',
      position: 0,
      target_date: null,
      completed_at: '2026-09-02T00:00:00Z',
      visibility: 'all_stakeholders',
    },
    {
      id: 'm2',
      title: 'Seller to produce mother deed',
      status: 'in_progress',
      position: 1,
      target_date: '2026-09-21',
      completed_at: null,
      visibility: 'seller_side',
    },
    {
      id: 'm3',
      title: 'Loan sanction',
      status: 'pending',
      position: 2,
      target_date: '2026-09-30',
      completed_at: null,
      visibility: 'buyer_side',
    },
    {
      id: 'm4',
      title: 'Push seller on date',
      status: 'pending',
      position: 3,
      target_date: null,
      completed_at: null,
      visibility: 'internal',
    },
  ],
  events: [
    {
      id: 'e1',
      event_type: 'note_added',
      title: 'Legal documents collected',
      created_at: '2026-09-10T00:00:00Z',
      visibility: 'all_stakeholders',
    },
    {
      id: 'e2',
      event_type: 'financials_updated',
      title: 'Financials updated (2 fields)',
      created_at: '2026-09-11T00:00:00Z',
      visibility: 'internal',
    },
  ],
};

describe('[TXW-013] a published update is a durable snapshot', () => {
  it('deal_updates is insert-only in the database, like deal_events', () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON deal_updates FROM anon, authenticated;\s*GRANT SELECT, INSERT ON deal_updates TO authenticated;/
    );
    expect(migration).not.toMatch(
      /CREATE POLICY deal_updates_\w+ ON deal_updates FOR (UPDATE|DELETE|ALL)/
    );
    expect(migration).toMatch(
      /CREATE TRIGGER deal_updates_immutable_trigger\s+BEFORE UPDATE OR DELETE ON deal_updates/
    );
    expect(migration).toMatch(/published_by = \(SELECT auth\.uid\(\)\)/);
    expect(migration).toMatch(
      /supersedes_update_id UUID REFERENCES deal_updates\(id\)/
    );
  });

  it('never publishes to an internal audience', () => {
    expect(migration).toMatch(
      /visibility TEXT NOT NULL\s+CHECK \(visibility IN \('buyer_side', 'seller_side', 'all_stakeholders'\)\)/
    );
    expect(
      parseUpdateInput({ headline: 'x', visibility: 'internal' })
    ).toMatchObject({ ok: false });
  });

  it('quotes only what every reader may already see', () => {
    expect(snapshotItemAllowed('buyer_side', 'buyer_side')).toBe(true);
    expect(snapshotItemAllowed('buyer_side', 'all_stakeholders')).toBe(true);
    expect(snapshotItemAllowed('buyer_side', 'seller_side')).toBe(false);
    expect(snapshotItemAllowed('buyer_side', 'internal')).toBe(false);
    expect(snapshotItemAllowed('all_stakeholders', 'all_stakeholders')).toBe(
      true
    );
    expect(snapshotItemAllowed('all_stakeholders', 'buyer_side')).toBe(false);
    expect(sidesForUpdate('all_stakeholders')).toEqual(['buyer', 'seller']);
    expect(sidesForUpdate('seller_side')).toEqual(['seller']);
  });

  it('freezes the selected items and refuses one the audience may not see', () => {
    const ok = buildUpdateSnapshot({
      visibility: 'buyer_side',
      sources,
      milestoneIds: ['m3', 'm1'],
      eventIds: ['e1'],
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.milestones.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(ok.value.events.map((e) => e.id)).toEqual(['e1']);
    expect(ok.value.progress).toEqual({ total: 4, done: 1 });
    expect(ok.value.stage).toBe('Token & Legal');
    expect(JSON.stringify(ok.value)).not.toContain('visibility');

    const refused = buildUpdateSnapshot({
      visibility: 'buyer_side',
      sources,
      milestoneIds: ['m2'],
      eventIds: [],
    });
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.error).toContain('mother deed');
    expect(
      buildUpdateSnapshot({
        visibility: 'all_stakeholders',
        sources,
        milestoneIds: [],
        eventIds: ['e2'],
      })
    ).toMatchObject({ ok: false });
    expect(
      buildUpdateSnapshot({
        visibility: 'buyer_side',
        sources,
        milestoneIds: ['nope'],
        eventIds: [],
      })
    ).toMatchObject({ ok: false, error: 'Milestone not found on this deal' });
  });

  it('parses a compose request and bounds it', () => {
    const parsed = parseUpdateInput({
      headline: '  Loan sanctioned  ',
      body: 'Registration slot requested for the 24th.',
      visibility: 'buyer_side',
      milestone_ids: ['m1', 'm1', 'm3'],
      event_ids: [],
      supersedes_update_id: '',
      recipients: [
        { stakeholder_id: 's1', channel: 'engine_whatsapp' },
        { stakeholder_id: 's1', channel: 'portal_only' },
        { stakeholder_id: 's2' },
      ],
      ttl: '24h',
      otp_required: true,
      source: 'mobile',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.headline).toBe('Loan sanctioned');
    expect(parsed.value.milestoneIds).toEqual(['m1', 'm3']);
    expect(parsed.value.supersedesUpdateId).toBeNull();
    expect(parsed.value.recipients).toEqual([
      { stakeholderId: 's1', channel: 'engine_whatsapp' },
      { stakeholderId: 's2', channel: 'portal_only' },
    ]);
    expect(parsed.value.source).toBe('mobile');
    expect(parsed.value.otpRequired).toBe(true);

    expect(parseUpdateInput(null)).toMatchObject({ ok: false });
    expect(
      parseUpdateInput({ headline: 'x'.repeat(121), visibility: 'buyer_side' })
    ).toMatchObject({ ok: false });
    expect(
      parseUpdateInput({
        headline: 'x',
        visibility: 'buyer_side',
        recipients: [{ stakeholder_id: 's', channel: 'sms' }],
      })
    ).toMatchObject({ ok: false, error: 'Unknown delivery channel' });
  });
});

describe('[TXW-014] delivery is decided honestly and recorded separately', () => {
  it('sends free-form only inside the window and the template only to the buyer', () => {
    expect(
      engineDeliveryMode({
        side: 'seller',
        withinWindow: true,
        templateApproved: false,
      })
    ).toEqual({ mode: 'free_form' });
    expect(
      engineDeliveryMode({
        side: 'buyer',
        withinWindow: false,
        templateApproved: true,
      })
    ).toEqual({ mode: 'template' });
    expect(
      engineDeliveryMode({
        side: 'buyer',
        withinWindow: false,
        templateApproved: false,
      })
    ).toMatchObject({ mode: null });
    expect(
      engineDeliveryMode({
        side: 'seller',
        withinWindow: false,
        templateApproved: true,
      })
    ).toMatchObject({ mode: null });
  });

  it('only a buyer- or seller-side person on the audience can receive an update', () => {
    expect(isEligibleRecipient({ side: 'buyer' }, 'buyer_side')).toBe(true);
    expect(isEligibleRecipient({ side: 'seller' }, 'buyer_side')).toBe(false);
    expect(isEligibleRecipient({ side: 'seller' }, 'all_stakeholders')).toBe(
      true
    );
    expect(isEligibleRecipient({ side: 'internal' }, 'all_stakeholders')).toBe(
      false
    );
  });

  it('leads with the furthest fact without collapsing the three', () => {
    const base = {
      status: 'sent' as const,
      opened_at: null,
      acknowledged_at: null,
    };
    expect(recipientStage({ ...base, status: 'pending' })).toBe('pending');
    expect(recipientStage(base)).toBe('sent');
    expect(recipientStage({ ...base, opened_at: 't' })).toBe('opened');
    expect(
      recipientStage({ ...base, opened_at: null, acknowledged_at: 't' })
    ).toBe('acknowledged');
    expect(recipientStage({ ...base, status: 'failed' })).toBe('failed');
    expect(Object.keys(UPDATE_STAGE_LABELS)).toEqual([
      'pending',
      'sent',
      'opened',
      'acknowledged',
      'failed',
    ]);
    expect(Object.keys(UPDATE_CHANNEL_LABELS)).toEqual([
      'engine_whatsapp',
      'personal_whatsapp',
      'portal_only',
    ]);
  });

  it('renders one fixed-format notice for every channel and the preview', () => {
    const snapshot = buildUpdateSnapshot({
      visibility: 'buyer_side',
      sources,
      milestoneIds: ['m1', 'm3'],
      eventIds: ['e1'],
    });
    if (!snapshot.ok) throw new Error(snapshot.error);
    const text = renderUpdateNotice({
      recipientName: 'Adithi Rao',
      brandName: 'Aryavarta Ventures',
      dealTitle: 'Adithi — Site #19',
      headline: 'Loan sanctioned',
      body: 'Registration slot requested for the 24th.',
      snapshot: snapshot.value,
      url: updateNoticeUrl('https://app.example/deal/tok', 'u1'),
    });
    expect(text).toContain(
      'Hi Adithi, an update on Adithi — Site #19 from Aryavarta Ventures.'
    );
    expect(text).toContain('*Loan sanctioned*');
    expect(text).toContain('✅ Token paid');
    expect(text).toContain('⬜ Loan sanction (by 2026-09-30)');
    expect(text).toContain('• Legal documents collected');
    expect(text).toContain('Progress: 1 of 4 milestones done.');
    expect(text).toContain('https://app.example/deal/tok?u=u1');
    expect(text).not.toContain('Push seller');
    expect(
      renderUpdateNotice({
        recipientName: '',
        brandName: 'B',
        dealTitle: 'D',
        headline: 'H',
        body: null,
        snapshot: {
          milestones: [],
          events: [],
          progress: { total: 0, done: 0 },
        },
        url: null,
        correction: true,
      })
    ).toBe('Hi there, a correction on D from B.\n\n*H*');
    expect(personalWhatsAppUrl('+91 90000 00019', 'hi there')).toBe(
      'https://wa.me/919000000019?text=hi%20there'
    );
  });

  it('stores the link TTL in a column wide enough for the 30-day choice', () => {
    expect(DEAL_SHARE_MAX_TTL_MS).toBeGreaterThan(2 ** 31 - 1);
    expect(migration).toContain('link_ttl_ms BIGINT');
    const held = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260918050100_transaction_workspace_update_events.sql'
      ),
      'utf8'
    );
    expect(held).toMatch(/ALTER COLUMN link_ttl_ms TYPE BIGINT/);
  });

  it('matches a template reply to the message it quotes, never to the newest notice', () => {
    const delivery = readFileSync(
      join(process.cwd(), 'src/lib/deals/update-delivery.ts'),
      'utf8'
    );
    const handler = delivery.slice(
      delivery.indexOf('export async function handleUpdateNoticeReply')
    );
    expect(handler).toContain('if (!args.contextMessageId) return false;');
    expect(handler).toContain(".eq('message_id', args.contextMessageId)");
    expect(handler).toContain(
      ".eq('message_id', (quoted as { id: string }).id)"
    );
    expect(handler).not.toMatch(
      /\.order\('created_at', \{ ascending: false \}\)\s*\.limit\(1\)/
    );
    const webhook = readFileSync(
      join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
      'utf8'
    );
    expect(webhook).toContain('contextMessageId: message.context?.id ?? null');
  });

  it('records sent, opened and acknowledged as three columns', () => {
    for (const column of [
      'sent_at',
      'opened_at',
      'acknowledged_at',
      'link_delivered_at',
    ])
      expect(migration).toContain(`${column} TIMESTAMPTZ`);
    expect(migration).toMatch(
      /acknowledged_via TEXT\s+CHECK \(acknowledged_via IN \('portal', 'whatsapp'\)\)/
    );
    expect(migration).toMatch(
      /channel IN \('engine_whatsapp', 'personal_whatsapp', 'portal_only'\)/
    );
  });
});
