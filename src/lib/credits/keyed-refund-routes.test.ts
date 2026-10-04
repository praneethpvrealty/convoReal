import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refundOutcomeNotice } from './refund-burn';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const routes = [
  { path: 'src/app/api/ai/ad-copy/route.ts', refunds: 2 },
  { path: 'src/app/api/ai/enhance-image/route.ts', refunds: 1 },
  { path: 'src/app/api/ai/generate-description/route.ts', refunds: 1 },
  { path: 'src/app/api/ai/greetings/route.ts', refunds: 1 },
  { path: 'src/app/api/ai/parse-event/route.ts', refunds: 1 },
  { path: 'src/app/api/ai/share-email/route.ts', refunds: 2 },
  {
    path: 'src/app/api/contacts/[id]/calls/[callId]/create-events/route.ts',
    refunds: 2,
  },
  { path: 'src/app/api/contacts/[id]/calls/analyze/route.ts', refunds: 1 },
  {
    path: 'src/app/api/deals/[id]/documents/[docId]/extract/route.ts',
    refunds: 1,
  },
  { path: 'src/app/api/greetings/generate/route.ts', refunds: 1 },
  { path: 'src/app/api/guidance-value/lookup/route.ts', refunds: 1 },
  { path: 'src/app/api/properties/e-khata/route.ts', refunds: 3 },
];

describe.each(routes)(
  'an AI route that refunds a failed call by its own charge [CRD-003] $path',
  ({ path, refunds }) => {
    const source = read(path);

    it('takes newBurnKey and refundBurn from the keyed refund module', () => {
      expect(source).toMatch(
        /import \{\s*newBurnKey,\s*refundBurn,?\s*(?:refundOutcomeNotice,?\s*)?\} from '@\/lib\/credits\/refund-burn';/
      );
    });

    it('mints one key per request, before the burn, and charges under it', () => {
      expect(source.match(/newBurnKey\(/g)).toHaveLength(1);
      expect(source.match(/const burnKey = newBurnKey\(/g)).toHaveLength(1);
      expect(source.match(/burnCredits\(/g)).toHaveLength(1);
      expect(source.match(/retryKey: burnKey/g)).toHaveLength(1);
      expect(source.indexOf('const burnKey = newBurnKey(')).toBeLessThan(
        source.indexOf('burnCredits(')
      );
    });

    it('refunds every failure path by that same key', () => {
      const calls = source.match(/refundBurn\(/g) ?? [];
      const keyed =
        source.match(/refundBurn\(\s*[^,()]+,\s*[^,()]+,\s*burnKey\b/g) ?? [];
      expect(calls).toHaveLength(refunds);
      expect(keyed).toHaveLength(refunds);
    });

    it('no longer refunds by feature and amount', () => {
      expect(source).not.toContain('refundCredits');
    });
  }
);

describe('the routes that carry a refund reason [CRD-003]', () => {
  it('keeps the description each refund was logged with', () => {
    const khata = read('src/app/api/properties/e-khata/route.ts');
    expect(khata).toContain("reason: 'e-Khata read failed'");
    expect(khata).toContain("reason: 'not an e-Khata'");
    expect(khata).toContain("reason: 'e-Khata could not be attached'");
    expect(
      read('src/app/api/deals/[id]/documents/[docId]/extract/route.ts')
    ).toContain("reason: 'deal document read failed'");
    expect(read('src/app/api/guidance-value/lookup/route.ts')).toContain(
      "reason: 'guidance value schedule read failed'"
    );
  });
});

describe('the guidance schedule read [CRD-003]', () => {
  const source = read('src/app/api/guidance-value/lookup/route.ts');

  it('mints its key before the staff-only burn so the refund in the catch can reach it', () => {
    expect(source.indexOf('const burnKey = newBurnKey(FEATURE)')).toBeLessThan(
      source.indexOf("if (caller.kind === 'portal')")
    );
  });

  it('refunds only staff, who are the only callers charged', () => {
    expect(source).toMatch(/caller\.kind === 'staff'\s+\? await refundBurn\(/);
  });
});

describe('what a route tells the user about a refund [CRD-003]', () => {
  it('says refunded only when it was, pending when queued, and support when neither', () => {
    expect(refundOutcomeNotice({ status: 'refunded', refunded: 5 })).toBe(
      'Your credits were refunded.'
    );
    expect(refundOutcomeNotice({ status: 'queued' })).toBe(
      'Your credits will be refunded within the hour.'
    );
    expect(refundOutcomeNotice({ status: 'failed' })).toBe(
      'We could not refund your credits automatically; please contact support.'
    );
  });

  it('builds every refund claim from the outcome, never from a fixed sentence', () => {
    for (const path of [
      'src/app/api/properties/e-khata/route.ts',
      'src/app/api/guidance-value/lookup/route.ts',
      'src/app/api/deals/[id]/documents/[docId]/extract/route.ts',
    ]) {
      const source = read(path);
      expect(source, path).toContain('refundOutcomeNotice(');
      expect(source, path).not.toContain('Your credits were refunded');
    }
  });
});

describe('the failed deal document line promises no refund [CRD-003]', () => {
  it('does not claim a refund on web or mobile, where only the status is persisted', () => {
    for (const path of [
      'src/components/deals/deal-documents-panel.tsx',
      'mobile/app/(app)/deal/[id].tsx',
    ]) {
      const source = read(path);
      expect(source, path).toContain('Could not read this one.');
      expect(source, path).not.toMatch(/credits (were|are) refunded/);
    }
  });
});
