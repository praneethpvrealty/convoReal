import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src/lib/ai/chatbot-engine.ts'),
  'utf8'
);

describe('chatbot-engine draft session access', () => {
  it('reaches the draft session tables only through draft-sessions', () => {
    expect(source).not.toContain(".from('property_draft_sessions')");
    expect(source).not.toContain(".from('contact_draft_sessions')");
    expect(source).toMatch(/from '@\/lib\/ai\/draft-sessions';/);
  });

  it('keeps no hand-rolled optimistic-lock loop', () => {
    expect(source).not.toContain('maxRetries');
    expect(source).not.toContain("code === 'PGRST116'");
  });
});

describe('starting a contact draft', () => {
  const insert = source.slice(
    source.indexOf('await insertContactDraftSession(')
  );
  const created = insert.indexOf('`📝 *Contact Drafts Created!*`');

  it('checks the insert before announcing the draft', () => {
    expect(
      source.indexOf(
        'const { error: insertErr } = await insertContactDraftSession('
      )
    ).toBeGreaterThan(-1);
    expect(insert.indexOf('if (insertErr) {')).toBeLessThan(created);
  });

  it('merges into a session created concurrently and refunds a failed save', () => {
    const handling = insert.slice(0, created);
    expect(handling).toContain("insertErr.code === '23505'");
    expect(handling).toContain(
      'reconcileContactDrafts(existingSession.draft_data'
    );
    expect(handling).toContain('await refundCredits(');
    expect(handling).toContain("Couldn't save the contact draft.");
  });
});
