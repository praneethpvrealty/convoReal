import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JOURNEY_COMPARTMENT,
  journeyCompartmentOwner,
  journeyCompartmentScopeOf,
  parseJourneyCompartmentMutation,
} from './compartments';

describe('journey compartments', () => {
  it('[JRN-014] starts every unsorted journey in Passive and shares the split by default', () => {
    expect(DEFAULT_JOURNEY_COMPARTMENT).toBe('passive');
    expect(journeyCompartmentScopeOf(undefined)).toBe('team');
    expect(journeyCompartmentScopeOf('nonsense')).toBe('team');
    expect(journeyCompartmentScopeOf('agent')).toBe('agent');
  });

  it('[JRN-014] keeps team rows ownerless and agent rows per user', () => {
    expect(journeyCompartmentOwner('team', 'u1')).toBeNull();
    expect(journeyCompartmentOwner('agent', 'u1')).toBe('u1');
  });

  it('[JRN-014] accepts only a mode, a journey and focus or passive', () => {
    expect(
      parseJourneyCompartmentMutation({
        mode: 'property',
        subjectId: ' p1 ',
        compartment: 'focus',
      })
    ).toEqual({
      ok: true,
      value: { mode: 'property', subjectId: 'p1', compartment: 'focus' },
    });
    expect(parseJourneyCompartmentMutation(null).ok).toBe(false);
    expect(
      parseJourneyCompartmentMutation({
        mode: 'seller',
        subjectId: 'p1',
        compartment: 'focus',
      }).ok
    ).toBe(false);
    expect(
      parseJourneyCompartmentMutation({
        mode: 'buyer',
        subjectId: '',
        compartment: 'focus',
      }).ok
    ).toBe(false);
    expect(
      parseJourneyCompartmentMutation({
        mode: 'buyer',
        subjectId: 'c1',
        compartment: 'archived',
      }).ok
    ).toBe(false);
  });
});
