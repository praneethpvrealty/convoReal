import { describe, expect, it } from 'vitest';
import {
  DO_NOT_CONTACT_REASON_MAX,
  doNotContactNote,
  isDoNotContact,
  normaliseDoNotContactReason,
} from './do-not-contact';

describe('do-not-contact helpers', () => {
  it('treats only an explicit true as do not contact', () => {
    expect(isDoNotContact({ do_not_contact: true })).toBe(true);
    expect(isDoNotContact({ do_not_contact: false })).toBe(false);
    expect(isDoNotContact({ do_not_contact: null })).toBe(false);
    expect(isDoNotContact({})).toBe(false);
    expect(isDoNotContact(null)).toBe(false);
  });

  it('flattens and bounds a reason, and drops an empty one', () => {
    expect(normaliseDoNotContactReason('  only via\n his son ')).toBe(
      'only via his son'
    );
    expect(normaliseDoNotContactReason('   ')).toBeNull();
    expect(normaliseDoNotContactReason(42)).toBeNull();
    expect(normaliseDoNotContactReason('x'.repeat(500))?.length).toBe(
      DO_NOT_CONTACT_REASON_MAX
    );
  });

  it('writes an audit note for each direction', () => {
    expect(doNotContactNote(true, 'relative')).toBe(
      'Marked Do not contact: relative'
    );
    expect(doNotContactNote(true, null)).toBe('Marked Do not contact.');
    expect(doNotContactNote(false, null)).toContain('turned off');
  });
});

describe('showcase outreach', () => {
  it('skips a do-not-contact visitor before anything else', async () => {
    const { showcaseOutreachExclusion } =
      await import('@/lib/showcase/view-nudges');
    expect(
      showcaseOutreachExclusion(
        'c1',
        { do_not_contact: true, classification: 'Buyer' },
        { owner_contact_id: null }
      )
    ).toBe('do_not_contact');
  });
});
