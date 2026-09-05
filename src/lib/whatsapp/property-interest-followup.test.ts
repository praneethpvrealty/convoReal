import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildPropertyInterestFollowUpMessage } from './property-interest-followup';
import type { Property } from '@/types';

function showcaseDb(subdomain: string | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { subdomain }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('buildPropertyInterestFollowUpMessage', () => {
  it('names the exact property and includes an attributed showcase link', async () => {
    const property = {
      id: 'property-7',
      title: 'Residential building on 60x40 plot',
      property_code: 'PROP-1072',
    } as Property;

    await expect(
      buildPropertyInterestFollowUpMessage({
        db: showcaseDb('aryavarta'),
        accountId: 'account-1',
        target: {
          contact: {
            id: 'contact-9',
            name: 'Anil Reddy',
            phone: '919849939310',
          },
          property,
        },
      })
    ).resolves.toBe(
      'Hi Anil, just checking in on Residential building on 60x40 plot (PROP-1072). Are you still considering this one, or should I park it and focus on other options?\n\n📸 Photos & full details:\nhttps://aryavarta.convoreal.com/?property_id=PROP-1072&v=contact-9'
    );
  });
});
