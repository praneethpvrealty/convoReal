import { describe, expect, it } from 'vitest';

import { duplicatePhoneMessage } from './phone-duplicate';

describe('duplicatePhoneMessage', () => {
  it('[CTM-018] names a contact the caller can see and withholds one they cannot', () => {
    expect(
      duplicatePhoneMessage({
        id: 'a',
        visible: true,
        name: 'Lokesh',
        second_name: 'Harohalli',
      })
    ).toMatch(/^Lokesh Harohalli is already saved/);
    const hidden = duplicatePhoneMessage({
      id: 'a',
      visible: false,
      name: 'Lokesh',
      second_name: null,
    });
    expect(hidden).not.toContain('Lokesh');
    expect(hidden).toContain('Ask an admin');
  });
});
