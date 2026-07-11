import { describe, expect, it } from 'vitest';
import {
  PAGE_KNOWLEDGE,
  buildCopilotSystemPrompt,
  isAllowedRoute,
  knowledgeForPath,
} from './knowledge';
import { TOURS } from './tours';

describe('copilot knowledge base', () => {
  it('covers every sidebar destination', () => {
    for (const route of [
      '/dashboard',
      '/contacts',
      '/inventory',
      '/calendar',
      '/inbox',
      '/automations',
      '/broadcasts',
      '/settings',
    ]) {
      expect(PAGE_KNOWLEDGE[route], route).toBeTruthy();
    }
  });

  it('resolves nested paths to their parent knowledge', () => {
    expect(knowledgeForPath('/broadcasts/new')).toBe(
      PAGE_KNOWLEDGE['/broadcasts'],
    );
    expect(knowledgeForPath('/nowhere')).toBeNull();
  });

  it('allowlists only known routes', () => {
    expect(isAllowedRoute('/contacts')).toBe(true);
    expect(isAllowedRoute('https://evil.example')).toBe(false);
    expect(isAllowedRoute('/admin')).toBe(false);
  });

  it('system prompt includes current page, tours, and output contract', () => {
    const prompt = buildCopilotSystemPrompt('/contacts');
    expect(prompt).toContain('The user is on /contacts');
    expect(prompt).toContain(PAGE_KNOWLEDGE['/contacts']);
    for (const tour of TOURS) {
      expect(prompt).toContain(tour.id);
    }
    expect(prompt).toContain('"reply"');
  });

  it('stays within the token budget', () => {
    // The operator pays for every free-form question — the whole
    // system prompt must stay ≈3K tokens (~12K chars).
    const prompt = buildCopilotSystemPrompt('/dashboard');
    expect(prompt.length).toBeLessThan(12_000);
  });
});
