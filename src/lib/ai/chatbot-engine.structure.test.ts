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

describe('[INB-024] an external listing session on the owner number', () => {
  it('is handed to the external flow before the owner flow reads it as its own draft', () => {
    const ownerFlow = source.slice(
      source.indexOf('export async function processOwnerChatbotMessage('),
      source.indexOf('export async function processExternalListingMessage(')
    );
    const handoff = ownerFlow.indexOf(
      "if (propSessionData?.session_mode === 'external') {\n    return processExternalListingMessage("
    );
    expect(handoff).toBeGreaterThan(-1);
    expect(handoff).toBeLessThan(
      ownerFlow.indexOf('let propSession = propSessionData;')
    );
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
