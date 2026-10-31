import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearComposerDrafts,
  composerDraft,
  saveComposerDraft,
} from './composer-drafts';
import { phoneHints } from './phone-hints';

describe('[UIX-009] composer drafts', () => {
  beforeEach(() => clearComposerDrafts());

  it('keeps a draft per conversation', () => {
    saveComposerDraft('c1', 'Site visit at 5?');
    saveComposerDraft('c2', 'Hello');
    expect(composerDraft('c1')).toBe('Site visit at 5?');
    expect(composerDraft('c2')).toBe('Hello');
    expect(composerDraft('c3')).toBe('');
  });

  it('forgets a draft once it is sent or emptied', () => {
    saveComposerDraft('c1', 'Hi');
    saveComposerDraft('c1', '   ');
    expect(composerDraft('c1')).toBe('');
  });

  it('forgets everything on sign-out', () => {
    saveComposerDraft('c1', 'Hi');
    clearComposerDrafts();
    expect(composerDraft('c1')).toBe('');
  });
});

describe('[UIX-009] phone hints', () => {
  it('keeps the Indian example for 91', () => {
    expect(phoneHints('91').international).toBe('+91 98765 43210');
    expect(phoneHints('91').quickAdd).toBe('Phone · e.g. 99002 77111');
  });

  it('names the account country code elsewhere', () => {
    const hints = phoneHints('971');
    expect(hints.international).toContain('+971');
    expect(hints.quickAdd).toContain('+971');
    expect(hints.invalid('12')).toContain('+971');
    expect(hints.international).not.toContain('98765');
  });
});
