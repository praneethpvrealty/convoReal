import { describe, it, expect } from 'vitest';

import {
  resolveCopyDrift,
  hasCopyUpdate,
  shippedCopy,
  type DriftableRow,
} from './template-drift';
import {
  copyRevision,
  revisionOf,
  templateBody,
  templateFooter,
} from './template-copy';

const KEY = 'property_alert' as const;
const LANG = 'kn' as const;

/** A row as the create path writes it: shipped copy, stamped. */
function freshRow(): DriftableRow {
  return {
    body_text: templateBody(KEY, LANG),
    footer_text: templateFooter(KEY, LANG) ?? null,
    copy_revision: copyRevision(KEY, LANG),
  };
}

describe('resolveCopyDrift', () => {
  it('is in sync for a row created from the current shipped copy', () => {
    expect(resolveCopyDrift(freshRow(), KEY, LANG)).toBe('in_sync');
  });

  // Their words. Never overwrite these — the whole point of the
  // account-level edit added alongside the review gate.
  it('reports customised when the account reworded it', () => {
    const row = { ...freshRow(), body_text: 'ಬೇರೆ ಪದಗಳು {{1}} {{2}} {{3}} {{4}} {{5}} ಇಲ್ಲಿ' };
    expect(resolveCopyDrift(row, KEY, LANG)).toBe('customised');
  });

  // Untouched by them, but we improved the wording. This is the case
  // the whole column exists to make visible: without it, a native
  // speaker's correction reaches template-copy.ts and stops there.
  it('reports an update when shipped copy moved and they never touched it', () => {
    // The row still holds the wording it was created from — an older
    // shipped revision — and its stamp says so. Nothing about it is
    // the account's own, so today's better wording is safe to offer.
    const old = {
      body_text: 'ಹಳೆಯ ಪಠ್ಯ {{1}} ಮತ್ತು {{2}} ಜೊತೆ {{3}} ಹಾಗೂ {{4}} ಕೊನೆಗೆ {{5}} ಇದೆ',
      footer_text: null,
    };
    const stamped: DriftableRow = {
      ...old,
      copy_revision: revisionOf(old.body_text, old.footer_text),
    };
    expect(resolveCopyDrift(stamped, KEY, LANG)).toBe('update_available');
  });

  it('reports both when they reworded it AND shipped copy moved', () => {
    const row: DriftableRow = {
      body_text: 'ಅವರ ಸ್ವಂತ ಪದಗಳು {{1}} {{2}} {{3}} {{4}} {{5}} ಕೊನೆ',
      footer_text: null,
      // Stamped from some older shipped revision, and edited since.
      copy_revision: 'a1b2c3d4',
    };
    expect(resolveCopyDrift(row, KEY, LANG)).toBe('customised_and_outdated');
  });

  // Rows predating migration 252 cannot answer "did they edit it?", so
  // the safe reading is the one that never overwrites on a guess.
  it('treats an unstamped divergent row as customised, not updatable', () => {
    const row: DriftableRow = {
      body_text: 'ಯಾವುದೋ ಪಠ್ಯ {{1}} {{2}} {{3}} {{4}} {{5}} ಕೊನೆ',
      footer_text: null,
      copy_revision: null,
    };
    expect(resolveCopyDrift(row, KEY, LANG)).toBe('customised');
    expect(hasCopyUpdate(resolveCopyDrift(row, KEY, LANG))).toBe(false);
  });

  it('an unstamped row that matches shipped copy is still in sync', () => {
    const row: DriftableRow = {
      body_text: templateBody(KEY, LANG),
      footer_text: templateFooter(KEY, LANG) ?? null,
      copy_revision: null,
    };
    expect(resolveCopyDrift(row, KEY, LANG)).toBe('in_sync');
  });

  // A footer-only change is still copy a client reads.
  it('notices a footer-only difference', () => {
    const row = { ...freshRow(), footer_text: 'ಬೇರೆ ಅಡಿಟಿಪ್ಪಣಿ' };
    expect(resolveCopyDrift(row, KEY, LANG)).toBe('customised');
  });

  it('scopes the comparison to the language', () => {
    // Kannada copy stamped as Kannada is in sync; the same row read as
    // Hindi is not, because Hindi ships different words.
    expect(resolveCopyDrift(freshRow(), KEY, 'hi')).not.toBe('in_sync');
  });
});

describe('hasCopyUpdate', () => {
  it('is true only where newer wording exists to take', () => {
    expect(hasCopyUpdate('update_available')).toBe(true);
    expect(hasCopyUpdate('customised_and_outdated')).toBe(true);
    expect(hasCopyUpdate('in_sync')).toBe(false);
    expect(hasCopyUpdate('customised')).toBe(false);
  });
});

describe('shippedCopy', () => {
  it('returns what an adopt would write', () => {
    expect(shippedCopy(KEY, LANG)).toEqual({
      body_text: templateBody(KEY, LANG),
      footer_text: templateFooter(KEY, LANG) ?? null,
    });
  });
});

