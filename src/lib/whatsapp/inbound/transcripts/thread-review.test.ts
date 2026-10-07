import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';

vi.mock('@/lib/ai/gemini', () => ({
  generateJson: vi.fn(
    async () => '{"score": 90, "summary": "fine", "issues": []}'
  ),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db }));

import {
  buildJudgePrompt,
  decideVerdict,
  parseJudgeReply,
  runBotThreadReview,
} from './thread-review';
import { fixtureFromReview } from './fixture-export';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let db: ReturnType<typeof memorySupabase>;

const NOW = new Date('2026-10-07T23:30:00Z');
const at = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function seed() {
  tables = {
    conversations: [
      { id: 'conv-1', account_id: 'acc-1', contact_id: 'c-1' },
      { id: 'conv-old', account_id: 'acc-1', contact_id: 'c-2' },
    ],
    contacts: [
      { id: 'c-1', created_at: at(60) },
      { id: 'c-2', created_at: '2026-01-01T00:00:00Z' },
    ],
    messages: [
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'template',
        template_name: 'lead_welcome_utility',
        content_text:
          'Hi Sunil, thanks for your interest. Kindly let me know your requirements and budget, I will share the appropriate properties.',
        created_at: at(59),
      },
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'template',
        template_name: 'listing_status_notice',
        content_text: 'The listing you enquired about is no longer available.',
        created_at: at(58),
      },
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'customer',
        private: false,
        content_type: 'text',
        content_text: '🔘 Button: "Show Properties"',
        created_at: at(57),
      },
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'text',
        content_text:
          "Great to hear from you, Sunil 👍 You're back on our radar. Call me on +91 99860 54104 or write to sunil@example.com.",
        created_at: at(56),
      },
      // A staff note the lead never saw.
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: true,
        content_type: 'text',
        content_text: 'Internal: location request raised for Sunil.',
        created_at: at(55),
      },
      // Older than the lookback: not reviewed tonight.
      {
        conversation_id: 'conv-old',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'text',
        content_text: 'Here it is: https://x/?property_id=p1',
        created_at: at(60 * 30),
      },
    ],
    bot_thread_reviews: [],
  };
  db = memorySupabase(tables);
}

describe('[CNV-006] runBotThreadReview', () => {
  beforeEach(seed);

  it('reads each thread the bot wrote in, records the rule violations and the judge verdict once', async () => {
    const judge = vi.fn<(prompt: string, system: string) => Promise<string>>(
      async () =>
        '```json\n{"score": 40, "summary": "Contradicts itself.", "issues": [{"kind": "contradiction", "message_index": 1, "note": "Promised then withdrew."}]}\n```'
    );

    const result = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge,
    });

    expect(result).toEqual({
      threads: 1,
      reviewed: 1,
      skipped: 0,
      failed: 0,
      verdicts: { pass: 0, fail: 1, unscored: 0 },
      budgetExhausted: false,
    });
    const [row] = tables.bot_thread_reviews;
    expect(row.account_id).toBe('acc-1');
    expect(row.conversation_id).toBe('conv-1');
    expect(row.contact_id).toBe('c-1');
    expect(row.review_day).toBe('2026-10-08');
    expect(row.verdict).toBe('fail');
    expect(row.score).toBe(40);
    expect(row.summary).toBe('Contradicts itself.');
    expect(
      (row.rule_violations as Array<{ rule: string }>).map((v) => v.rule)
    ).toEqual(
      expect.arrayContaining([
        'contradictory-arrival',
        'returning-copy-for-new-lead',
        'promise-without-listing',
      ])
    );
    expect(row.issues).toEqual([
      {
        kind: 'contradiction',
        message_index: 1,
        note: 'Promised then withdrew.',
      },
    ]);

    // The judge reads the thread with the lead's number and email masked,
    // and never sees a private staff note.
    const prompt = judge.mock.calls[0][0] as string;
    expect(prompt).not.toContain('Internal: location request');
    expect((row.transcript as unknown[]).length).toBe(4);
    expect(prompt).toContain('[0] BOT (template)');
    expect(prompt).toContain('[number]');
    expect(prompt).toContain('[email]');
    expect(prompt).not.toContain('99860');
    expect(prompt).not.toContain('sunil@example.com');

    // A rerun the same night costs nothing.
    const again = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge,
    });
    expect(again.threads).toBe(0);
    expect(again.reviewed).toBe(0);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(tables.bot_thread_reviews).toHaveLength(1);
  });

  it('keeps the rules verdict when the judge fails, and reports unscored only when the rules pass', async () => {
    const failing = vi.fn(async () => {
      throw new Error('model down');
    });
    await runBotThreadReview({ db: db as never, now: NOW, judge: failing });
    expect(tables.bot_thread_reviews[0].verdict).toBe('fail');
    expect(tables.bot_thread_reviews[0].score).toBeNull();

    tables.bot_thread_reviews = [];
    tables.messages = [
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'customer',
        private: false,
        content_type: 'text',
        content_text: 'any plots in JP Nagar?',
        created_at: at(10),
      },
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'text',
        content_text: 'Here is one: https://x/?property_id=p1&v=c',
        created_at: at(9),
      },
    ];
    await runBotThreadReview({ db: db as never, now: NOW, judge: failing });
    expect(tables.bot_thread_reviews[0].verdict).toBe('unscored');
  });
});

