import { describe, expect, it } from 'vitest';
import {
  botTurns,
  checkTranscript,
  transcriptFromMessages,
  type TranscriptMessage,
} from './transcript-rules';

const bot = (text: string, kind: TranscriptMessage['kind'] = 'text') =>
  ({ sender: 'bot', kind, text }) as TranscriptMessage;
const customer = (text: string) =>
  ({ sender: 'customer', kind: 'text', text }) as TranscriptMessage;
const rules = (
  transcript: TranscriptMessage[],
  createdAt = '2026-10-07T10:14:47Z'
) =>
  checkTranscript(transcript, { contactCreatedAt: createdAt }).map(
    (v) => v.rule
  );

describe('[CNV-005] transcript rules', () => {
  it('groups bot bubbles by the customer turn they answer', () => {
    expect(
      botTurns([
        bot('a'),
        bot('b'),
        customer('x'),
        customer('y'),
        bot('c'),
        bot('d'),
        bot('e'),
      ]).map((turn) => turn.indexes)
    ).toEqual([
      [0, 1],
      [4, 5, 6],
    ]);
  });

  it('limits bot bubbles per customer turn', () => {
    expect(rules([customer('hi'), bot('a'), bot('b')])).toEqual([]);
    expect(rules([customer('hi'), bot('a'), bot('b'), bot('c')])).toContain(
      'bot-burst'
    );
  });

  it('flags an arrival that promises listings and then withdraws the listing', () => {
    expect(
      rules([
        bot(
          'Kindly let me know your requirements and budget, I will share the appropriate properties.',
          'template'
        ),
        bot(
          'The listing you enquired about is no longer available.',
          'template'
        ),
      ])
    ).toContain('contradictory-arrival');
    expect(
      rules([
        bot(
          'The listing you enquired about is no longer available.',
          'template'
        ),
      ])
    ).toEqual([]);
  });

  it('flags saying the listing is unavailable twice', () => {
    expect(
      rules([
        bot(
          'The listing you enquired about is no longer available.',
          'template'
        ),
        customer('ok'),
        bot('*Plot* is no longer available. Browse: https://x/?v=c'),
      ])
    ).toContain('unavailable-repeated');
  });

  it('flags a free-form dead end with nowhere to browse, never a template', () => {
    expect(
      rules([
        customer('matches'),
        bot('Nothing live right now fits your requirement.'),
      ])
    ).toContain('dead-end-without-link');
    expect(
      rules([
        customer('matches'),
        bot(
          'Nothing live right now fits your requirement.\n\nBrowse every live listing any time: https://x/?v=c'
        ),
      ])
    ).toEqual([]);
    expect(
      rules([
        bot(
          'The listing you enquired about is no longer available.',
          'template'
        ),
      ])
    ).toEqual([]);
  });

  it('flags the bot praising its engine', () => {
    expect(
      rules([
        customer('hi'),
        bot('Our intelligent matching engine keeps watching. https://x'),
      ])
    ).toContain('self-praise');
  });

  it('flags welcoming back a lead who wrote for the first time this week', () => {
    const thread = [
      customer('hi'),
      bot("Great to hear from you 👍 You're back on our radar. https://x"),
    ];
    expect(rules(thread, '2026-10-07T10:14:47Z')).toContain(
      'returning-copy-for-new-lead'
    );
    expect(rules(thread, '2026-01-01T00:00:00Z')).toEqual([]);
  });

  it('flags a Show Properties tap answered without a listing or a link', () => {
    expect(
      rules([
        customer('🔘 Button: "Show Properties"'),
        bot('Reply with any change in budget, area or type.'),
      ])
    ).toContain('promise-without-listing');
    expect(
      rules([
        customer('🔘 Button: "Show Properties"'),
        bot('Here it is: https://x/?property_id=p1&v=c'),
      ])
    ).toEqual([]);
  });

  it('maps inbox rows onto the shape the rules read', () => {
    expect(
      transcriptFromMessages([
        { sender_type: 'customer', content_type: 'text', content_text: 'hi' },
        {
          sender_type: 'bot',
          content_type: 'template',
          content_text: 'T',
          template_name: 'x',
        },
        { sender_type: 'user', content_type: 'image', content_text: null },
      ])
    ).toEqual([
      {
        sender: 'customer',
        kind: 'text',
        text: 'hi',
        templateName: null,
        at: undefined,
      },
      {
        sender: 'bot',
        kind: 'template',
        text: 'T',
        templateName: 'x',
        at: undefined,
      },
      {
        sender: 'agent',
        kind: 'media',
        text: '',
        templateName: null,
        at: undefined,
      },
    ]);
  });
});
