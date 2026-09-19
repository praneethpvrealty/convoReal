import { describe, expect, it } from 'vitest';

import {
  buildContactMergePatch,
  mergeSecondaryPhones,
  type MergeableContactProfile,
} from '@/lib/contacts/merge';

function contact(
  values: Partial<MergeableContactProfile> = {}
): MergeableContactProfile {
  return {
    phone: null,
    secondary_phones: [],
    email: null,
    company: null,
    lead_temp: null,
    source: null,
    classification: null,
    referrer: null,
    referrer_contact_id: null,
    assigned_agent_id: null,
    assigned_team_id: null,
    min_budget: null,
    max_budget: null,
    no_budget: null,
    min_roi: null,
    areas_of_interest: [],
    property_interests: [],
    requirements: null,
    ...values,
  };
}

describe('contact merge profile', () => {
  it('[CTM-001] retains every distinct phone while keeping the chosen primary', () => {
    expect(
      mergeSecondaryPhones(
        '+919994035636',
        ['9994035636', '+919876543210'],
        '+919443201111',
        ['9443201111', '+919700606010']
      )
    ).toEqual(['+919876543210', '+919443201111', '+919700606010']);
  });

  it('[CTM-001] fills blank identity fields and unions requirements', () => {
    const patch = buildContactMergePatch(
      contact({
        phone: '+919443201111',
        email: 'kpanand9999@gmail.com',
        company: 'Magic Bricks',
        max_budget: 120_000_000,
        areas_of_interest: ['Sector 6 HSR Layout'],
        requirements: 'Up to ₹12 Cr',
      }),
      contact({
        phone: '+919994035636',
        requirements:
          '4000 sqft residential plots in Koramangala 3rd block or HSR Layout.',
      }),
      '2026-09-19T12:00:00.000Z'
    );

    expect(patch).toMatchObject({
      email: 'kpanand9999@gmail.com',
      company: 'Magic Bricks',
      max_budget: 120_000_000,
      secondary_phones: ['+919443201111'],
      areas_of_interest: ['Sector 6 HSR Layout'],
      requirements:
        '4000 sqft residential plots in Koramangala 3rd block or HSR Layout.\nUp to ₹12 Cr',
    });
  });
});
