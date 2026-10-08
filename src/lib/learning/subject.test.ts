import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideSubject,
  listingsReferencedIn,
  propertiesNamedIn,
  resolvePropertySubject,
  resolveSubjectShift,
  type ListingRef,
  type ShareRecord,
  type ThreadMessage,
} from './subject';
import { questionSubjectProperties } from '@/lib/ai/lead-question';
import { memorySupabase } from '@/test/memory-supabase';

const OVAL_REEF = {
  id: 'prop-oval',
  project: 'Oval Reef',
  title: '70x60 Residential Plot in Oval Reef, Devanahalli',
};
const JADE_A = { id: 'jade-a', project: 'Jade Gardens', title: 'Plot A' };
const JADE_B = { id: 'jade-b', project: 'Jade Gardens', title: 'Plot B' };

describe('propertiesNamedIn', () => {
  it('finds the project an agent pitched mid-thread', () => {
    expect(
      propertiesNamedIn(
        'Have some inventories in Jade Gardens Devanahalli..Pls let me know if you are interested in the Jade Gardens project.',
        [OVAL_REEF, JADE_A]
      )
    ).toEqual(['jade-a']);
  });

  it('finds every listing in the named project', () => {
    expect(
      propertiesNamedIn('Have some inventories in Jade Gardens', [
        OVAL_REEF,
        JADE_A,
        JADE_B,
      ]).sort()
    ).toEqual(['jade-a', 'jade-b']);
  });

  it('ignores punctuation and casing the way people type', () => {
    expect(
      propertiesNamedIn('anything left in JADE-GARDENS?', [JADE_A])
    ).toEqual(['jade-a']);
  });

  it('does not match a project name inside a longer word', () => {
    expect(propertiesNamedIn('the jadegardens brochure', [JADE_A])).toEqual([]);
    expect(
      propertiesNamedIn('Jadeite Gardenside is a different place', [JADE_A])
    ).toEqual([]);
  });

  it('ignores a project name too short to carry signal', () => {
    expect(
      propertiesNamedIn('a big oak tree out front', [
        { id: 'p', project: 'Oak', title: 'Plot' },
      ])
    ).toEqual([]);
  });

  it('falls back to a full title only for a listing with no project', () => {
    const untitled = {
      id: 'p-notitle',
      project: null,
      title: 'Farm Land in Devanahalli',
    };
    expect(
      propertiesNamedIn('about that Farm Land in Devanahalli', [untitled])
    ).toEqual(['p-notitle']);
    // A partial title must not fire — "plot" would claim half the book.
    expect(propertiesNamedIn('any farm land going?', [untitled])).toEqual([]);
  });

  it('says nothing about empty text', () => {
    expect(propertiesNamedIn('', [OVAL_REEF])).toEqual([]);
  });
});

