import { describe, expect, it } from 'vitest';

import { buildCheckInMessage } from './checkin-message';

describe('buildCheckInMessage', () => {
  it('greets by first name and names the property with its code', () => {
    expect(
      buildCheckInMessage({
        contactName: 'Supreeth Kumar',
        propertyTitle: 'Old residential house in 4200 sqft plot',
        propertyCode: 'PROP-1095',
        stageName: 'Shortlisted',
      })
    ).toBe(
      'Hi Supreeth, just checking in on Old residential house in 4200 sqft plot (PROP-1095). We had it at Shortlisted. Are you still considering this one, or should I park it and focus on other options?'
    );
  });

  it('drops the greeting name and the stage clause when they are missing', () => {
    expect(
      buildCheckInMessage({ contactName: '  ', propertyTitle: 'Sunrise Villa' })
    ).toBe(
      'Hi, just checking in on Sunrise Villa. Are you still considering this one, or should I park it and focus on other options?'
    );
  });

  it('falls back to the code, then to a generic subject', () => {
    expect(buildCheckInMessage({ contactName: 'Asha', propertyCode: 'PROP-7' })).toContain(
      'checking in on PROP-7.'
    );
    expect(buildCheckInMessage({ contactName: 'Asha' })).toContain(
      'checking in on the property we discussed.'
    );
  });
});
