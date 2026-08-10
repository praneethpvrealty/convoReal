import { describe, expect, it, vi } from 'vitest';
import { CHUNKS, chunkVersion } from './chunks';
import {
  TOP_K,
  anchorChunkFor,
  chunkRefs,
  cosineSimilarity,
  lexicalScore,
  selectChunks,
} from './retrieval';

describe('anchorChunkFor', () => {
  it('resolves a route and its subpaths to the page chunk', () => {
    expect(anchorChunkFor('/broadcasts')?.id).toBe('broadcasts.overview');
    expect(anchorChunkFor('/broadcasts/new')?.id).toBe('broadcasts.overview');
    expect(anchorChunkFor('/contacts/import')?.id).toBe('contacts.overview');
  });

  it('returns null off the dashboard', () => {
    expect(anchorChunkFor('/nowhere')).toBeNull();
    expect(anchorChunkFor('/')).toBeNull();
  });

  it('does not treat a shared prefix as a match', () => {
    expect(anchorChunkFor('/inboxx')).toBeNull();
  });
});

describe('lexicalScore', () => {
  const inbox = CHUNKS.find((c) => c.id === 'inbox.overview')!;

  it('scores title/keyword hits above body-only hits', () => {
    const strong = lexicalScore('whatsapp conversations', inbox);
    const weak = lexicalScore('approved template', inbox);
    expect(strong).toBeGreaterThan(weak);
    expect(weak).toBeGreaterThan(0);
  });

  it('returns 0 with no overlap or an empty question', () => {
    expect(lexicalScore('quarterly tax filing', inbox)).toBe(0);
    expect(lexicalScore('', inbox)).toBe(0);
    expect(lexicalScore('the is a of', inbox)).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('handles identical, orthogonal, and degenerate inputs', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
  });
});

describe('selectChunks (lexical path — empty index)', () => {
  it('always includes the current page anchor first', () => {
    const picked = selectChunks({
      pathname: '/inventory',
      message: 'how do I send a broadcast?',
      embedding: null,
    });
    expect(picked[0]?.id).toBe('inventory.overview');
  });

  it('caps at anchor + TOP_K and drops zero-score chunks', () => {
    const picked = selectChunks({
      pathname: '/dashboard',
      message: 'property',
      embedding: null,
    });
    expect(picked.length).toBeLessThanOrEqual(TOP_K + 1);
    const noise = selectChunks({
      pathname: '/nowhere',
      message: 'zzzz qqqq',
      embedding: null,
    });
    expect(noise).toEqual([]);
  });

  const GOLDEN: { question: string; expects: string }[] = [
    {
      question: 'how do I make a video for my listing?',
      expects: 'howto.listing-video',
    },
    {
      question: 'can I improve dull property photos?',
      expects: 'howto.enhance-photos',
    },
    {
      question: 'leads from magicbricks are not coming in',
      expects: 'leads.email-sync',
    },
    { question: 'how do I buy more credits?', expects: 'howto.topup-credits' },
    {
      question: 'can I send an sms campaign to everyone?',
      expects: 'limit.no-sms-email-campaigns',
    },
    {
      question: 'delete a message I already sent',
      expects: 'limit.edit-sent-message',
    },
    {
      question: 'why is my template stuck as marketing category',
      expects: 'limit.template-category',
    },
    {
      question: 'kaise dekhu who viewed my property links',
      expects: 'pulse.overview',
    },
    {
      question: 'invite a teammate and set their permissions',
      expects: 'team.roles',
    },
    {
      question: 'what is a deal room in the owner portfolio?',
      expects: 'portfolio.owner',
    },
    {
      question: 'group my apartment units into one project',
      expects: 'inventory.projects',
    },
    {
      question: 'customer said close my enquiry, what happens?',
      expects: 'contacts.lifecycle',
    },
  ];

  for (const { question, expects } of GOLDEN) {
    it(`retrieves ${expects} for "${question}"`, () => {
      const picked = selectChunks({
        pathname: '/dashboard',
        message: question,
        embedding: null,
      });
      expect(picked.map((c) => c.id)).toContain(expects);
    });
  }
});

describe('selectChunks (semantic path — stubbed index)', () => {
  it('ranks by cosine when the index covers the corpus', async () => {
    vi.resetModules();
    const target = CHUNKS.find((c) => c.id === 'pipelines.overview')!;
    const axis = (i: number) => {
      const v = new Array(768).fill(0);
      v[i] = 1;
      return v;
    };
    vi.doMock('./knowledge-index.gen', () => ({
      KNOWLEDGE_INDEX: Object.fromEntries(
        CHUNKS.map((c, i) => [
          c.id,
          {
            v: chunkVersion(c),
            embedding: axis(c.id === target.id ? 0 : i + 1),
          },
        ])
      ),
    }));
    const fresh = await import('./retrieval');
    const picked = fresh.selectChunks({
      pathname: '/inbox',
      message: 'unrelated words entirely',
      embedding: axis(0),
    });
    expect(picked[0]?.id).toBe('inbox.overview');
    expect(picked[1]?.id).toBe(target.id);
    vi.doUnmock('./knowledge-index.gen');
    vi.resetModules();
  });

  it('falls back to lexical for chunks with stale index entries', async () => {
    vi.resetModules();
    vi.doMock('./knowledge-index.gen', () => ({
      KNOWLEDGE_INDEX: Object.fromEntries(
        CHUNKS.map((c) => [
          c.id,
          { v: 'stale000', embedding: new Array(768).fill(1) },
        ])
      ),
    }));
    const fresh = await import('./retrieval');
    const picked = fresh.selectChunks({
      pathname: '/dashboard',
      message: 'how do I buy more credits?',
      embedding: new Array(768).fill(1),
    });
    expect(picked.map((c) => c.id)).toContain('howto.topup-credits');
    vi.doUnmock('./knowledge-index.gen');
    vi.resetModules();
  });
});

describe('chunkRefs', () => {
  it('pairs each chunk with its current version', () => {
    const chunk = CHUNKS[0];
    expect(chunkRefs([chunk])).toEqual([
      { id: chunk.id, v: chunkVersion(chunk) },
    ]);
  });
});
