import { describe, expect, it } from 'vitest';
import { enquiryRefSuffix, parseEnquiryRef } from './enquiry-ref';

describe('[PLS-010] the WhatsApp button names its browser session', () => {
  it('writes the start of the session key and reads it back from the message', () => {
    const suffix = enquiryRefSuffix('9C7C5A9B-500d-4f42-9db5-846acfb385ec');
    expect(suffix).toBe(' (Ref 9c7c5a9b)');
    expect(
      parseEnquiryRef(
        `Hi! I am interested in your property "Villa" (Property ID: PROP-2551)${suffix}`
      )
    ).toBe('9c7c5a9b');
  });

  it('adds nothing for a session key that is not a UUID and finds nothing in a plain message', () => {
    expect(enquiryRefSuffix('not-a-key')).toBe('');
    expect(parseEnquiryRef('Hi! (Property ID: PROP-2551)')).toBeNull();
    expect(parseEnquiryRef('(Ref 50%_or(1)')).toBeNull();
    expect(parseEnquiryRef(null)).toBeNull();
  });
});
