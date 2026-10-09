import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideSubject,
  decideSubjects,
  listingsReferencedIn,
  propertiesNamedIn,
  resolvePropertySubject,
  resolveSubjectProperties,
  resolveSubjectShift,
  shareBurst,
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
  land_area: '40000',
  land_area_unit: 'Sq.Ft.',
};
const JP_NAGAR_8TH: ListingRef = {
  id: 'prop-2080',
  property_code: 'PROP-2080',
  title: '5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase',
  status: 'Available',
  area_sqft: 5760,
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
    // 20:10 two listings shared nine seconds apart; the buyer tapped the
    // quick check and the bot flagged the card they picked, then at
    // 20:18 they asked again about the one in front of them.
    const subject = decideSubject({
      messages: thread([
        ['2026-10-07T14:40:05Z', 'customer', ENQUIRY_HOSUR],
        ['2026-10-07T14:41:24Z', 'customer', 'Interested in 1'],
        [
          '2026-10-07T14:41:30Z',
          'bot',
          `Great choice 👌 I've flagged your interest in *${HOSUR_ROAD.title}* — our team will reach out shortly.`,
        ],
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

describe('[INB-033] decideSubject measures against the real last share', () => {
  it('lets a bot re-share outrank an enquiry made after the first share', () => {
    // A first shared in June; the buyer enquired about B in July; the
    // bot re-sent A in October, which the ledger does not record.
    const subject = decideSubject({
      messages: thread([
        ['2026-07-01T10:00:00Z', 'customer', ENQUIRY_HOSUR],
        [
          '2026-10-07T10:00:00Z',
          'bot',
          `🏠 *${CHIKATOGUR.title}*\nhttps://x.convoreal.com/?property_id=PROP-1784`,
        ],
        ['2026-10-07T10:05:00Z', 'customer', 'Is this available?', 'w'],
      ]),
      shares: [{ propertyId: 'prop-1784', at: '2026-06-01T10:00:00Z' }],
      candidates: LISTINGS,
      currentMessageId: 'w',
    });
    expect(subject).toBe('prop-1784');
  });

  it('ignores an agent pitch made before the latest share', () => {
    const subject = decideSubject({
      messages: thread([
        [
          '2026-10-07T09:00:00Z',
          'agent',
          'Have some inventories in Jade Gardens Devanahalli',
        ],
        [
          '2026-10-07T10:30:00Z',
          'customer',
          'Is it by an A grade builder?',
          'w',
        ],
      ]),
      shares: [{ propertyId: 'prop-oval', at: '2026-10-07T10:00:00Z' }],
      candidates: [OVAL_REEF, JADE_A],
      currentMessageId: 'w',
    });
    expect(subject).toBe('prop-oval');
  });

  it('still lets an agent pitch made after the latest share move the subject', () => {
    const subject = decideSubject({
      messages: thread([
        [
          '2026-10-07T10:10:00Z',
          'agent',
          'Have some inventories in Jade Gardens Devanahalli',
        ],
        [
          '2026-10-07T10:30:00Z',
          'customer',
          'Is it by an A grade builder?',
          'w',
        ],
      ]),
      shares: [{ propertyId: 'prop-oval', at: '2026-10-07T10:00:00Z' }],
      candidates: [OVAL_REEF, JADE_A],
      currentMessageId: 'w',
    });
    expect(subject).toBe('jade-a');
  });

  it('replays 20:09 and 20:18 IST with the bot messages in the thread', () => {
    const base: [string, string, string, string?][] = [
      ['2026-10-07T11:21:31Z', 'agent', JP_NAGAR_4TH.title as string],
      ['2026-10-07T14:38:44Z', 'customer', ENQUIRY_AKSHAY],
      [
        '2026-10-07T14:38:55Z',
        'bot',
        `Thanks shirish! Your enquiry for *${AKSHAY_NAGAR.title}* has reached our team.`,
      ],
    ];
    expect(
      decideSubject({
        messages: thread([
          ...base,
          ['2026-10-07T14:38:51Z', 'customer', 'Is this available? 👆🏻', 'q1'],
        ]),
        shares: [{ propertyId: 'prop-1004', at: '2026-10-07T11:21:32Z' }],
        candidates: LISTINGS,
        currentMessageId: 'q1',
      })
    ).toBe('prop-1110');

    expect(
      decideSubject({
        messages: thread([
          ...base,
          ['2026-10-07T14:40:05Z', 'customer', ENQUIRY_HOSUR],
          [
            '2026-10-07T14:40:35Z',
            'bot',
            `Showcase image for ${AKSHAY_NAGAR.title}`,
          ],
          [
            '2026-10-07T14:40:45Z',
            'bot',
            `Showcase image for ${HOSUR_ROAD.title}`,
          ],
          ['2026-10-07T14:41:24Z', 'customer', 'Interested in 1'],
          [
            '2026-10-07T14:41:30Z',
            'bot',
            `Great choice 👌 I've flagged your interest in *${HOSUR_ROAD.title}*`,
          ],
          ['2026-10-07T14:47:45Z', 'customer', 'What about this ?'],
          [
            '2026-10-07T14:48:33Z',
            'customer',
            'Is it available for sale ?',
            'q3',
          ],
        ]),
        shares: [
          { propertyId: 'prop-1081', at: '2026-10-07T14:40:46Z' },
          { propertyId: 'prop-1110', at: '2026-10-07T14:40:37Z' },
          { propertyId: 'prop-1004', at: '2026-10-07T11:21:32Z' },
        ],
        candidates: LISTINGS,
        currentMessageId: 'q3',
      })
    ).toBe('prop-1081');
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

describe('[INB-034] shareBurst', () => {
  const at = (iso: string, propertyId: string) => ({
    propertyId,
    at: Date.parse(iso),
  });

  it('treats two cards sent seconds apart as one batch, newest first', () => {
    expect(
      shareBurst([
        at('2026-10-07T15:02:34Z', 'prop-2080'),
        at('2026-10-07T15:01:46Z', 'prop-1784'),
        at('2026-10-07T14:40:46Z', 'prop-1081'),
      ])
    ).toEqual(['prop-2080', 'prop-1784']);
  });

  it('keeps only the latest card when the earlier ones are old news', () => {
    expect(
      shareBurst([
        at('2026-10-07T15:02:34Z', 'prop-2080'),
        at('2026-10-07T14:40:46Z', 'prop-1081'),
      ])
    ).toEqual(['prop-2080']);
  });

  it('ends a batch where the buyer spoke between two cards', () => {
    expect(
      shareBurst(
        [
          at('2026-10-07T15:02:34Z', 'prop-2080'),
          at('2026-10-07T15:01:46Z', 'prop-1784'),
        ],
        [Date.parse('2026-10-07T15:02:00Z')]
      )
    ).toEqual(['prop-2080']);
  });

  it('caps a batch at the subjects one reply is answered about', () => {
    expect(
      shareBurst([
        at('2026-10-07T15:02:40Z', 'a'),
        at('2026-10-07T15:02:30Z', 'b'),
        at('2026-10-07T15:02:20Z', 'c'),
        at('2026-10-07T15:02:10Z', 'd'),
      ])
    ).toEqual(['a', 'b', 'c']);
    expect(shareBurst([])).toEqual([]);
  });
});

describe('[INB-034] decideSubjects answers a question after two cards for both', () => {
  const burst = () => ({
    messages: thread([
      ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
      ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
      [
        '2026-10-07T15:20:00Z',
        'customer',
        'Can u share the exact location?',
        'wamid.q2',
      ],
    ]),
    shares: [
      { propertyId: 'prop-2080', at: '2026-10-07T15:02:34Z' },
      { propertyId: 'prop-1784', at: '2026-10-07T15:01:46Z' },
    ],
    candidates: LISTINGS,
    currentMessageId: 'wamid.q2',
  });

  it('returns the whole burst, newest first, where the single reading hands over', () => {
    expect(decideSubject(burst())).toBeNull();
    expect(decideSubjects(burst())).toEqual(['prop-2080', 'prop-1784']);
  });

  it('follows a quote to the one listing it shared', () => {
    expect(
      decideSubjects({ ...burst(), quotedText: SHARE_CHIKATOGUR })
    ).toEqual(['prop-1784']);
  });

  it('still refuses a quote naming several listings', () => {
    expect(
      decideSubjects({
        ...burst(),
        quotedText: `${SHARE_CHIKATOGUR}\n${SHARE_JP_8TH}`,
      })
    ).toEqual([]);
  });

  it('still follows the agent to a single listing they pitched', () => {
    const args = burst();
    args.messages = thread([
      ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
      ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
      ['2026-10-07T15:10:00Z', 'agent', 'Have some inventories in Oval Reef'],
      ['2026-10-07T15:20:00Z', 'customer', 'Is it gated?', 'wamid.q2'],
    ]);
    args.candidates = [...LISTINGS, { ...OVAL_REEF, status: 'Available' }];
    expect(decideSubjects(args)).toEqual(['prop-oval']);
  });

  it('is the latest share alone when the buyer replied between the two cards', () => {
    const args = burst();
    args.messages = thread([
      ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
      ['2026-10-07T15:02:00Z', 'customer', 'okay', 'wamid.ok'],
      ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
      [
        '2026-10-07T15:20:00Z',
        'customer',
        'Can u share the exact location?',
        'wamid.q2',
      ],
    ]);
    expect(decideSubjects(args)).toEqual(['prop-2080']);
  });

  it('holds the batch through a bare question or remark from the buyer', () => {
    // 7 October: "Is this available?" then "Can u share the exact
    // location?" were both about the same two cards.
    const args = burst();
    args.messages = thread([
      ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
      ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
      ['2026-10-07T15:05:00Z', 'customer', 'ok', 'wamid.ok'],
      ['2026-10-07T15:20:00Z', 'customer', 'Is this available?', 'wamid.q1'],
      [
        '2026-10-07T15:20:26Z',
        'customer',
        'Can u share the exact location?',
        'wamid.q2',
      ],
    ]);
    expect(decideSubjects(args)).toEqual(['prop-2080', 'prop-1784']);
    expect(decideSubject(args)).toBeNull();
  });

  it('follows the card the buyer numbered or described, not the one sent last', () => {
    const after = (settled: string) => {
      const args = burst();
      args.messages = thread([
        ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
        ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
        ['2026-10-07T15:05:00Z', 'customer', settled, 'wamid.ok'],
        ['2026-10-07T15:20:00Z', 'customer', 'Is this available?', 'wamid.q2'],
      ]);
      return decideSubjects(args);
    };
    expect(after('option 2')).toEqual(['prop-2080']);
    expect(after('No this 5,760 sqft one')).toEqual(['prop-2080']);
    expect(after('option 1')).toEqual(['prop-1784']);
    expect(after('the first one')).toEqual(['prop-1784']);
    expect(after('No this 40,000 sqft one')).toEqual(['prop-1784']);
  });

  it('holds the batch when a description fits none of the cards or a number points outside it', () => {
    for (const unsettled of ['No this 9000 sqft one', 'option 3']) {
      const args = burst();
      args.messages = thread([
        ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
        ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
        ['2026-10-07T15:05:00Z', 'customer', unsettled, 'wamid.ok'],
        ['2026-10-07T15:20:00Z', 'customer', 'Is this available?', 'wamid.q2'],
      ]);
      expect(decideSubjects(args)).toEqual(['prop-2080', 'prop-1784']);
    }
  });

  it('refuses when the buyer numbered two cards and then asks about "it"', () => {
    const args = burst();
    args.messages = thread([
      ['2026-10-07T15:01:45Z', 'agent', SHARE_CHIKATOGUR],
      ['2026-10-07T15:02:34Z', 'agent', SHARE_JP_8TH],
      ['2026-10-07T15:05:00Z', 'customer', 'options 1 and 2', 'wamid.ok'],
      ['2026-10-07T15:20:00Z', 'customer', 'Is it gated?', 'wamid.q2'],
    ]);
    expect(decideSubjects(args)).toEqual([]);
  });

  it('is empty when nothing was ever shared', () => {
    expect(
      decideSubjects({ messages: [], shares: [], candidates: LISTINGS })
    ).toEqual([]);
  });
});

describe('[INB-034] resolveSubjectProperties reads the burst from the thread', () => {
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
        content_text: 'Can u share the exact location?',
        message_id: 'wamid.q2',
        created_at: '2026-10-07T15:20:00Z',
      },
    ],
  });

  it('gives the Q&A both cards where the single reading hands over', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    await expect(
      resolvePropertySubject(db, 'acc', 'c1', 'conv', { messageId: 'wamid.q2' })
    ).resolves.toBeNull();
    await expect(
      resolveSubjectProperties(db, 'acc', 'c1', 'conv', {
        messageId: 'wamid.q2',
      })
    ).resolves.toEqual(['prop-2080', 'prop-1784']);
  });

  it('carries the burst through the lead Q&A subject lookup', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    const subjects = await questionSubjectProperties(
      db,
      'acc',
      'c1',
      'conv',
      'Can u share the exact location?',
      { messageId: 'wamid.q2' }
    );
    expect(subjects.map((subject) => subject.id)).toEqual([
      'prop-2080',
      'prop-1784',
    ]);
  });

  it('lets a quoted share beat a description that fits another card', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    const subjects = await questionSubjectProperties(
      db,
      'acc',
      'c1',
      'conv',
      'is the 5,760 sqft one still available?',
      { messageId: 'wamid.q2', quotedMessageId: 'wamid.share1784' }
    );
    expect(subjects.map((subject) => subject.id)).toEqual(['prop-1784']);
  });

  it('reads the described card from the thread when its ledger row is old', async () => {
    const data = tables();
    data.property_shares = [
      {
        account_id: 'acc',
        contact_id: 'c1',
        property_id: 'prop-1784',
        created_at: '2026-09-01T09:00:00Z',
      },
      ...(
        [
          ['prop-1004', '2026-10-07T13:00:00Z'],
          ['prop-1110', '2026-10-07T13:30:00Z'],
          ['prop-1081', '2026-10-07T14:00:00Z'],
          ['prop-2080', '2026-10-07T15:02:34Z'],
        ] as const
      ).map(([property_id, created_at]) => ({
        account_id: 'acc',
        contact_id: 'c1',
        property_id,
        created_at,
      })),
    ];
    data.properties = data.properties.map((row) =>
      row.id === 'prop-1784'
        ? { ...row, land_area: '40000', land_area_unit: 'Sq.Ft.' }
        : row
    );
    const db = memorySupabase(data) as unknown as SupabaseClient;
    const subjects = await questionSubjectProperties(
      db,
      'acc',
      'c1',
      'conv',
      'No this 40,000 sqft one',
      { messageId: 'wamid.q2' }
    );
    expect(subjects.map((subject) => subject.id)).toEqual(['prop-1784']);
  });

  it('is the latest share alone when there is no thread to read', async () => {
    const db = memorySupabase(tables()) as unknown as SupabaseClient;
    await expect(resolveSubjectProperties(db, 'acc', 'c1')).resolves.toEqual([
      'prop-2080',
    ]);
    await expect(
      resolveSubjectProperties(
        memorySupabase({
          properties: [],
          property_shares: [],
          messages: [],
        }) as unknown as SupabaseClient,
        'acc',
        'c1',
        'conv'
      )
    ).resolves.toEqual([]);
  });
});
