import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseFollowUpReply,
  buildFollowUpCardBody,
  buildFollowUpCheckinText,
  gatherFollowUpLeads,
  FOLLOWUP_CHECKIN_PREFIX,
  FOLLOWUP_SNOOZE_PREFIX,
  FOLLOWUP_COLD_PREFIX,
  FOLLOWUP_MAX_PER_RUN,
} from './follow-up-nudges';

// A ₹5-10 Cr lead said "we can talk whenever" and went six days
// unanswered, because the only watchdog was a panel nobody had to
// open. These pin the card that replaces it — and that the radar can
// never become the spam that would get it muted.

const CONTACT_ID = '0c90e85c-b699-45d3-b42b-772ad1357d14';

describe('parseFollowUpReply', () => {
  it('round-trips the contact id out of each button', () => {
    expect(
      parseFollowUpReply(`${FOLLOWUP_CHECKIN_PREFIX}${CONTACT_ID}`)
    ).toEqual({ action: 'checkin', contactId: CONTACT_ID });
    expect(
      parseFollowUpReply(`${FOLLOWUP_SNOOZE_PREFIX}${CONTACT_ID}`)?.action
    ).toBe('snooze');
    expect(
      parseFollowUpReply(`${FOLLOWUP_COLD_PREFIX}${CONTACT_ID}`)?.action
    ).toBe('cold');
  });

  it('ignores every other button in the inbox', () => {
    for (const id of [
      'enq_approve:a:b',
      'share_property_yes:abc',
      '',
      null,
      undefined,
    ]) {
      expect(parseFollowUpReply(id), String(id)).toBeNull();
    }
  });

  it('refuses a bare prefix rather than guessing a contact', () => {
    expect(parseFollowUpReply(FOLLOWUP_CHECKIN_PREFIX)).toBeNull();
  });
});

describe('buildFollowUpCardBody', () => {
  const lead = {
    contactId: CONTACT_ID,
    name: 'Hari',
    phone: '+919945233018',
    assignedAgentUserId: null,
    daysSilent: 6,
    propertyTitle: '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
  };

  it('names the lead, the listing and the silence', () => {
    const body = buildFollowUpCardBody(lead);
    expect(body).toContain('Follow-up due');
    expect(body).toContain('Hari · +919945233018');
    expect(body).toContain('2400 Sqft Commercial Plot');
    expect(body).toContain('quiet for 6 days');
  });

  it('survives a lead with no name and no listing', () => {
    const body = buildFollowUpCardBody({
      ...lead,
      name: null,
      propertyTitle: null,
      daysSilent: 1,
    });
    expect(body).toContain('+919945233018');
    expect(body).toContain('quiet for 1 day.');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });
});

describe('buildFollowUpCheckinText', () => {
  it('asks where the lead stands, by name and listing', () => {
    const text = buildFollowUpCheckinText('Hari Killi', '2400 Sqft Plot');
    expect(text).toContain('Hi Hari!');
    expect(text).toContain('*2400 Sqft Plot*');
    expect(text).toMatch(/where do you stand/i);
  });

  it('never greets a placeholder name as a person', () => {
    const text = buildFollowUpCheckinText('Housing Lead', null);
    expect(text).toContain('Hi!');
    expect(text).toContain('your property search');
  });
});

