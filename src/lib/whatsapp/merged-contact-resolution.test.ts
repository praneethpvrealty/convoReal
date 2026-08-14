import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Two contact rows once shared a phone number, and every inbound message
// picked between their threads arbitrarily — .find() over an unordered
// result set. Merging the duplicates only fixes that if the phone
// lookups then skip the merge loser; without the filter, the next
// inbound message resolves straight back to the soft-deleted row and
// quietly undoes the merge. The shared find-or-create
// (src/lib/contacts/find-or-create.ts) already excludes is_merged; the
// WhatsApp paths were written before merging existed and did not.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('phone-based contact resolution skips merge losers', () => {
  it('the webhook contact lookup', () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    const lookup = source.indexOf(".like('phone', `%${phoneSuffix}`)");
    expect(lookup).toBeGreaterThan(-1);
    expect(source.slice(lookup - 200, lookup)).toContain(
      ".eq('is_merged', false)"
    );
  });

  it('the outbound dispatcher contact lookup', () => {
    const source = read('src/lib/whatsapp/meta-api-dispatcher.ts');
    const lookup = source.indexOf(".like('phone', `%${phoneSuffix}`)");
    expect(lookup).toBeGreaterThan(-1);
    expect(source.slice(lookup - 200, lookup)).toContain(
      ".eq('is_merged', false)"
    );
  });
});
