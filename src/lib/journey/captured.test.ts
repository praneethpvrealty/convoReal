import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { JourneyItemSource } from '@/types';
import { JOURNEY_ITEM_SOURCE_LABELS, capturedItemTitle } from './captured';

const SOURCES: JourneyItemSource[] = [
  'manual',
  'whatsapp_share',
  'chat_import',
  'inquiry_import',
];

describe('captured tray', () => {
  it('[JRN-005] labels every way an item can be captured', () => {
    expect(Object.keys(JOURNEY_ITEM_SOURCE_LABELS).sort()).toEqual(
      [...SOURCES].sort()
    );
    for (const source of SOURCES) {
      expect(JOURNEY_ITEM_SOURCE_LABELS[source].trim()).not.toBe('');
    }
  });

  it('[JRN-005] titles a captured item by the other side of the pair', () => {
    const contact = { name: 'KP Anand', phone: '+919994035636' };
    const property = { title: 'Residential Plot in Sector 6 HSR Layout' };
    const item = { contact, property } as Parameters<
      typeof capturedItemTitle
    >[0];
    expect(capturedItemTitle(item, 'buyer')).toBe(property.title);
    expect(capturedItemTitle(item, 'property')).toBe('KP Anand');
    expect(
      capturedItemTitle(
        { contact: { ...contact, name: '' }, property } as typeof item,
        'property'
      )
    ).toBe('+919994035636');
    expect(capturedItemTitle({ contact: null, property: null }, 'buyer')).toBe(
      'Unknown property'
    );
    expect(
      capturedItemTitle({ contact: null, property: null }, 'property')
    ).toBe('Unknown contact');
  });
});

describe('journey_show_captured', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260920041500_journey_show_captured.sql'
    ),
    'utf8'
  );

  it('[JRN-005] promotes only the reviewed ids of the account and logs each in the same transaction', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("is_account_member(p_account_id, 'agent')");
    expect(sql).toContain('SET hidden = FALSE');
    expect(sql).toContain('WHERE account_id = p_account_id');
    expect(sql).toContain('AND id = ANY(p_item_ids)');
    expect(sql).toContain('INSERT INTO journey_events');
    expect(sql).toContain("'unhidden', shown.stage_id, shown.stage_id");
    expect(sql).not.toContain('contact_id =');
    expect(sql).not.toContain('property_id =');
  });
});
