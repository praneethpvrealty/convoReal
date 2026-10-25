import { describe, expect, it } from 'vitest';

import { phoneMatchKey, primaryPhonesDiffer } from './phone-key';

describe('primaryPhonesDiffer', () => {
  it('[CTM-001] treats one subscriber number in two formats as the same phone', () => {
    expect(primaryPhonesDiffer('+919742594250', '9742594250')).toBe(false);
    expect(phoneMatchKey('+91 97425 94250')).toBe('9742594250');
  });

  it('[CTM-001] flags two records whose WhatsApp numbers belong to different subscribers', () => {
    expect(primaryPhonesDiffer('+919742594250', '+919880011375')).toBe(true);
  });

  it('[CTM-001] does not flag a record without a usable phone', () => {
    expect(primaryPhonesDiffer(null, '+919742594250')).toBe(false);
    expect(primaryPhonesDiffer('123', '+919742594250')).toBe(false);
  });
});
