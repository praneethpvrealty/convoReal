import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildClosingAskText,
  buildClosingCardBody,
  closingAdvanceButtonTitle,
  gatherClosingDeals,
  parseClosingReply,
  CLOSING_ADVANCE_PREFIX,
  CLOSING_ASK_PREFIX,
  CLOSING_MAX_PER_RUN,
  CLOSING_SNOOZE_PREFIX,
  type ClosingDeal,
} from './closing-nudges';

// The card that replaces the enquiry check-in for a deal already at
// legal. Everything here guards the same line: this reader is buying
// the property, so nothing may call it an enquiry, ask whether they are
// still interested, or offer to close anything.

const ITEM_ID = 'a3b1e0c8-2f4d-4a91-9c77-1de5f0b3a642';

describe('parseClosingReply', () => {
  it('round-trips the item id out of each button', () => {
    expect(parseClosingReply(`${CLOSING_ADVANCE_PREFIX}${ITEM_ID}`)).toEqual({
      action: 'advance',
      itemId: ITEM_ID,
    });
    expect(parseClosingReply(`${CLOSING_ASK_PREFIX}${ITEM_ID}`)?.action).toBe(
      'ask'
    );
    expect(
      parseClosingReply(`${CLOSING_SNOOZE_PREFIX}${ITEM_ID}`)?.action
    ).toBe('snooze');
  });

  it('ignores the radar buttons and everything else in the inbox', () => {
    for (const id of [
      'fup_checkin:abc',
      'fup_snooze:abc',
      'enq_approve:a:b',
      '',
      null,
      undefined,
    ]) {
      expect(parseClosingReply(id), String(id)).toBeNull();
    }
  });

  it('refuses a bare prefix rather than guessing an item', () => {
    expect(parseClosingReply(CLOSING_ASK_PREFIX)).toBeNull();
  });
});

describe('closingAdvanceButtonTitle', () => {
  it('labels the button with the stage it moves to', () => {
    expect(closingAdvanceButtonTitle('Registration')).toBe('✅ Registration');
  });

  it('keeps a long custom stage name inside Meta 20-char cap', () => {
    const title = closingAdvanceButtonTitle(
      'Sale deed registration at possession'
    );
    expect([...title].length).toBeLessThanOrEqual(20);
    expect(title.endsWith('…')).toBe(true);
  });

  it('counts an emoji stage name by code point, not code unit', () => {
    const title = closingAdvanceButtonTitle('🏡🏡🏡🏡🏡🏡🏡🏡🏡🏡🏡🏡');
    expect([...title].length).toBeLessThanOrEqual(20);
  });
});

describe('buildClosingCardBody', () => {
  const deal: ClosingDeal = {
    itemId: ITEM_ID,
    contactId: 'c-1',
    name: 'Dr Ravi N',
    phone: '+919945479966',
    assignedAgentUserId: null,
    propertyTitle: 'Commercial Building for Sale in JP Nagar',
    stageName: 'Token & Legal',
    nextStageName: 'Registration',
    daysStalled: 21,
  };

  it('names the buyer, the listing, the stage and the stall', () => {
    const body = buildClosingCardBody(deal);
    expect(body).toContain('Closing in progress');
    expect(body).toContain('Dr Ravi N · +919945479966');
    expect(body).toContain('Commercial Building for Sale in JP Nagar');
    expect(body).toContain('At *Token & Legal* — no movement for 21 days.');
    expect(body).toContain('Tap *Registration* once that step is done.');
  });

  it('never frames a closing deal as an open enquiry', () => {
    const body = buildClosingCardBody(deal);
    expect(body).not.toMatch(/enquiry/i);
    expect(body).not.toMatch(/quiet for/i);
    expect(body).not.toMatch(/cold/i);
  });

  it('drops the advance line at the end of the board', () => {
    const body = buildClosingCardBody({ ...deal, nextStageName: null });
    expect(body).not.toContain('once that step is done');
    expect(body).toContain('Snooze brings this back');
  });

  it('survives a deal with no listing title and one day stalled', () => {
    const body = buildClosingCardBody({
      ...deal,
      propertyTitle: null,
      daysStalled: 1,
    });
    expect(body).toContain('no movement for 1 day.');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });
});

