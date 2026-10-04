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

  it('absorbs both cards into a session created concurrently, within the account, through the compare-and-swap mutation', () => {
    const handling = insert.slice(0, created);
    expect(handling).toContain("insertErr.code === '23505'");
    expect(handling).toMatch(
      /findContactDraftSession\(\s*supabaseAdmin\(\),\s*contactRecord\.id,\s*accountId\s*\)/
    );
    expect(handling).toContain('await mutateContactDraft(');
    expect(handling).toMatch(/},\s*accountId\s*\)\s*: null;/);
    expect(handling).toContain('absorbContactDrafts(');
    expect(handling).not.toContain('reconcileContactDrafts(');
    expect(handling).not.toContain('previous one discarded');
    expect(handling).not.toContain('overwriteContactDraftSession(');
    expect(handling).toContain("if (mutation?.status !== 'ok') {");
    expect(handling.indexOf("if (mutation?.status !== 'ok') {")).toBeLessThan(
      handling.indexOf('`📝 *Contact Drafts Updated:*`')
    );
    expect(handling).toContain("Couldn't save the contact draft.");
  });

  it('refunds a failed save only when the parse was actually charged', () => {
    const flow = source.slice(
      source.lastIndexOf(
        "if (classification === 'contact') {",
        source.indexOf('await insertContactDraftSession(')
      )
    );
    expect(flow).toContain(
      "const parseBurn = await gatedBurnReceipt(accountId, 'contact_parse');"
    );
    expect(flow).toContain('parseCharged = parseBurn.charged;');
    const handling = insert.slice(0, created);
    expect(handling).toMatch(/if \(parseCharged\) \{\s*await refundCredits\(/);
    expect(handling.match(/refundCredits\(/g)).toHaveLength(1);
  });

  it('reports no charge when billing fails open', () => {
    const receipt = source.slice(
      source.indexOf('async function gatedBurnReceipt(')
    );
    const catchBlock = receipt.slice(receipt.indexOf('} catch (err) {'));
    expect(catchBlock).toContain('return { allowed: true, charged: false };');
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
    expect(handoff).toBeLessThan(ownerFlow.indexOf('const cleanedText ='));
    const beforeHandoff = ownerFlow.slice(
      ownerFlow.indexOf('let propSession = propSessionData;'),
      handoff
    );
    expect(beforeHandoff).not.toMatch(/propSession[.?)]/);
  });

  it('hands a voice correction over as its transcript', () => {
    const ownerFlow = source.slice(
      source.indexOf('export async function processOwnerChatbotMessage('),
      source.indexOf('export async function processExternalListingMessage(')
    );
    const handoff = ownerFlow.indexOf(
      "if (propSessionData?.session_mode === 'external') {"
    );
    expect(
      ownerFlow.indexOf('spokenText = await transcribeVoiceNote(')
    ).toBeLessThan(handoff);
    expect(ownerFlow.slice(handoff)).toMatch(
      /^if \(propSessionData\?\.session_mode === 'external'\) \{\s*return processExternalListingMessage\(\s*message,\s*spokenText \|\| contentText,/
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