describe('resolveSubjectShift', () => {
  it('moves the subject when an agent pitched a different, single listing', () => {
    // The real thread: the plot was shared, then the agent offered
    // Jade Gardens, then the buyer asked "Is it by a A grade builder???"
    expect(
      resolveSubjectShift(
        ['Have some inventories in Jade Gardens Devanahalli'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'moved', propertyId: 'jade-a' });
  });

  it('refuses to pick when the named project holds several listings', () => {
    expect(
      resolveSubjectShift(
        ['Have some inventories in Jade Gardens Devanahalli'],
        [OVAL_REEF, JADE_A, JADE_B],
        'prop-oval'
      )
    ).toEqual({ kind: 'ambiguous' });
  });

  it('leaves the subject alone when the agent was still on the shared listing', () => {
    expect(
      resolveSubjectShift(
        ['Sending the Oval Reef survey sketch now'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('reads newest-first, so the latest pitch wins', () => {
    expect(
      resolveSubjectShift(
        [
          'Have some inventories in Jade Gardens Devanahalli',
          'Sharing the Oval Reef details',
        ],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'moved', propertyId: 'jade-a' });
  });

  it('skips agent chatter that names nothing', () => {
    expect(
      resolveSubjectShift(
        ["Hey Anju , seller's final price is 10.5k per sqft.", 'Will revert'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('leaves the ledger in charge when the agent has said nothing', () => {
    expect(resolveSubjectShift([], [OVAL_REEF], 'prop-oval')).toEqual({
      kind: 'unchanged',
    });
  });
});

// shirish's thread of 7 October 2026, as stored. Times are UTC; the
// comments give IST.
const JP_NAGAR_4TH: ListingRef = {
  id: 'prop-1004',
  property_code: 'PROP-1004',
  title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
  status: 'Under Contract',
};
const AKSHAY_NAGAR: ListingRef = {
  id: 'prop-1110',
  property_code: 'PROP-1110',
  title:
    '1.5 Acre Residential Converted Land in Akshay Nagar, Off Bannerghatta Road, 30 feet road.',
  status: 'Available',
};
const HOSUR_ROAD: ListingRef = {
  id: 'prop-1081',
  property_code: 'PROP-1081',
  title: '40000 Sq.Ft. Commercial/Residential Land for Sale on Hosur Road',
  status: 'Available',
};
const CHIKATOGUR: ListingRef = {
  id: 'prop-1784',
  property_code: 'PROP-1784',
  title: '40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1',
  status: 'Available',
};
const JP_NAGAR_8TH: ListingRef = {
  id: 'prop-2080',
  property_code: 'PROP-2080',
  title: '5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase',
  status: 'Available',
};
const LISTINGS = [
  JP_NAGAR_4TH,
  AKSHAY_NAGAR,
  HOSUR_ROAD,
  CHIKATOGUR,
  JP_NAGAR_8TH,
];

const ENQUIRY_AKSHAY =
  'Hi! I am interested in your property "1.5 Acre Residential Converted Land in Akshay Nagar, Off Bannerghatta Road, 30 feet road." in Akshay Nagar, Bangalore. Please share details. (Property ID: PROP-1110)';
const ENQUIRY_HOSUR =
  'Hi! I am interested in your property "40000 Sq.Ft. Commercial/Residential Land for Sale on Hosur Road" in Electronic City Phase 1, Bangalore. Please share details. (Property ID: PROP-1081)';
const SHARE_CHIKATOGUR =
  'Hi shirish,\n\nI wanted to share a property listing that might interest you:\n\n🏡 *40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1*\n💰 *₹16 Cr*\n\n📸 Photos & full details:\nhttps://aryavartaventures.convoreal.com/?property_id=PROP-1784&v=0a97fd6d';
const SHARE_JP_8TH =
  'Hi shirish,\n\nI wanted to share a property listing that might interest you:\n\n🏡 *5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase*\n💰 *₹13.25 Cr*\n\n📸 Photos & full details:\nhttps://aryavartaventures.convoreal.com/?property_id=PROP-2080&v=0a97fd6d';

/** Newest first, the way the resolver reads them. */
function thread(rows: [string, string, string, string?][]): ThreadMessage[] {
  return rows
    .map(([at, sender, text, messageId]) => ({
      at,
      sender,
      text,
      messageId: messageId ?? null,
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

describe('[INB-033] listingsReferencedIn', () => {
  it('reads the property code the showcase enquiry stamps on its message', () => {
    expect(listingsReferencedIn(ENQUIRY_AKSHAY, LISTINGS)).toEqual([
      'prop-1110',
    ]);
  });

  it('reads the property code inside a share link', () => {
    expect(listingsReferencedIn(SHARE_CHIKATOGUR, LISTINGS)).toEqual([
      'prop-1784',
    ]);
  });

  it('falls back to a full title, the way a share image is captioned', () => {
    expect(
      listingsReferencedIn(
        'Showcase image for 40000 Sq.Ft. Commercial/Residential Land for Sale on Hosur Road',
        LISTINGS
      )
    ).toEqual(['prop-1081']);
  });

  it('does not read one code inside a longer one', () => {
    expect(
      listingsReferencedIn('Property ID: PROP-10045', [
        JP_NAGAR_4TH,
        { id: 'prop-10045', property_code: 'PROP-10045', title: 'Other' },
      ])
    ).toEqual(['prop-10045']);
  });

  it('ignores a title too short to carry signal', () => {
    expect(
      listingsReferencedIn('is plot a still there', [
        { id: 'a', property_code: null, title: 'Plot A' },
      ])
    ).toEqual([]);
  });

  it('counts a title nested in a longer matched title as one mention', () => {
    const short = { id: 'short', title: 'Commercial Plot in Chikatogur' };
    expect(
      listingsReferencedIn(
        'about the 40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1',
        [{ ...CHIKATOGUR, property_code: null }, short]
      )
    ).toEqual(['prop-1784']);
  });

  it('says nothing about a message that names no listing', () => {
    expect(listingsReferencedIn('Is this available? 👆🏻', LISTINGS)).toEqual([]);
  });
});

describe('[INB-033] decideSubject replays the 7 October thread', () => {
  const afternoonShare: ShareRecord = {
    propertyId: 'prop-1004',
    at: '2026-10-07T11:21:32Z',
  };

  it('answers "is this available?" under an enquiry about the enquired listing, not the older share', () => {
    // 20:08:44 enquiry, 20:08:51 question; the last share was 16:51.
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T11:21:31Z', 'agent', JP_NAGAR_4TH.title as string],
        ['2026-10-07T14:38:44Z', 'customer', ENQUIRY_AKSHAY],
        [
          '2026-10-07T14:38:51Z',
          'customer',
          'Is this available? 👆🏻',
          'wamid.q1',
        ],
      ]),
      shares: [afternoonShare],
      candidates: LISTINGS,
      currentMessageId: 'wamid.q1',
    });
    expect(subject).toBe('prop-1110');
  });

  it('answers a quoted share about the quoted listing, not the one shared a minute later', () => {
    // 20:31 Chikatogur shared, 20:32 JP Nagar 8th shared, 20:50 the
    // buyer quotes the Chikatogur share.
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
        ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
        ['2026-10-07T15:20:00Z', 'customer', 'Is this available?', 'wamid.q2'],
      ]),
      shares: [
        { propertyId: 'prop-2080', at: '2026-10-07T15:02:34Z' },
        { propertyId: 'prop-1784', at: '2026-10-07T15:01:46Z' },
      ],
      candidates: LISTINGS,
      quotedText: SHARE_CHIKATOGUR,
      currentMessageId: 'wamid.q2',
    });
    expect(subject).toBe('prop-1784');
  });

  it('hands over an unquoted question after two listings shared back to back', () => {
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
        ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
        ['2026-10-07T15:20:00Z', 'customer', 'Is this available?', 'wamid.q2'],
      ]),
      shares: [
        { propertyId: 'prop-2080', at: '2026-10-07T15:02:34Z' },
        { propertyId: 'prop-1784', at: '2026-10-07T15:01:46Z' },
      ],
      candidates: LISTINGS,
      currentMessageId: 'wamid.q2',
    });
    expect(subject).toBeNull();
  });

  it('keeps answering the latest share once the buyer has spoken since the burst', () => {
    // 20:10 two listings shared nine seconds apart; the buyer replied,
    // then at 20:18 asked again about the one in front of them.
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T14:40:05Z', 'customer', ENQUIRY_HOSUR],
        ['2026-10-07T14:41:24Z', 'customer', 'Interested in 1'],
        ['2026-10-07T14:47:45Z', 'customer', 'What about this ?'],
        [
          '2026-10-07T14:48:33Z',
          'customer',
          'Is it available for sale ?',
          'wamid.q3',
        ],
      ]),
      shares: [
        { propertyId: 'prop-1081', at: '2026-10-07T14:40:46Z' },
        { propertyId: 'prop-1110', at: '2026-10-07T14:40:37Z' },
      ],
      candidates: LISTINGS,
      quotedText:
        'This is an East-facing 40000 Sq.Ft. commercial/residential land available for sale',
      currentMessageId: 'wamid.q3',
    });
    expect(subject).toBe('prop-1081');
  });

  it('ignores an enquiry older than the latest share', () => {
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T14:40:05Z', 'customer', ENQUIRY_HOSUR],
        ['2026-10-07T14:50:00Z', 'customer', 'price?', 'wamid.q4'],
      ]),
      shares: [{ propertyId: 'prop-2080', at: '2026-10-07T14:45:00Z' }],
      candidates: LISTINGS,
      currentMessageId: 'wamid.q4',
    });
    expect(subject).toBe('prop-2080');
  });

  it('resolves a quoted share of an under-contract listing to it, so its status is told', () => {
    expect(
      decideSubject({
        messages: [],
        shares: [{ propertyId: 'prop-2080', at: '2026-10-07T15:02:34Z' }],
        candidates: LISTINGS,
        quotedText: JP_NAGAR_4TH.title,
      })
    ).toBe('prop-1004');
  });

  it('refuses to pick when the quoted message names several listings', () => {
    expect(
      decideSubject({
        messages: [],
        shares: [{ propertyId: 'prop-2080', at: '2026-10-07T15:02:34Z' }],
        candidates: LISTINGS,
        quotedText: `1. ${HOSUR_ROAD.title}\n2. ${CHIKATOGUR.title}`,
      })
    ).toBeNull();
  });

  it('lets an agent pitch made after the enquiry move the subject', () => {
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T14:38:44Z', 'customer', ENQUIRY_AKSHAY],
        ['2026-10-07T14:39:30Z', 'agent', `Also see ${CHIKATOGUR.title}`],
        ['2026-10-07T14:40:00Z', 'customer', 'Is it available?', 'wamid.q5'],
      ]),
      shares: [afternoonShare],
      candidates: LISTINGS,
      currentMessageId: 'wamid.q5',
    });
    expect(subject).toBe('prop-1784');
  });

  it('still answers from the share ledger when nothing else is said', () => {
    expect(
      decideSubject({
        messages: thread([
          [
            '2026-10-07T11:29:44Z',
            'customer',
            'Is this available for sale ?',
            'w',
          ],
        ]),
        shares: [afternoonShare],
        candidates: LISTINGS,
        currentMessageId: 'w',
      })
    ).toBe('prop-1004');
  });
});

