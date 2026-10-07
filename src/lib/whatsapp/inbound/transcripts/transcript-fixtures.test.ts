import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkTranscript,
  type TranscriptContext,
  type TranscriptMessage,
  type TranscriptRuleId,
} from './transcript-rules';
import { carriesContactDetails } from './mask';

interface TranscriptFixture {
  id: string;
  source: string;
  context: TranscriptContext;
  expectedViolations: TranscriptRuleId[];
  transcript: TranscriptMessage[];
}

const dir = join(__dirname, 'fixtures');
const fixtures = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map(
    (name) =>
      JSON.parse(readFileSync(join(dir, name), 'utf8')) as TranscriptFixture
  );

/**
 * Every real thread pinned here is checked against the rules exactly as
 * recorded: a thread that was wrong keeps its violations on record, so a
 * rule that stops catching it fails this test; a thread that was fixed
 * declares none (CNV-005).
 */
describe('[CNV-005] pinned transcripts', () => {
  it('has at least the 7 October 2026 thread on record', () => {
    expect(fixtures.map((f) => f.id)).toContain(
      '2026-10-07-portal-lead-jp-nagar'
    );
  });

  it.each(fixtures.map((f) => [f.id, f] as const))(
    '%s reports exactly the violations it was recorded with',
    (_id, fixture) => {
      const found = checkTranscript(fixture.transcript, fixture.context);
      expect([...new Set(found.map((v) => v.rule))].sort()).toEqual(
        [...new Set(fixture.expectedViolations)].sort()
      );
    }
  );

  it('keeps every fixture free of a phone number or email', () => {
    for (const fixture of fixtures) {
      const text = JSON.stringify(fixture);
      for (const bubble of fixture.transcript) {
        expect(carriesContactDetails(bubble.text), fixture.id).toBe(false);
      }
    }
  });
});