describe('[CNV-006] collection', () => {
  beforeEach(seed);

  it('keeps the newest messages of a long thread, in reading order', async () => {
    tables.messages = Array.from({ length: 70 }, (_, i) => ({
      conversation_id: 'conv-1',
      account_id: 'acc-1',
      sender_type: 'customer',
      private: false,
      content_type: 'text',
      content_text: `message ${i}`,
      created_at: at(200 - i),
    }));
    tables.messages.push({
      conversation_id: 'conv-1',
      account_id: 'acc-1',
      sender_type: 'bot',
      private: false,
      content_type: 'text',
      content_text: 'Here it is: https://x/?property_id=p1&v=c',
      created_at: at(5),
    });

    const judge = vi.fn<(prompt: string, system: string) => Promise<string>>(
      async () => '{"score": 90, "issues": []}'
    );
    const result = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge,
    });

    expect(result.reviewed).toBe(1);
    const transcript = tables.bot_thread_reviews[0].transcript as Array<{
      text: string;
    }>;
    expect(transcript).toHaveLength(60);
    expect(transcript[0].text).toBe('message 11');
    expect(transcript[59].text).toContain('Here it is');
  });

  it('ignores a thread whose only bot activity is a private note', async () => {
    tables.messages = [
      {
        conversation_id: 'conv-1',
        account_id: 'acc-1',
        sender_type: 'bot',
        private: true,
        content_type: 'text',
        content_text: 'Internal note',
        created_at: at(5),
      },
    ];
    const result = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge: async () => '{"score": 90, "issues": []}',
    });
    expect(result).toMatchObject({ threads: 0, reviewed: 0 });
  });

  it('pages past the cap and past threads already reviewed tonight', async () => {
    tables.conversations = ['a', 'b', 'c', 'd'].map((id) => ({
      id: `conv-${id}`,
      account_id: 'acc-1',
      contact_id: null,
    }));
    tables.messages = ['a', 'b', 'c', 'd'].flatMap((id, i) =>
      Array.from({ length: 3 }, (_, j) => ({
        conversation_id: `conv-${id}`,
        account_id: 'acc-1',
        sender_type: 'bot',
        private: false,
        content_type: 'text',
        content_text: `https://x/?v=${id}${j}`,
        created_at: at(10 + i * 10 + j),
      }))
    );
    tables.bot_thread_reviews = [
      { conversation_id: 'conv-a', review_day: '2026-10-08', verdict: 'pass' },
    ];

    const judge = async () => '{"score": 90, "issues": []}';
    // Batches of two, pages of two: one run still covers the window.
    const first = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge,
      limit: 2,
      pageSize: 2,
    });
    expect(first).toMatchObject({
      threads: 3,
      reviewed: 3,
      budgetExhausted: false,
    });
    expect(
      tables.bot_thread_reviews.map((r) => r.conversation_id).sort()
    ).toEqual(['conv-a', 'conv-b', 'conv-c', 'conv-d']);

    const second = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge,
      limit: 2,
      pageSize: 2,
    });
    expect(second).toMatchObject({ threads: 0, reviewed: 0 });
  });

  it('stops at the time budget and says so', async () => {
    const result = await runBotThreadReview({
      db: db as never,
      now: NOW,
      judge: async () => '{"score": 90, "issues": []}',
      budgetMs: 0,
    });
    expect(result).toMatchObject({
      threads: 0,
      reviewed: 0,
      budgetExhausted: true,
    });
  });

  it('claims the row before judging, so an overlapping run never judges the same thread', async () => {
    const judge = vi.fn<(prompt: string, system: string) => Promise<string>>(
      async () => '{"score": 90, "issues": []}'
    );
    const raced = {
      ...db,
      from(table: string) {
        const builder = db.from(table);
        if (table !== 'bot_thread_reviews') return builder;
        return {
          ...builder,
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23505', message: 'duplicate key' },
              }),
            }),
          }),
        };
      },
    };

    const result = await runBotThreadReview({
      db: raced as never,
      now: NOW,
      judge,
    });

    expect(result).toMatchObject({ threads: 1, reviewed: 0, skipped: 1 });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe('[CNV-006] judge plumbing', () => {
  it('parses a fenced reply, clamps the score and bounds the issues', () => {
    expect(
      parseJudgeReply(
        '```json\n{"score": 140, "issues": [{"kind": "tone", "note": "x"}, "junk"]}\n```'
      )
    ).toEqual({
      score: 100,
      summary: null,
      issues: [{ kind: 'tone', message_index: null, note: 'x' }],
    });
    expect(parseJudgeReply('not json')).toEqual({
      score: null,
      summary: null,
      issues: [],
    });
  });

  it('fails on any rule violation, passes at 70 and above, and is unscored without a score', () => {
    const violation = { rule: 'self-praise' as const, index: 0, note: '' };
    expect(decideVerdict([violation], 95)).toBe('fail');
    expect(decideVerdict([], 69)).toBe('fail');
    expect(decideVerdict([], 70)).toBe('pass');
    expect(decideVerdict([], null)).toBe('unscored');
  });

  it('numbers every bubble so the judge can point at one', () => {
    const prompt = buildJudgePrompt(
      [
        { sender: 'customer', kind: 'text', text: 'hi' },
        { sender: 'bot', kind: 'interactive', text: 'Pick one' },
      ],
      { contactCreatedAt: null, now: NOW.toISOString() }
    );
    expect(prompt).toContain('[0] CUSTOMER:\nhi');
    expect(prompt).toContain('[1] BOT (interactive):\nPick one');
  });
});

