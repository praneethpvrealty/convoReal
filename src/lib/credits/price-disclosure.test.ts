import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The disclosure rule (docs/credits-policy-voice-campaign-call.md) says a
// control's price must never drift from what is burned. A hardcoded
// number in the copy is how it drifts: the Voice settings card went on
// telling accounts "25 cr per call" for a call that had been repriced to
// 250, and nothing failed — the string was simply wrong on a live
// settings page.
//
// Prices belong in AI_FEATURE_COSTS and reach the UI through it, so a
// literal "<n> cr" in these files is the bug, not the wording.

const SURFACES = [
  'src/components/settings/voice-agent-card.tsx',
  'src/app/(dashboard)/broadcasts/voice-campaigns-content.tsx',
  'src/app/(dashboard)/broadcasts/announcements-content.tsx',
];

/** "25 cr", "250cr", "2 credits" — a price written by hand. Interpolated
 *  prices read `} cr`, so they never match.
 *
 *  Case matters: credits are lowercase `cr`, while `Cr` is crore, which
 *  legitimately appears in copy about property prices ("14.7 Cr"). The
 *  lookbehind drops decimals for the same reason — a rupee figure, not a
 *  credit count. */
const HARDCODED_PRICE = /(?<![\d.])\d+\s*(cr\b|credits?\b)/;

describe('credit prices are never hardcoded in UI copy', () => {
  for (const file of SURFACES) {
    it(`${file} prices from AI_FEATURE_COSTS`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const offenders = source
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => HARDCODED_PRICE.test(line))
        // A fallback beside the constant it mirrors is fine; copy is not.
        .filter(({ line }) => !line.includes('AI_FEATURE_COSTS'))
        .map(({ line, n }) => `${n}: ${line}`);
      expect(offenders.join('\n')).toBe('');
    });
  }
});
