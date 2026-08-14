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

// The lists that key on lead_temp must skip them too: a merge loser
// that was HOT when it lost would otherwise sit in the Today panel
// forever and draw follow-up radar cards for a contact that no longer
// exists as far as the inbox is concerned.
describe('HOT-lead surfaces skip merge losers', () => {
  it.each([
    'src/lib/today/queries.ts',
    'src/lib/contacts/follow-up-nudges.ts',
    'mobile/lib/today.ts',
  ])('%s', (path) => {
    const source = read(path);
    const hot = source.indexOf("'HOT'");
    expect(hot).toBeGreaterThan(-1);
    expect(source.slice(Math.max(0, hot - 400), hot)).toContain(
      "eq('is_merged', false)"
    );
  });
});
