import { describe, expect, it } from 'vitest';

import {
  MAX_DEAL_PARTICIPANTS,
  dealCreateWarning,
  dealTitleFromEvent,
  parseDealParticipants,
  participantRoleForContact,
  participantRoleForStakeholder,
  participantsFromEvent,
  participantsToStore,
  primaryContactId,
  stakeholderFieldsForParticipant,
  suggestDealsForEvent,
} from './participants';

describe('[PIPE-007] a deal takes several contacts, each a buyer, seller or agent', () => {
  it('stores each role as the matching stakeholder role and side', () => {
    expect(stakeholderFieldsForParticipant('buyer')).toEqual({
      role: 'buyer',
      side: 'buyer',
    });
    expect(stakeholderFieldsForParticipant('seller')).toEqual({
      role: 'seller',
      side: 'seller',
    });
    expect(stakeholderFieldsForParticipant('agent')).toEqual({
      role: 'broker',
      side: 'internal',
    });
    expect(participantRoleForStakeholder('broker')).toBe('agent');
    expect(participantRoleForStakeholder('advocate')).toBeNull();
  });

  it('accepts several buyers, sellers and agents and drops a repeated contact', () => {
    const parsed = parseDealParticipants([
      { contact_id: 'c1', role: 'buyer' },
      { contact_id: 'c2', role: 'buyer' },
      { contact_id: 'c3', role: 'seller' },
      { contact_id: 'c4', role: 'agent' },
      { contact_id: 'c1', role: 'seller' },
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: [
        { contact_id: 'c1', role: 'buyer' },
        { contact_id: 'c2', role: 'buyer' },
        { contact_id: 'c3', role: 'seller' },
        { contact_id: 'c4', role: 'agent' },
      ],
    });
    expect(parseDealParticipants(undefined)).toEqual({ ok: true, value: [] });
  });

  it('refuses an unknown role, a missing contact and an oversized list', () => {
    expect(
      parseDealParticipants([{ contact_id: 'c1', role: 'advocate' }]).ok
    ).toBe(false);
    expect(parseDealParticipants([{ role: 'buyer' }]).ok).toBe(false);
    expect(parseDealParticipants('c1').ok).toBe(false);
    const many = Array.from({ length: MAX_DEAL_PARTICIPANTS + 1 }, (_, i) => ({
      contact_id: `c${i}`,
      role: 'buyer',
    }));
    expect(parseDealParticipants(many).ok).toBe(false);
  });

  it("keeps the named contact as the deal's own, else the first buyer", () => {
    const people = [
      { contact_id: 'agent', role: 'agent' as const },
      { contact_id: 'buyer', role: 'buyer' as const },
    ];
    expect(primaryContactId(people, 'agent')).toBe('agent');
    expect(primaryContactId(people)).toBe('buyer');
    expect(primaryContactId([people[0]])).toBe('agent');
    expect(primaryContactId([])).toBeNull();
  });

  it('writes no stakeholder row for a lone buyer, and every row otherwise', () => {
    expect(participantsToStore([{ contact_id: 'c1', role: 'buyer' }])).toEqual(
      []
    );
    expect(
      participantsToStore([{ contact_id: 'c1', role: 'agent' }])
    ).toHaveLength(1);
    expect(
      participantsToStore([
        { contact_id: 'c1', role: 'buyer' },
        { contact_id: 'c2', role: 'seller' },
      ])
    ).toHaveLength(2);
  });
});

describe('[CAL-022] a calendar event connects to a deal', () => {
  const event = {
    title: 'Meeting — Commercial Building',
    contact_id: 'ashwath',
    contact_ids: ['ashwath', 'nimmy', 'victor'],
    property_id: 'p1',
  };

  it("starts a new deal with every contact on the event, roles read off each contact and the property's owner as seller", () => {
    expect(
      participantsFromEvent(
        event,
        [
          { id: 'ashwath', classification: 'Buyer' },
          { id: 'nimmy', classification: 'Others' },
          { id: 'victor', classification: 'Agent' },
        ],
        'nimmy'
      )
    ).toEqual([
      { contact_id: 'ashwath', role: 'buyer' },
      { contact_id: 'nimmy', role: 'seller' },
      { contact_id: 'victor', role: 'agent' },
    ]);
    expect(participantRoleForContact('Owner')).toBe('seller');
    expect(participantRoleForContact(null)).toBe('buyer');
  });

  it('falls back to the single contact and skips one that no longer exists', () => {
    expect(
      participantsFromEvent({ contact_id: 'c1', contact_ids: [] }, [
        { id: 'c1', classification: 'Buyer' },
      ])
    ).toEqual([{ contact_id: 'c1', role: 'buyer' }]);
    expect(
      participantsFromEvent({ contact_ids: ['gone', 'c1'] }, [{ id: 'c1' }])
    ).toEqual([{ contact_id: 'c1', role: 'buyer' }]);
  });

  it('titles the deal from the property and buyer, else the event', () => {
    expect(
      dealTitleFromEvent({
        eventTitle: 'Call',
        propertyTitle: 'Commercial Building',
        contactName: 'Ashwath Reddy',
      })
    ).toBe('Commercial Building — Ashwath Reddy');
    expect(dealTitleFromEvent({ eventTitle: 'Call' })).toBe('Call');
  });

  it('suggests deals that share the property or a contact, best match and open deals first', () => {
    const deals = [
      { id: 'unrelated', contact_id: 'x', property_id: 'p9', status: 'open' },
      { id: 'contact', contact_id: 'nimmy', property_id: 'p9', status: 'open' },
      { id: 'property', contact_id: 'x', property_id: 'p1', status: 'open' },
      { id: 'won', contact_id: 'victor', property_id: 'p1', status: 'won' },
      { id: 'both', contact_id: 'victor', property_id: 'p1', status: 'open' },
      { id: 'side', contact_id: 'x', property_id: 'p1', status: 'open' },
    ];
    expect(
      suggestDealsForEvent(deals, event, { side: ['ashwath'] }).map((d) => d.id)
    ).toEqual(['both', 'side', 'won', 'property', 'contact']);
  });
});

describe('[PIPE-007] a deal whose contacts or event link were not saved says so', () => {
  it('is silent when everything was saved', () => {
    expect(dealCreateWarning({ id: 'd1' })).toBeNull();
    expect(
      dealCreateWarning({
        id: 'd1',
        participants_saved: true,
        appointment_linked: true,
      })
    ).toBeNull();
  });

  it('names what was not saved', () => {
    expect(dealCreateWarning({ participants_saved: false })).toContain(
      'other contacts were not saved'
    );
    expect(dealCreateWarning({ appointment_linked: false })).toContain(
      'calendar event was not connected'
    );
    const both = dealCreateWarning({
      participants_saved: false,
      appointment_linked: false,
    });
    expect(both).toContain('other contacts were not saved');
    expect(both).toContain('calendar event was not connected');
  });
});
