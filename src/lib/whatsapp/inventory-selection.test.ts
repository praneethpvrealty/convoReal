import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  parseInventorySelectionCommand,
  parseInventorySummaryEntries,
  resolveInventorySelectionReference,
} from './inventory-selection';

describe('parseInventorySelectionCommand', () => {
  it('reads category-qualified property numbers', () => {
    expect(parseInventorySelectionCommand('commercial 3,9')).toEqual({
      category: 'Commercial',
      ordinals: [3, 9],
    });
    expect(
      parseInventorySelectionCommand(
        'share full details for residential 2 and 4'
      )
    ).toEqual({ category: 'Residential', ordinals: [2, 4] });
    expect(parseInventorySelectionCommand('agri properties no. 1')).toEqual({
      category: 'Agricultural',
      ordinals: [1],
    });
  });

  it('does not treat property requirements as numbered selections', () => {
    expect(parseInventorySelectionCommand('commercial 3 BHK')).toBeNull();
    expect(parseInventorySelectionCommand('commercial under 9 cr')).toBeNull();
    expect(
      parseInventorySelectionCommand('JP Nagar commercial property')
    ).toBeNull();
  });
});

describe('parseInventorySummaryEntries', () => {
  it('keeps ordinals scoped to the category where numbering restarts', () => {
    const message = [
      '*INVENTORY UPDATE* 🏠',
      '',
      '*RESIDENTIAL*',
      '1. *Residential Plot* | Plot | ₹2 Cr',
      '2. *Lake View Villa* | Villa | ₹5 Cr',
      '',
      '*COMMERCIAL*',
      '1. *Office One* | Office | ₹6 Lakhs/mo rent',
      '2. *Warehouse Two* | Warehouse | ₹9 Cr',
      '3. *Commercial Three* | Commercial Land | ₹14 Cr',
      '9. *Commercial Nine* | Commercial Bldg | ₹31 Cr',
      '',
      '*AGRICULTURAL*',
      '1. *Coffee Estate* | Agri Land | ₹18 Cr',
    ].join('\n');

    expect(parseInventorySummaryEntries(message)).toEqual([
      { category: 'Residential', ordinal: 1, title: 'Residential Plot' },
      { category: 'Residential', ordinal: 2, title: 'Lake View Villa' },
      { category: 'Commercial', ordinal: 1, title: 'Office One' },
      { category: 'Commercial', ordinal: 2, title: 'Warehouse Two' },
      { category: 'Commercial', ordinal: 3, title: 'Commercial Three' },
      { category: 'Commercial', ordinal: 9, title: 'Commercial Nine' },
      { category: 'Agricultural', ordinal: 1, title: 'Coffee Estate' },
    ]);
  });
});

function selectionDb(
  contentText: string,
  properties: Array<{ id: string; title: string; type: string }>
): SupabaseClient {
  const messageQuery = {
    select: () => ({
      eq: () => ({
        in: () => ({
          not: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ content_text: contentText }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };
  const propertyQuery = {
    select: () => {
      const chain = {
        eq: () => chain,
        in: async () => ({ data: properties, error: null }),
      };
      return chain;
    },
  };
  return {
    from: (table: string) =>
      table === 'messages' ? messageQuery : propertyQuery,
  } as unknown as SupabaseClient;
}

describe('resolveInventorySelectionReference', () => {
  it('resolves the requested ordinals only inside the named category', async () => {
    const summary = [
      '*RESIDENTIAL*',
      '3. *Residential Three* | Apartment',
      '9. *Residential Nine* | Villa',
      '',
      '*COMMERCIAL*',
      '3. *Commercial Three* | Commercial Land',
      '9. *Commercial Nine* | Commercial Bldg',
    ].join('\n');
    const db = selectionDb(summary, [
      { id: 'res-3', title: 'Residential Three', type: 'Flat/ Apartment' },
      { id: 'com-9', title: 'Commercial Nine', type: 'Commercial Building' },
      { id: 'com-3', title: 'Commercial Three', type: 'Commercial Land' },
    ]);

    await expect(
      resolveInventorySelectionReference(db, 'account-1', 'conversation-1', {
        category: 'Commercial',
        ordinals: [3, 9],
      })
    ).resolves.toEqual(['com-3', 'com-9']);
  });

  it('refuses an ambiguous duplicate title instead of guessing', async () => {
    const summary = ['*COMMERCIAL*', '3. *Twin Office* | Office'].join('\n');
    const db = selectionDb(summary, [
      { id: 'office-a', title: 'Twin Office', type: 'Commercial Office Space' },
      { id: 'office-b', title: 'Twin Office', type: 'Commercial Office Space' },
    ]);

    await expect(
      resolveInventorySelectionReference(db, 'account-1', 'conversation-1', {
        category: 'Commercial',
        ordinals: [3],
      })
    ).resolves.toEqual([]);
  });
});
