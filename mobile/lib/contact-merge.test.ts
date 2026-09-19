import { describe, expect, it } from 'vitest';

import {
  mergeContactLabel,
  mergedPhonePreview,
  type MergePreviewContact,
} from './contact-merge';

function contact(
  values: Partial<MergePreviewContact> &
    Pick<MergePreviewContact, 'id' | 'phone'>
): MergePreviewContact {
  return {
    name: null,
    secondary_phones: [],
    email: null,
    company: null,
    classification: null,
    requirements: null,
    ...values,
  };
}

describe('mobile contact merge preview', () => {
  it('[CTM-001] makes the chosen record the primary and retains the other number', () => {
    const mbUser = contact({
      id: 'mb',
      phone: '+919443201111',
      name: 'Mbuser',
    });
    const anand = contact({
      id: 'anand',
      phone: '+919994035636',
      name: 'KP Anand',
    });

    expect(mergedPhonePreview(mbUser, anand)).toEqual({
      primary: '+919994035636',
      other: ['+919443201111'],
    });
    expect(mergeContactLabel(anand)).toBe('KP Anand');
  });
});