describe('gatherFollowUpLeads', () => {
  const NOW = new Date('2026-08-14T04:15:00Z');
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

  type Tables = {
    contacts: Record<string, unknown>[];
    follow_up_nudges: Record<string, unknown>[];
    properties: Record<string, unknown>[];
    journey_stages?: Record<string, unknown>[];
    journey_items?: Record<string, unknown>[];
    contact_parties?: Record<string, unknown>[];
    contact_party_members?: Record<string, unknown>[];
  };

  /** Filters are pass-through except `.in('id', …)`, which the party
   *  path uses to fetch members who fell outside the HOT filter — the
   *  COLD spouse who is nonetheless the one who replied. */
  function db(tables: Tables) {
    return {
      from: (table: keyof Tables) => {
        let rows = tables[table] ?? [];
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: (column: string, value: unknown[]) => {
            if (column === 'id') {
              rows = rows.filter((r) => value.includes(r.id));
            }
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

  const contact = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `Lead ${id}`,
    phone: `+9199${id.padStart(8, '0')}`,
    last_contacted_at: daysAgo(6),
    created_at: daysAgo(30),
    assigned_agent_id: null,
    last_inquired_property_id: null,
    ...over,
  });

  it('surfaces a quiet lead with its listing title', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [contact('1', { last_inquired_property_id: 'p-1' })],
        follow_up_nudges: [],
        properties: [{ id: 'p-1', title: 'JP Nagar Plot' }],
      }),
      'acct-1',
      NOW
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].daysSilent).toBe(6);
    expect(leads[0].propertyTitle).toBe('JP Nagar Plot');
  });

  it('holds back snoozed and recently-nudged leads', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [contact('1'), contact('2'), contact('3')],
        follow_up_nudges: [
          { contact_id: '1', last_nudged_at: null, snoozed_until: daysAgo(-2) },
          { contact_id: '2', last_nudged_at: daysAgo(2), snoozed_until: null },
          // An elapsed snooze and an old nudge both release the lead.
          {
            contact_id: '3',
            last_nudged_at: daysAgo(10),
            snoozed_until: daysAgo(1),
          },
        ],
        properties: [],
      }),
      'acct-1',
      NOW
    );
    expect(leads.map((l) => l.contactId)).toEqual(['3']);
  });

  it('skips a lead heard from within the silence threshold', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [contact('1', { last_contacted_at: daysAgo(1) })],
        follow_up_nudges: [],
        properties: [],
      }),
      'acct-1',
      NOW
    );
    expect(leads).toHaveLength(0);
  });

  it('treats a never-contacted lead as silent since creation', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [
          contact('1', { last_contacted_at: null, created_at: daysAgo(4) }),
        ],
        follow_up_nudges: [],
        properties: [],
      }),
      'acct-1',
      NOW
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].daysSilent).toBe(4);
  });

  it('skips a lead with no phone — there is nothing to check in on', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [contact('1', { phone: null })],
        follow_up_nudges: [],
        properties: [],
      }),
      'acct-1',
      NOW
    );
    expect(leads).toHaveLength(0);
  });

  it('leaves a lead alone once the deal reaches legal', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [contact('1'), contact('2')],
        follow_up_nudges: [],
        properties: [],
        journey_stages: [{ id: 's-legal', name: 'Token & Legal' }],
        journey_items: [{ contact_id: '1', stage_id: 's-legal' }],
      }),
      'acct-1',
      NOW
    );
    expect(leads.map((l) => l.contactId)).toEqual(['2']);
  });

  it('spends the run on leads a closing deal would have crowded out', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [
          contact('1', { last_contacted_at: daysAgo(28) }),
          contact('2', { last_contacted_at: daysAgo(9) }),
          contact('3', { last_contacted_at: daysAgo(5) }),
          contact('4', { last_contacted_at: daysAgo(3) }),
        ],
        follow_up_nudges: [],
        properties: [],
        journey_stages: [{ id: 's-legal', name: 'Token & Legal' }],
        journey_items: [{ contact_id: '1', stage_id: 's-legal' }],
      }),
      'acct-1',
      NOW
    );
    // The 28-day "silence" is a registration in progress. Dropping it
    // before the cap is what lets the fourth lead onto the card run.
    expect(leads.map((l) => l.contactId)).toEqual(['2', '3', '4']);
  });

  // The live incident: husband and wife, one listing, two cards saying
  // "quiet for 28 days" and "quiet for 19 days".
  describe('people buying together', () => {
    const asParty = (...contactIds: string[]) => ({
      contact_parties: [{ id: 'p-1', name: null, kind: 'household' }],
      contact_party_members: contactIds.map((id, i) => ({
        party_id: 'p-1',
        contact_id: id,
        is_primary: i === 0,
      })),
    });

    it('cards the deal once and names both people', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          contacts: [contact('1'), contact('2')],
          follow_up_nudges: [],
          properties: [],
          ...asParty('1', '2'),
        }),
        'acct-1',
        NOW
      );
      expect(leads).toHaveLength(1);
      expect(leads[0].contactId).toBe('1');
      expect(leads[0].partyName).toBe('Lead 1 & Lead 2');
      expect(leads[0].partyContactIds).toEqual(['1', '2']);
    });

    // The heart of it: silence is per thread, so the wife replying
    // never reset the husband's clock and the deal read as quiet while
    // it was in active contact.
    it('is not quiet when any member has replied recently', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          contacts: [
            contact('1', { last_contacted_at: daysAgo(28) }),
            contact('2', { last_contacted_at: daysAgo(1) }),
          ],
          follow_up_nudges: [],
          properties: [],
          ...asParty('1', '2'),
        }),
        'acct-1',
        NOW
      );
      expect(leads).toHaveLength(0);
    });

    it('counts the silence from the party, not the addressed member', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          contacts: [
            contact('1', { last_contacted_at: daysAgo(28) }),
            contact('2', { last_contacted_at: daysAgo(19) }),
          ],
          follow_up_nudges: [],
          properties: [],
          ...asParty('1', '2'),
        }),
        'acct-1',
        NOW
      );
      expect(leads[0].daysSilent).toBe(19);
    });

    // Snoozing the husband must not leave the wife's card to fire the
    // next morning — that is the duplicate, one day later.
    it('honours a hold placed on any member', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          contacts: [contact('1'), contact('2')],
          follow_up_nudges: [
            { contact_id: '2', last_nudged_at: null, snoozed_until: daysAgo(-2) },
          ],
          properties: [],
          ...asParty('1', '2'),
        }),
        'acct-1',
        NOW
      );
      expect(leads).toHaveLength(0);
    });

    // The spouse who replied may be filed COLD, so she never appears in
    // the HOT query the radar starts from — her reply still counts.
    it('counts a reply from a member the radar itself would not card', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          // Only the husband is HOT, so only he is returned by the
          // first query; the wife is fetched by id for her timestamp.
          contacts: [
            contact('1', { last_contacted_at: daysAgo(28) }),
            contact('cold', { last_contacted_at: daysAgo(1) }),
          ],
          follow_up_nudges: [],
          properties: [],
          ...asParty('1', 'cold'),
        }),
        'acct-1',
        NOW
      );
      expect(leads).toHaveLength(0);
    });

    it('addresses the primary member', async () => {
      const leads = await gatherFollowUpLeads(
        db({
          contacts: [contact('1'), contact('2')],
          follow_up_nudges: [],
          properties: [],
          ...asParty('2', '1'),
        }),
        'acct-1',
        NOW
      );
      expect(leads[0].contactId).toBe('2');
    });
  });

  it('caps the run and leads with the longest-silent', async () => {
    const leads = await gatherFollowUpLeads(
      db({
        contacts: [
          contact('1', { last_contacted_at: daysAgo(3) }),
          contact('2', { last_contacted_at: daysAgo(9) }),
          contact('3', { last_contacted_at: daysAgo(5) }),
          contact('4', { last_contacted_at: daysAgo(7) }),
        ],
        follow_up_nudges: [],
        properties: [],
      }),
      'acct-1',
      NOW
    );
    expect(leads).toHaveLength(FOLLOWUP_MAX_PER_RUN);
    expect(leads.map((l) => l.contactId)).toEqual(['2', '4', '3']);
  });
});