describe('buildClosingAskText', () => {
  it('asks where the paperwork stands, by name and listing', () => {
    const text = buildClosingAskText('Dr Pruthvi', 'JP Nagar Building');
    expect(text).toContain('Hi Dr!');
    expect(text).toContain('*JP Nagar Building*');
    expect(text).toMatch(/paperwork/i);
  });

  // The whole reason this card exists: the enquiry check-in told a
  // buyer a week from registration that their enquiry was still open
  // and offered to close it.
  it('never mentions an enquiry, interest or closing', () => {
    const text = buildClosingAskText('Ravi', 'A Plot');
    expect(text).not.toMatch(/enquiry/i);
    expect(text).not.toMatch(/still (considering|interested)/i);
    expect(text).not.toMatch(/close/i);
  });

  it('never greets a placeholder name as a person', () => {
    const text = buildClosingAskText('Housing Lead', null);
    expect(text).toContain('Hi!');
    expect(text).toContain('your purchase');
  });
});

describe('gatherClosingDeals', () => {
  const NOW = new Date('2026-08-16T04:15:00Z');
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

  type Tables = {
    journey_stages: Record<string, unknown>[];
    journey_items: Record<string, unknown>[];
    closing_deal_nudges: Record<string, unknown>[];
    contacts: Record<string, unknown>[];
    properties: Record<string, unknown>[];
  };

  /** Applies eq/in itself rather than trusting the fixture: the stage
   *  kind and item status filters run server-side in the real query, so
   *  a pass-through mock would prove nothing about them. */
  function db(tables: Tables) {
    return {
      from: (table: keyof Tables) => {
        let rows = tables[table] ?? [];
        const chain: Record<string, unknown> = {
          select: () => chain,
          order: () => chain,
          eq: (column: string, value: unknown) => {
            rows = rows.filter((r) => r[column] === value);
            return chain;
          },
          in: (column: string, value: unknown[]) => {
            rows = rows.filter((r) => value.includes(r[column]));
            return chain;
          },
        };
        (chain as { then: unknown }).then = (
          resolve: (v: { data: unknown }) => void
        ) => resolve({ data: rows });
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const ACCOUNT = 'acct-1';

  const stage = (
    id: string,
    name: string,
    position: number,
    stage_kind: string
  ) => ({ id, name, position, stage_kind, account_id: ACCOUNT });

  const STAGES = [
    stage('s-shared', 'Shared', 0, 'prospecting'),
    stage('s-legal', 'Token & Legal', 1, 'closing'),
    stage('s-reg', 'Registration', 2, 'closing'),
    stage('s-paid', 'Brokerage Paid', 3, 'won'),
  ];

  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    account_id: ACCOUNT,
    contact_id: `c-${id}`,
    property_id: `p-${id}`,
    stage_id: 's-legal',
    status: 'active',
    updated_at: daysAgo(21),
    ...over,
  });

  const contact = (id: string, over: Record<string, unknown> = {}) => ({
    id: `c-${id}`,
    account_id: ACCOUNT,
    name: `Buyer ${id}`,
    phone: `+9199${id.padStart(8, '0')}`,
    assigned_agent_id: null,
    ...over,
  });

  const nudge = (
    itemId: string,
    last_nudged_at: string | null,
    snoozed_until: string | null
  ) => ({
    item_id: itemId,
    account_id: ACCOUNT,
    last_nudged_at,
    snoozed_until,
  });

  const base = (over: Partial<Tables> = {}): Tables => ({
    journey_stages: STAGES,
    journey_items: [item('1')],
    closing_deal_nudges: [],
    contacts: [contact('1')],
    properties: [
      { id: 'p-1', account_id: ACCOUNT, title: 'JP Nagar Building' },
    ],
    ...over,
  });

  it('cards a stalled deal with its stage and next stage', async () => {
    const deals = await gatherClosingDeals(db(base()), 'acct-1', NOW);
    expect(deals).toHaveLength(1);
    expect(deals[0].stageName).toBe('Token & Legal');
    expect(deals[0].nextStageName).toBe('Registration');
    expect(deals[0].daysStalled).toBe(21);
    expect(deals[0].propertyTitle).toBe('JP Nagar Building');
  });

  it('leaves a deal that moved inside the stall window alone', async () => {
    const deals = await gatherClosingDeals(
      db(base({ journey_items: [item('1', { updated_at: daysAgo(3) })] })),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(0);
  });

  it('ignores a prospecting item — that one is the radar’s job', async () => {
    const deals = await gatherClosingDeals(
      db(base({ journey_items: [item('1', { stage_id: 's-shared' })] })),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(0);
  });

  // Brokerage Paid is `won`, not `closing`: out of the enquiry radar
  // and with nothing left to chase, so it is carded to nobody.
  it('ignores a won deal', async () => {
    const deals = await gatherClosingDeals(
      db(base({ journey_items: [item('1', { stage_id: 's-paid' })] })),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(0);
  });

  it('holds back snoozed and recently-carded deals', async () => {
    const deals = await gatherClosingDeals(
      db(
        base({
          journey_items: [item('1'), item('2'), item('3')],
          contacts: [contact('1'), contact('2'), contact('3')],
          closing_deal_nudges: [
            nudge('1', null, daysAgo(-2)),
            nudge('2', daysAgo(3), null),
            // An elapsed snooze and an old card both release the deal.
            nudge('3', daysAgo(20), daysAgo(1)),
          ],
        })
      ),
      'acct-1',
      NOW
    );
    expect(deals.map((d) => d.itemId)).toEqual(['3']);
  });

  it('skips a buyer with no phone — there is nobody to ask', async () => {
    const deals = await gatherClosingDeals(
      db(base({ contacts: [contact('1', { phone: null })] })),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(0);
  });

  it('reports no next stage at the end of the board', async () => {
    const deals = await gatherClosingDeals(
      db(
        base({
          journey_stages: STAGES.slice(0, 2),
          journey_items: [item('1')],
        })
      ),
      'acct-1',
      NOW
    );
    expect(deals[0].nextStageName).toBeNull();
  });

  it('does nothing for an account that marked no closing stage', async () => {
    const deals = await gatherClosingDeals(
      db(
        base({
          journey_stages: STAGES.map((s) => ({
            ...s,
            stage_kind: 'prospecting',
          })),
        })
      ),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(0);
  });

  it('caps the run and leads with the longest-stalled', async () => {
    const deals = await gatherClosingDeals(
      db(
        base({
          journey_items: [
            item('1', { updated_at: daysAgo(16) }),
            item('2', { updated_at: daysAgo(40) }),
            item('3', { updated_at: daysAgo(22) }),
            item('4', { updated_at: daysAgo(31) }),
          ],
          contacts: [contact('1'), contact('2'), contact('3'), contact('4')],
        })
      ),
      'acct-1',
      NOW
    );
    expect(deals).toHaveLength(CLOSING_MAX_PER_RUN);
    expect(deals.map((d) => d.itemId)).toEqual(['2', '4', '3']);
  });
});

// The card only exists if the cron fires it, and the taps only work if
// the webhook dispatches them before the owner chatbot claims the
// agent's own message — the interception the enquiry card hit live.
describe('the closing card is wired up', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the webhook dispatches a closing tap before the owner chatbot', () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    const tap = source.indexOf('const closingAction = parseClosingReply(');
    const ownerChatbot = source.indexOf('processOwnerChatbotMessage(');
    expect(tap).toBeGreaterThan(-1);
    expect(ownerChatbot).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(ownerChatbot);
  });

  it('the radar cron also sends the closing cards', () => {
    const source = read('src/app/api/cron/follow-up-nudges/route.ts');
    expect(source).toContain('sendClosingDealNudges()');
  });

  // No approved template says "how is the paperwork going" — the
  // enquiry ones all assert an open enquiry awaiting a decision, which
  // is the false statement this card exists to stop.
  it('never reaches for a template on the closed-window path', () => {
    const source = read('src/lib/journey/closing-nudges.ts');
    expect(source).not.toContain("kind: 'template'");
    expect(source).not.toContain('templateName');
  });
});
