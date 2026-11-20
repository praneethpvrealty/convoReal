import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261120101229_drop_contacts_matching_phone_key.sql'
  ),
  'utf8'
);

describe('drop contacts_matching_phone_key', () => {
  it('[CTM-018] removes only the retired row-returning lookup, idempotently', () => {
    expect(sql.trim()).toBe(
      'DROP FUNCTION IF EXISTS public.contacts_matching_phone_key(UUID, TEXT);'
    );
  });
});