// The card only exists if the cron fires and the taps only work if the
// webhook dispatches them before the owner chatbot claims the agent's
// own message — the exact interception the enquiry card hit live.
describe('the radar is wired up', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the webhook dispatches a radar tap before the owner chatbot', () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    const tap = source.indexOf('const followUpAction = parseFollowUpReply(');
    const ownerChatbot = source.indexOf('processOwnerChatbotMessage(');
    expect(tap).toBeGreaterThan(-1);
    expect(ownerChatbot).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(ownerChatbot);
  });

  it('the webhook heats a lead before the enquiry branch can consume the message', () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    const heat = source.indexOf('maybeAutoHeatContact({');
    const enquiryBranch = source.indexOf('enquiryByCode &&\n');
    expect(heat).toBeGreaterThan(-1);
    expect(enquiryBranch).toBeGreaterThan(-1);
    expect(heat).toBeLessThan(enquiryBranch);
  });

  // A card is a button that survives in the agent's chat, so the tap
  // can land days after the lead moved to legal. Filtering the cron's
  // query alone would still fire the check-in on that stale tap.
  it('the tap handler re-checks the stage before any action runs', () => {
    const source = read('src/lib/contacts/follow-up-nudges.ts');
    const handler = source.indexOf('export async function handleFollowUpReply');
    const guard = source.indexOf('loadPastEnquiryContacts(admin', handler);
    const coldAction = source.indexOf("if (action.action === 'cold')", handler);
    expect(guard).toBeGreaterThan(-1);
    expect(coldAction).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(coldAction);
  });

  it('the cron is scheduled', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      crons: Array<{ path: string }>;
    };
    expect(
      vercel.crons.some((c) => c.path === '/api/cron/follow-up-nudges')
    ).toBe(true);
  });
});
