import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enquiryStatusUpdate } from '@/lib/contacts/enquiry-review';

describe('enquiryStatusUpdate', () => {
  it('[CTM-009] sends a contact created by the enquiry to Needs Review', () => {
    expect(enquiryStatusUpdate(true)).toEqual({ status: 'pending_review' });
  });

  it('[CTM-009] leaves an existing contact in whatever status they already hold', () => {
    expect(enquiryStatusUpdate(false)).toEqual({});
    expect({ status: 'active', ...enquiryStatusUpdate(false) }.status).toBe(
      'active'
    );
  });
});

describe('WhatsApp enquiry paths', () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8');

  it('[CTM-009] gate Needs Review on the contact being created by the message', () => {
    const webhook = read('src/lib/whatsapp/webhook-handler.ts');
    const ctwa = read('src/lib/whatsapp/ctwa-attribution.ts');

    expect(webhook).toContain(
      '...enquiryStatusUpdate(contactOutcome.wasCreated)'
    );
    expect(webhook).toContain('contactWasCreated: contactOutcome.wasCreated');
    expect(ctwa).toContain('...enquiryStatusUpdate(contactWasCreated)');
    for (const source of [webhook, ctwa]) {
      expect(source).not.toMatch(
        /last_inquired_property_id: \w+(\.id)?,\s*status: 'pending_review'/
      );
    }
  });
});
