import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CITY_ALIASES, canonicalCity } from './city';

describe('canonicalCity', () => {
  it('[PVL-005] folds an older or alternate city name into one', () => {
    expect(canonicalCity('Bangalore')).toBe('bengaluru');
    expect(canonicalCity('  BENGALURU ')).toBe('bengaluru');
    expect(canonicalCity('Bangalore  Urban')).toBe('bengaluru');
    expect(canonicalCity('Mysore')).toBe('mysuru');
    expect(canonicalCity('Kolar')).toBe('kolar');
    expect(canonicalCity('  ')).toBeNull();
    expect(canonicalCity(null)).toBeNull();
  });

  it('[PVL-005] account_locality_medians carries the same alias list', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20261111124701_account_locality_medians_city_alias.sql'
      ),
      'utf8'
    );
    const inSql = Array.from(
      sql.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)
    ).map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(inSql)).toEqual(CITY_ALIASES);
    expect(inSql).toHaveLength(Object.keys(CITY_ALIASES).length);
  });
});
