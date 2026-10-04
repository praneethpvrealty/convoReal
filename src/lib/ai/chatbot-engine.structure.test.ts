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

describe('[INB-025] starting a contact draft', () => {
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

  it('merges into a session created concurrently through the compare-and-swap mutation and refunds a failed save', () => {
    const handling = insert.slice(0, created);
    expect(handling).toContain("insertErr.code === '23505'");
    expect(handling).toContain('await mutateContactDraft(');
    expect(handling).not.toContain('overwriteContactDraftSession(');
    expect(handling).toContain("if (mutation?.status !== 'ok') {");
    expect(handling.indexOf("if (mutation?.status !== 'ok') {")).toBeLessThan(
      handling.indexOf('`📝 *Contact Drafts Updated:*`')
    );
    expect(handling).toContain('await refundCredits(');
    expect(handling).toContain("Couldn't save the contact draft.");
  });
});

describe('the external text correction', () => {
  it('charges once, on the first attempt that reaches the AI re-read, never per retry', () => {
    const externalFlow = source.slice(
      source.indexOf('export async function processExternalListingMessage(')
    );
    const correction = externalFlow.slice(
      externalFlow.lastIndexOf('if (cleanedText) {')
    );
    const loop = correction.indexOf('await mutatePropertyDraft(');
    expect(correction.slice(0, loop)).not.toContain('softBurn(');
    expect(correction.slice(0, loop)).toContain('let charged = false;');
    const guardedBurn = correction.indexOf(
      "if (!charged) {\n          charged = true;\n          await softBurn(accountId, 'chatbot_classify');\n        }"
    );
    expect(guardedBurn).toBeGreaterThan(loop);
    expect(guardedBurn).toBeLessThan(
      correction.indexOf('await updateListingDraft(')
    );
    expect(correction.match(/softBurn\(/g)).toHaveLength(1);
  });
});
