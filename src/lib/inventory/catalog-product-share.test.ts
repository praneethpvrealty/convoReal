import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CATALOG_INDEXING_SECONDS,
  catalogProductCaption,
  catalogProductRetailerId,
  catalogShareState,
  matchCatalogSendResults,
} from './catalog-product-share';

const SYNCED = '2026-10-08T10:00:00.000Z';
const syncedMs = new Date(SYNCED).getTime();

describe('[PRP-043] WhatsApp catalog product card share', () => {
  it('is not sendable until a sync has finished indexing', () => {
    expect(catalogShareState({}, syncedMs)).toEqual({
      status: 'not_synced',
      secondsLeft: 0,
    });
    expect(
      catalogShareState(
        { meta_catalog_synced_at: SYNCED, meta_catalog_error: 'boom' },
        syncedMs + 600_000
      ).status
    ).toBe('failed');
    expect(
      catalogShareState({ meta_catalog_synced_at: SYNCED }, syncedMs + 30_500)
    ).toEqual({ status: 'indexing', secondsLeft: 60 });
    expect(
      catalogShareState(
        { meta_catalog_synced_at: SYNCED },
        syncedMs + CATALOG_INDEXING_SECONDS * 1000
      )
    ).toEqual({ status: 'ready', secondsLeft: 0 });
  });

  it('addresses the catalog item by property code, else id', () => {
    expect(catalogProductRetailerId({ id: 'p1', property_code: 'CR-9' })).toBe(
      'CR-9'
    );
    expect(catalogProductRetailerId({ id: 'p1', property_code: null })).toBe(
      'p1'
    );
  });

  it('never puts a guarded listing’s street address in the caption', () => {
    const caption = catalogProductCaption({
      title: 'Villa plot',
      price: 25_000_000,
      type: 'Villa',
      location: '12 Secret Street',
      city: 'Bengaluru',
    });
    expect(caption).toBe(
      '🏠 *Villa plot*\n💰 Price: ₹2.50 Cr\n📍 Location: Bengaluru'
    );
    expect(
      catalogProductCaption({
        title: 'Office',
        price: 0,
        type: 'Office Space',
        location: 'ITPL Road',
      })
    ).toBe('🏠 *Office*\n💰 Price: \n📍 Location: ITPL Road');
  });

  it('reports each recipient as sent only on a sent result', () => {
    const outcomes = matchCatalogSendResults(
      [
        { id: 'a', phone: '919900000001' },
        { id: 'b', phone: '919900000002' },
        { id: 'c', phone: '919900000003' },
      ],
      [
        { phone: '919900000001', status: 'sent' },
        { phone: '919900000002', status: 'failed', error: 'Not on WhatsApp' },
      ]
    );
    expect(outcomes.map((o) => [o.contact.id, o.sent, o.error])).toEqual([
      ['a', true, undefined],
      ['b', false, 'Not on WhatsApp'],
      ['c', false, undefined],
    ]);
  });

  it('never lends one recipient’s result to another whose number overlaps', () => {
    const outcomes = matchCatalogSendResults(
      [
        { id: 'local', phone: '9900000001' },
        { id: 'prefixed', phone: '919900000001' },
      ],
      [
        { phone: '9900000001', status: 'sent' },
        { phone: '919900000001', status: 'failed', error: 'Rejected' },
      ]
    );
    expect(outcomes.map((o) => [o.contact.id, o.sent])).toEqual([
      ['local', true],
      ['prefixed', false],
    ]);
  });

  it('is offered on both the web dialog and the mobile share sheet', () => {
    const root = process.cwd();
    const web = readFileSync(
      join(root, 'src/components/inventory/property-share-dialog.tsx'),
      'utf8'
    );
    const mobileLib = readFileSync(
      join(root, 'mobile/lib/catalog-product-share.ts'),
      'utf8'
    );
    const mobileSheet = readFileSync(
      join(root, 'mobile/components/property-share-sheet.tsx'),
      'utf8'
    );
    expect(web).toContain("from '@/lib/inventory/catalog-product-share'");
    expect(mobileLib).toContain(
      "from '@shared/lib/inventory/catalog-product-share'"
    );
    expect(mobileSheet).toContain('<CatalogProductShare');
    for (const source of [web, mobileLib]) {
      expect(source).toContain("broadcast_type: 'product'");
      expect(source).toContain('catalogProductCaption(');
    }
  });
});
