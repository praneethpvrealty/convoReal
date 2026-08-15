import { describe, expect, it } from 'vitest';

import {
  CONSENT_LABELS,
  CONSENT_STATES,
  consentChangeNote,
  consentOverrideNeedsAck,
  isConsentState,
} from './alerts-consent';

describe('isConsentState', () => {
  it('accepts exactly the values the column allows', () => {
    for (const state of CONSENT_STATES)
      expect(isConsentState(state)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['GRANTED', 'yes', '', null, undefined, 1, {}]) {
      expect(isConsentState(value)).toBe(false);
    }
  });
});

describe('consentOverrideNeedsAck', () => {
  it('guards undoing a contact’s own opt-out', () => {
    expect(consentOverrideNeedsAck('declined', 'granted')).toBe(true);
    expect(consentOverrideNeedsAck('declined', 'pending')).toBe(true);
  });

  it('never guards opting someone out', () => {
    for (const from of CONSENT_STATES) {
      expect(consentOverrideNeedsAck(from, 'declined')).toBe(false);
    }
  });

  it('does not guard ordinary moves from pending or granted', () => {
    expect(consentOverrideNeedsAck('pending', 'granted')).toBe(false);
    expect(consentOverrideNeedsAck('granted', 'pending')).toBe(false);
  });
});

describe('consentChangeNote', () => {
  it('records both ends of the change in words', () => {
    const note = consentChangeNote('pending', 'granted');
    expect(note).toContain(CONSENT_LABELS.pending);
    expect(note).toContain(CONSENT_LABELS.granted);
    expect(note).toContain('recorded by an agent');
  });

  it('appends a reason when one is given', () => {
    expect(
      consentChangeNote('pending', 'granted', '  asked at site visit ')
    ).toContain('Reason: asked at site visit');
  });

  it('omits the reason line when blank', () => {
    expect(consentChangeNote('granted', 'declined', '   ')).not.toContain(
      'Reason:'
    );
  });
});
