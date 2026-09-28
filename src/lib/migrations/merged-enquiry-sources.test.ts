import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('[PRP-024] a merged contact keeps where its enquiries came from', () => {
  it('copies each enquiry with its source, date and notes', () => {
    const route = read('src/app/api/contacts/merge/route.ts');
    expect(route).toContain(
      "'property_id, account_id, inquiry_source, inquiry_date, notes, created_at'"
    );
    for (const field of [
      'inquiry_source: i.inquiry_source,',
      'inquiry_date: i.inquiry_date,',
      'notes: i.notes,',
      'created_at: i.created_at,',
    ]) {
      expect(route).toContain(field);
    }
  });

  it('fills a sourceless enquiry from the merge that wrote it', () => {
    const sql = read(
      'supabase/migrations/20260928050000_merged_enquiry_sources.sql'
    );
    expect(sql).toContain("NULLIF(m.source_snapshot->>'source', '') AS source");
    expect(sql).toContain(
      "m.created_at BETWEEN cpi.created_at AND cpi.created_at + INTERVAL '10 seconds'"
    );
    expect(sql).toContain('WHERE cpi.inquiry_source IS NULL');
    expect(sql).toContain('AND nearest_merge.source IS NOT NULL;');
  });
});
