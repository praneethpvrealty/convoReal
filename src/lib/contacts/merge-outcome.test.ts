import { describe, expect, it } from 'vitest';

import { mergeOutcomeMessage } from './merge-outcome';
import { contactFormPayloadPropertyIds } from './form-links';

describe('[UIX-013] duplicate merge outcome', () => {
  it('reads as one success when every record merged', () => {
    expect(mergeOutcomeMessage(['Asha', 'Asha K'], [])).toEqual({
      tone: 'success',
      title: 'Merged 3 contacts into one',
    });
  });

  it('names what merged and what failed on a partial merge', () => {
    expect(
      mergeOutcomeMessage(['Asha'], [{ label: 'Asha K', reason: 'Locked' }])
    ).toEqual({
      tone: 'warning',
      title: 'Merged Asha; 1 not merged',
      detail: 'Asha K: Locked',
    });
    expect(
      mergeOutcomeMessage([], [{ label: 'Asha K', reason: 'Locked' }]).tone
    ).toBe('error');
  });
});

describe('[UIX-013] contact form property links', () => {
  it('sends property_ids only once the current links have loaded', () => {
    expect(contactFormPayloadPropertyIds(false, [])).toEqual({});
    expect(contactFormPayloadPropertyIds(true, [])).toEqual({
      property_ids: [],
    });
    expect(contactFormPayloadPropertyIds(true, ['p1'])).toEqual({
      property_ids: ['p1'],
    });
  });
});
