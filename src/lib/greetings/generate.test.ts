import { describe, expect, it } from 'vitest';

import {
  GREETING_MESSAGE_MAX,
  buildGreetingPrompt,
  greetingImagePrompt,
  normalizeGreetingText,
} from './generate';

describe('buildGreetingPrompt', () => {
  it('names the occasion and the agency', () => {
    const prompt = buildGreetingPrompt({
      occasionLabel: 'Ganesh Chaturthi',
      agencyName: 'Skyline Realty',
    });
    expect(prompt).toContain('Ganesh Chaturthi');
    expect(prompt).toContain('Skyline Realty');
    expect(prompt).toContain('no line breaks');
  });

  it('defaults an unknown tone to warm', () => {
    const prompt = buildGreetingPrompt({
      occasionLabel: 'Diwali',
      agencyName: 'A',
      tone: 'sarcastic' as never,
    });
    expect(prompt).toContain('Write a warm greeting');
  });

  it('appends agency guidance only when given', () => {
    const withNotes = buildGreetingPrompt({
      occasionLabel: 'Diwali',
      agencyName: 'A',
      notes: 'mention our 10th anniversary',
    });
    expect(withNotes).toContain('mention our 10th anniversary');

    const without = buildGreetingPrompt({
      occasionLabel: 'Diwali',
      agencyName: 'A',
      notes: '   ',
    });
    expect(without).not.toContain('Extra guidance');
  });
});

describe('normalizeGreetingText', () => {
  it('collapses newlines into a single line', () => {
    expect(normalizeGreetingText('Happy\nDiwali!\n\nShine  bright.')).toBe(
      'Happy Diwali! Shine bright.'
    );
  });

  it('strips wrapping quotes', () => {
    expect(normalizeGreetingText('"Warm wishes to you."')).toBe(
      'Warm wishes to you.'
    );
    expect(normalizeGreetingText('“Warm wishes to you.”')).toBe(
      'Warm wishes to you.'
    );
  });

  it('caps the length', () => {
    const long = 'a'.repeat(GREETING_MESSAGE_MAX + 100);
    const result = normalizeGreetingText(long);
    expect(result.length).toBe(GREETING_MESSAGE_MAX);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('greetingImagePrompt', () => {
  it('matches known occasions case-insensitively', () => {
    expect(greetingImagePrompt('Happy Diwali')).toContain('Diwali');
    expect(greetingImagePrompt('ganesh chaturthi')).toContain('Ganesha');
    expect(greetingImagePrompt('EID AL-FITR')).toContain('Eid');
  });

  it('falls back to a generic festive card', () => {
    expect(greetingImagePrompt('Agency Anniversary')).toContain(
      'Agency Anniversary'
    );
  });
});
