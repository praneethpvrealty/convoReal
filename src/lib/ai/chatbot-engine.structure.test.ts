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
    const refund = handling.slice(handling.indexOf('await refundCredits('));
    expect(refund.slice(0, refund.indexOf('const reply'))).not.toContain(
      '.catch(() => undefined)'
    );
    expect(refund).toContain('reconcile manually');
  });

  it('announces the persisted row and re-sends while another handler has moved it on', () => {
    const announcer = source.slice(
      source.indexOf('async function announceLatestContactDraft('),
      source.indexOf('export async function processOwnerChatbotMessage(')
    );
    expect(announcer).toContain('for (;;) {');
    expect(announcer).not.toMatch(/attempt < \d/);
    expect(announcer.indexOf('await sendContactDraftPreview(')).toBeLessThan(
      announcer.indexOf('await readCurrentContactDraft(')
    );
    expect(announcer).toContain('if (latest === undefined) {');
    const unverified = announcer.slice(
      announcer.indexOf('if (latest === undefined) {'),
      announcer.indexOf('if (!latest || latest.updated_at === row.updated_at)')
    );
    expect(unverified).toContain(
      "I couldn't check that this draft is the latest."
    );
    expect(unverified).toContain('await sendTextMessage(');
    expect(unverified).not.toContain('sendInteractiveButtons(');

    const reader = source.slice(
      source.indexOf('async function readCurrentContactDraft('),
      source.indexOf('async function announceLatestContactDraft(')
    );
    expect(reader).toContain('if (!error) return data;');
    expect(reader).toContain('return undefined;');
    expect(announcer).toContain(
      'if (!latest || latest.updated_at === row.updated_at) return;'
    );

    const handling = insert.slice(0, created);
    expect(handling).toMatch(
      /announceLatestContactDraft\([\s\S]*?`📝 \*Contact Drafts Updated:\*`,\s*mutation\.row,/
    );
    expect(handling).not.toContain('mutation.next');

    const createdPath = insert.slice(
      insert.indexOf('const createdSession = await readCurrentContactDraft(')
    );
    expect(createdPath).toMatch(
      /^const createdSession = await readCurrentContactDraft\(\s*contactRecord\.id,\s*accountId\s*\);\s*if \(createdSession\) \{\s*await announceLatestContactDraft\(/
    );
    const afterRead = createdPath.slice(
      0,
      createdPath.indexOf('} catch (err) {')
    );
    expect(afterRead).toContain('} else if (createdSession === undefined) {');
    expect(afterRead).toContain("couldn't load it to show you.");
    expect(afterRead).not.toContain('parsedContainer');
    expect(afterRead.match(/sendContactDraftPreview\(/g)).toBeNull();
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

describe('[INB-026] confirming a contact draft', () => {
  it('builds the Confirm button from the version the card shows', () => {
    expect(source).not.toContain("id: 'confirm_contact'");
    expect(source).toMatch(
      /id: contactConfirmButtonId\(\s*contactCardVersion\(version, resolvedContainer\)\s*\)/
    );
  });

  it('passes a version to every contact preview', () => {
    const calls = source.split('await sendContactDraftPreview(').slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const args = call.slice(0, call.indexOf(');'));
      expect(args).toMatch(
        /accountId,\s*(version|row\.updated_at|contactSession\.updated_at)\s*$/
      );
    }
  });

  it('sends no card when the draft write fails, so no card can confirm an unsaved draft', () => {
    const writes = source
      .split('const version = await overwriteContactDraftSession(')
      .slice(1);
    expect(writes).toHaveLength(4);
    for (const write of writes) {
      const afterWrite = write.slice(write.indexOf(');') + 2);
      expect(afterWrite).toMatch(
        /^\s*if \(!version\) \{\s*return await sendContactDraftSaveFailed\(/
      );
      expect(
        afterWrite.indexOf('return await sendContactDraftSaveFailed(')
      ).toBeLessThan(afterWrite.indexOf('await sendContactDraftPreview('));
    }
    const preview = source.slice(
      source.indexOf('async function sendContactDraftPreview('),
      source.indexOf(
        '): Promise<void> {',
        source.indexOf('async function sendContactDraftPreview(')
      )
    );
    expect(preview).toMatch(/version: string\s*$/);
  });

  it('refuses a stale card before saving and shows the current draft instead', () => {
    const handler = source.slice(
      source.indexOf(
        'const confirmRequest = readContactConfirm(buttonId, lowerText);'
      )
    );
    const resolved = handler.indexOf(
      'await resolveExactContactLinks(container, accountId)'
    );
    const staleCheck = handler.search(
      /confirmRequest\.version !==\s*contactCardVersion\(contactSession\.updated_at, confirmedContainer\)/
    );
    const save = handler.indexOf('if (confirmRequest) {');
    expect(resolved).toBeGreaterThan(-1);
    expect(resolved).toBeLessThan(staleCheck);
    expect(staleCheck).toBeGreaterThan(-1);
    expect(
      handler.slice(
        save,
        handler.indexOf('const { isValid, missingFields }', save)
      )
    ).not.toContain('resolveExactContactLinks(');
    expect(staleCheck).toBeLessThan(save);
    expect(handler.slice(staleCheck, save)).toContain(
      'This draft changed after that card'
    );
    expect(handler.slice(staleCheck, save)).toContain('return true;');
  });
});
