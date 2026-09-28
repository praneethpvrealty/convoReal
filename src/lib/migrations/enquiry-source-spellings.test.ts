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

  it('flags and renames only the enquiries a mapping created', () => {
    expect(column).toContain(
      'ADD COLUMN IF NOT EXISTS via_portal_link BOOLEAN NOT NULL DEFAULT FALSE'
    );
    expect(merge).toMatch(
      /SET via_portal_link = TRUE,\s+inquiry_source = CASE inquiry_source\s+WHEN 'magicbricks' THEN 'Magic Bricks'\s+WHEN 'housing' THEN 'Housing'\s+END\s+WHERE inquiry_source IN \('magicbricks', 'housing'\);/
    );
    expect(merge).not.toContain('c.lead_portal IS NOT NULL');
  });

  it('forgets the mapping once another writer records the same enquiry', () => {
    expect(merge).toContain(
      'IF OLD.via_portal_link AND NEW.via_portal_link THEN\n    NEW.via_portal_link := FALSE;'
    );
    expect(merge).toMatch(
      /CREATE TRIGGER clear_enquiry_portal_link\s+BEFORE UPDATE ON public\.contact_property_inquiries/
    );
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