describe('[CNV-006] fixtureFromReview', () => {
  it('turns a reviewed thread into a fixture the rules must keep failing', () => {
    const fixture = JSON.parse(
      fixtureFromReview({
        review_day: '2026-10-08',
        conversation_id: 'conv-12345678-rest',
        transcript: [
          {
            sender: 'bot',
            kind: 'template',
            templateName: 'x',
            text: 'Call +91 99860 54104',
            at: '2026-10-07T10:00:00Z',
          },
          { sender: 'customer', kind: 'text', text: 'ok' },
        ],
        rule_violations: [
          { rule: 'self-praise' },
          { rule: 'self-praise' },
          { rule: 'bot-burst' },
        ],
        contacts: { created_at: '2026-10-07T09:00:00Z' },
      })
    );
    expect(fixture.id).toBe('2026-10-08-conv-123');
    expect(fixture.context).toEqual({
      contactCreatedAt: '2026-10-07T09:00:00Z',
      maxBotBubblesPerTurn: 2,
    });
    expect(fixture.expectedViolations).toEqual(['self-praise', 'bot-burst']);
    expect(fixture.transcript[0]).toEqual({
      sender: 'bot',
      kind: 'template',
      templateName: 'x',
      at: '2026-10-07T10:00:00Z',
      text: 'Call [number]',
    });
  });
});
