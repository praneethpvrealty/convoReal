import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROPERTY_CARD_COLUMNS,
  PROPERTY_CARD_OMITTED_COLUMNS,
} from './card-columns';

const ROOT = join(__dirname, '..', '..', '..');

const CARD_SURFACES = [
  'src/components/inventory/property-list.tsx',
  'src/components/inventory/property-table.tsx',
  'src/components/inventory/property-map-view.tsx',
  'src/components/inventory/property-actions-menu.tsx',
  'src/components/inventory/gate-requests-drawer.tsx',
  'src/components/inventory/bulk-tag-bar.tsx',
  'src/lib/inventory/card-badges.ts',
  'src/lib/inventory/photo-sources.ts',
  'src/lib/inventory/listing-title.ts',
  'src/lib/share-message-builder.ts',
  'mobile/app/(app)/(tabs)/properties.tsx',
  'mobile/app/(app)/properties-map.tsx',
  'mobile/lib/listing-price.ts',
  'mobile/lib/photo-sources.ts',
  'mobile/lib/share-message.ts',
];

function tableColumns(): string[] {
  const types = readFileSync(join(ROOT, 'src/types/database.types.ts'), 'utf8');
  const table = types.indexOf('      properties: {');
  const row = types.indexOf('Row: {', table);
  const end = types.indexOf('        };', row);
  return [...types.slice(row, end).matchAll(/^\s{10}(\w+)\??:/gm)].map(
    (m) => m[1]
  );
}

describe('inventory card projection', () => {
  it('[PRP-071] decides every properties column, once', () => {
    const kept = new Set<string>(PROPERTY_CARD_COLUMNS);
    const omitted = new Set<string>(PROPERTY_CARD_OMITTED_COLUMNS);
    expect(kept.size).toBe(PROPERTY_CARD_COLUMNS.length);
    expect([...omitted].filter((column) => kept.has(column))).toEqual([]);
    const columns = tableColumns();
    expect(columns.length).toBeGreaterThan(100);
    expect(
      columns.filter((column) => !kept.has(column) && !omitted.has(column))
    ).toEqual([]);
  });

  it('[PRP-071] omits no column a card, row, pin or row action reads', () => {
    const read: string[] = [];
    for (const file of CARD_SURFACES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const column of PROPERTY_CARD_OMITTED_COLUMNS) {
        if (new RegExp(`[.'"\`]${column}\\b`).test(source)) {
          read.push(`${file}: ${column}`);
        }
      }
    }
    expect(read).toEqual([]);
  });
});
