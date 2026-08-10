import { describe, expect, it } from 'vitest';
import { CHUNKS } from './chunks';
import {
  buildCopilotScaffold,
  buildCopilotSystemPrompt,
  isAllowedRoute,
} from './knowledge';
import { TOP_K, selectChunks } from './retrieval';
import { TOURS } from './tours';

describe('copilot prompt scaffold', () => {
  it('lists every page chunk in the directory and allowlist', () => {
    const scaffold = buildCopilotScaffold('/contacts');
    for (const chunk of CHUNKS.filter((c) => c.kind === 'page')) {
      expect(scaffold).toContain(`${chunk.route} — ${chunk.title}`);
      expect(isAllowedRoute(chunk.route!)).toBe(true);
    }
  });

  it('allowlists only page-chunk routes', () => {
    expect(isAllowedRoute('/contacts')).toBe(true);
    expect(isAllowedRoute('https://evil.example')).toBe(false);
    expect(isAllowedRoute('/admin')).toBe(false);
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
    // theoretical worst assembly: anchor + the TOP_K longest chunks.
    const longest = [...CHUNKS]
      .sort((a, b) => b.body.length - a.body.length)
      .slice(0, TOP_K + 1);
    const prompt = buildCopilotSystemPrompt('/dashboard', longest);
    expect(prompt.length).toBeLessThan(12_000);
  });
});
