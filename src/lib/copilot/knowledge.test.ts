import { describe, expect, it } from 'vitest';
import { CHUNKS, audienceOf, type Audience } from './chunks';
import {
  allowedRoutes,
  buildCopilotScaffold,
  buildCopilotSystemPrompt,
  isAllowedRoute,
} from './knowledge';
import { TOP_K, selectChunks } from './retrieval';
import { TOURS } from './tours';

const AUDIENCES: Audience[] = ['agent', 'owner', 'buyer'];

describe('copilot prompt scaffold', () => {
  it('lists every page chunk in the directory and allowlist', () => {
    for (const audience of AUDIENCES) {
      const scaffold = buildCopilotScaffold('/', audience);
      const pages = CHUNKS.filter(
        (c) => c.kind === 'page' && audienceOf(c) === audience
      );
      expect(pages.length, audience).toBeGreaterThan(0);
      for (const chunk of pages) {
        expect(scaffold).toContain(`${chunk.route} — ${chunk.title}`);
        expect(isAllowedRoute(chunk.route!, audience)).toBe(true);
      }
    }
  });

  it('allowlists only that audience’s page-chunk routes', () => {
    expect(isAllowedRoute('/contacts', 'agent')).toBe(true);
    expect(isAllowedRoute('https://evil.example', 'agent')).toBe(false);
    expect(isAllowedRoute('/admin', 'agent')).toBe(false);
    // A portal user can never be navigated into the staff Engine, and
    // an agent can never be sent into someone's Portfolio.
    expect(isAllowedRoute('/contacts', 'owner')).toBe(false);
    expect(isAllowedRoute('/den/bids', 'agent')).toBe(false);
    expect(isAllowedRoute('/den/bids', 'owner')).toBe(true);
    expect(isAllowedRoute('/buyer/matches', 'buyer')).toBe(true);
    expect(isAllowedRoute('/buyer/matches', 'owner')).toBe(false);
  });

  it('carries the rules, tours, current page, and output contract', () => {
    const scaffold = buildCopilotScaffold('/contacts');
    expect(scaffold).toContain('The user is on /contacts');
    for (const tour of TOURS) {
      expect(scaffold).toContain(tour.id);
    }
    expect(scaffold).toContain('"reply"');
    expect(scaffold).toContain('"unsupported"');
    expect(scaffold).toContain('Never say a feature is coming');
  });

  it('gives portals no tours and no tourId in the contract', () => {
    for (const audience of ['owner', 'buyer'] as const) {
      const scaffold = buildCopilotScaffold('/den', audience);
      expect(scaffold).not.toContain('GUIDED TOURS');
      expect(scaffold).not.toContain('tourId');
      expect(scaffold).toContain('Portfolio');
      expect(scaffold).toContain('"unsupported"');
    }
  });

  it('tells each portal audience who it is talking to', () => {
    expect(buildCopilotScaffold('/den', 'owner')).toContain('property OWNER');
    expect(buildCopilotScaffold('/buyer', 'buyer')).toContain('LOOKING TO BUY');
  });

  it('keeps the three scaffolds distinct — the cache partition key', () => {
    const scaffolds = AUDIENCES.map((a) => buildCopilotScaffold('/', a));
    expect(new Set(scaffolds).size).toBe(AUDIENCES.length);
  });

  it('never leaks another audience’s routes into the contract', () => {
    for (const audience of AUDIENCES) {
      const mine = new Set(allowedRoutes(audience));
      for (const other of AUDIENCES.filter((a) => a !== audience)) {
        for (const route of allowedRoutes(other)) {
          expect(mine.has(route), `${audience} exposes ${route}`).toBe(false);
        }
      }
    }
  });
});

describe('assembled system prompt', () => {
  it('contains exactly the selected chunks as knowledge', () => {
    const picked = selectChunks({
      pathname: '/inventory',
      message: 'how do I make a listing video?',
      embedding: null,
    });
    const prompt = buildCopilotSystemPrompt('/inventory', picked);
    for (const chunk of picked) {
      expect(prompt).toContain(chunk.body);
    }
    const omitted = CHUNKS.find((c) => !picked.includes(c))!;
    expect(prompt).not.toContain(omitted.body);
  });

  it('stays within the token budget at worst-case retrieval', () => {
    // The operator pays for every free-form question. Budget-test the
    // theoretical worst assembly per audience: anchor + the TOP_K
    // longest chunks that audience owns.
    for (const audience of AUDIENCES) {
      const longest = CHUNKS.filter((c) => audienceOf(c) === audience)
        .sort((a, b) => b.body.length - a.body.length)
        .slice(0, TOP_K + 1);
      const prompt = buildCopilotSystemPrompt('/', longest, audience);
      expect(prompt.length, audience).toBeLessThan(12_000);
    }
  });
});