describe('[INB-033] resolvePropertySubject reads the quote and the enquiry from the thread', () => {
  const tables = () => ({
    properties: LISTINGS.map((listing) => ({ ...listing, account_id: 'acc' })),
    property_shares: [
      {
        account_id: 'acc',
        contact_id: 'c1',
        property_id: 'prop-1784',
        created_at: '2026-10-07T15:01:46Z',
      },
      {
        account_id: 'acc',
        contact_id: 'c1',
        property_id: 'prop-2080',
        created_at: '2026-10-07T15:02:34Z',
      },
    ],
    messages: [
      {
        conversation_id: 'conv',
        sender_type: 'agent',
        content_text: SHARE_CHIKATOGUR,
        message_id: 'wamid.share1784',
        created_at: '2026-10-07T15:01:45Z',
      },
      {
        conversation_id: 'conv',
        sender_type: 'agent',
        content_text: SHARE_JP_8TH,
        message_id: 'wamid.share2080',
        created_at: '2026-10-07T15:02:34Z',
      },
      {
        conversation_id: 'conv',
        sender_type: 'customer',
        content_text: 'Is this available?',
        message_id: 'wamid.q2',
        created_at: '2026-10-07T15:20:00Z',
      },
    ],
  });

  it('follows the WhatsApp quote to the listing it shared', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    await expect(
      resolvePropertySubject(db, 'acc', 'c1', 'conv', {
        messageId: 'wamid.q2',
        quotedMessageId: 'wamid.share1784',
      })
    ).resolves.toBe('prop-1784');
  });

  it('hands over the same question without a quote', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    await expect(
      resolvePropertySubject(db, 'acc', 'c1', 'conv', { messageId: 'wamid.q2' })
    ).resolves.toBeNull();
  });

  it('carries the quote through the lead Q&A subject lookup', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    const subjects = await questionSubjectProperties(
      db,
      'acc',
      'c1',
      'conv',
      'Is this available?',
      { messageId: 'wamid.q2', quotedMessageId: 'wamid.share1784' }
    );
    expect(subjects.map((subject) => subject.id)).toEqual(['prop-1784']);
  });
});
