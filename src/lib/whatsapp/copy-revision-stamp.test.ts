import { describe, it, expect } from 'vitest';

import { stampFor } from './copy-revision-stamp';
import { resolveCopyDrift } from './template-drift';
import {
  copyRevision,
  revisionOf,
  templateBody,
  templateFooter,
} from './template-copy';

const KEY = 'property_alert' as const;

function shipped(language: 'en' | 'kn' | 'hi') {
  return {
    body_text: templateBody(KEY, language),
    footer_text: templateFooter(KEY, language) ?? null,
  };
}

describe('stampFor', () => {
  it('stamps the shipped revision for a row built from shipped copy', () => {
    expect(stampFor('listing_details_notice', 'kn', shipped('kn'))).toBe(
      copyRevision(KEY, 'kn'),
    );
  });

  it('maps every English variant Meta accepts', () => {
    const en = copyRevision(KEY, 'en');
    for (const code of ['en_US', 'en_GB', 'en']) {
      expect(stampFor('listing_details_notice', code, shipped('en'))).toBe(en);
    }
  });

  // An account's own template has no shipped wording behind it, so
  // there is nothing it could ever fall behind.
  it('is null for a template the account wrote', () => {
    expect(stampFor('my_diwali_offer', 'kn', shipped('kn'))).toBeNull();
  });

  // Not a fallback to English: comparing a Gujarati registration
  // against English words would call it customised forever.
  it('is null for a language the product does not speak', () => {
    expect(stampFor('listing_details_notice', 'gu', shipped('en'))).toBeNull();
  });

  it('matches the name case-insensitively, as Meta template names are', () => {
    expect(stampFor('Listing_Details_Notice', 'kn', shipped('kn'))).toBe(
      copyRevision(KEY, 'kn'),
    );
  });

  // The case the whole signature exists for. A row created from an
  // older revision and never edited gets re-submitted after we improve
  // the copy; stamping today's revision would make its own body stop
  // matching its stamp, and an untouched row would read as the
  // account's own wording — losing the improvement it was owed.
  it('keeps the recorded origin when the content is not current shipped copy', () => {
    // Untouched means the body still equals the revision it was
    // stamped with, so the fixture's stamp has to be that row's own
    // fingerprint — an older shipped revision of ours.
    const older = { body_text: 'ಹಳೆಯ ಪಠ್ಯ {{1}}', footer_text: null };
    const origin = revisionOf(older.body_text, older.footer_text);

    const stamp = stampFor('listing_details_notice', 'kn', older, origin);

    expect(stamp).toBe(origin);
    expect(resolveCopyDrift({ ...older, copy_revision: stamp }, KEY, 'kn')).toBe(
      'update_available',
    );
  });

  // Their edit, re-submitted. Origin preserved, body no longer matches
  // it, so it stays legible as their wording.
  it('leaves an edited row reading as customised across a re-submit', () => {
    const origin = copyRevision(KEY, 'kn');
    const edited = { body_text: 'ಅವರ ಸ್ವಂತ ಪದಗಳು {{1}}', footer_text: null };

    const stamp = stampFor('listing_details_notice', 'kn', edited, origin);

    expect(resolveCopyDrift({ ...edited, copy_revision: stamp }, KEY, 'kn')).toBe(
      'customised',
    );
  });

  // First write of diverging content with nothing recorded: today's
  // revision is the only defensible guess, and it reads as customised,
  // which never overwrites anyone.
  it('falls back to the current revision when no origin is known', () => {
    const edited = { body_text: 'ಅವರ ಸ್ವಂತ ಪದಗಳು {{1}}', footer_text: null };

    const stamp = stampFor('listing_details_notice', 'kn', edited);

    expect(stamp).toBe(copyRevision(KEY, 'kn'));
    expect(resolveCopyDrift({ ...edited, copy_revision: stamp }, KEY, 'kn')).toBe(
      'customised',
    );
  });

  it('round-trips a freshly created row to in_sync', () => {
    const row = shipped('hi');
    const stamp = stampFor('listing_details_notice', 'hi', row);
    expect(resolveCopyDrift({ ...row, copy_revision: stamp }, KEY, 'hi')).toBe(
      'in_sync',
    );
  });
});
