import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A merge loser remains as a phone alias. This matters when the same person
// had two real numbers: the winner keeps one primary number, while inbound
// traffic to the loser's number must still resolve to the winner instead of
// recreating a duplicate contact.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('phone-based contact resolution follows merge aliases', () => {
  it('the webhook contact lookup', () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    expect(source).toContain('c.is_merged && c.merged_into_id');
    expect(source).toContain(".eq('id', alias.merged_into_id)");
    expect(source).toContain(".eq('is_merged', false)");
  });

  it('the outbound dispatcher contact lookup', () => {
    const source = read('src/lib/whatsapp/meta-api-dispatcher.ts');
    expect(source).toContain('c.is_merged && c.merged_into_id');
    expect(source).toContain(".eq('id', alias.merged_into_id)");
    expect(source).toContain(".eq('is_merged', false)");
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
