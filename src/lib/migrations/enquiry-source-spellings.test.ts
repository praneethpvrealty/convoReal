import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PORTALS, PORTAL_KEYS } from '@/lib/portals/post-kit';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('enquiry sources use one spelling per portal', () => {
  const column = read(
    'supabase/migrations/20260928022000_enquiry_via_portal_link.sql'
  );
  const merge = read(
    'supabase/migrations/20260928022100_enquiry_source_spellings.sql'
  );

  it('marks the enquiries a portal mapping created before renaming them', () => {
    expect(column).toContain(
      'ADD COLUMN IF NOT EXISTS via_portal_link BOOLEAN NOT NULL DEFAULT FALSE'
    );
    expect(merge.indexOf('SET via_portal_link = TRUE')).toBeLessThan(
      merge.indexOf("WHEN 'magicbricks' THEN 'Magic Bricks'")
    );
    expect(merge).toContain('AND cpi.inquiry_source = c.lead_portal;');
    expect(merge).toContain("WHEN 'housing' THEN 'Housing'");
  });

  it('unmaps only what the mapping created, whatever its spelling', () => {
    expect(merge).toContain('AND cpi.via_portal_link');
    expect(merge).not.toContain('cpi.inquiry_source = p_portal');
  });

  it('writes the same source for a portal whether the lead came by email or by mapping', () => {
    const parser = read('src/app/api/leads/email-webhook/email-parser.ts');
    for (const key of PORTAL_KEYS) {
      expect(parser).toContain(`source = '${PORTALS[key].enquirySource}';`);
    }
  });
});
