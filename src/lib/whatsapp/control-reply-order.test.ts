import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The webhook has three consumers that will each happily claim an
// inbound reply: the Engine control dispatch, the reply bridge, and the
// owner chatbot. Only the first one knows what a minted button MEANS;
// the other two guess.
//
// The owner chatbot is the one that claimed it, twice, in production:
// the ping goes to the account holder, so the tap comes from the owner,
// whose messages it intercepts by design. Both times it answered
// "couldn't match the client to a contact in your book" and the
// approval never ran. The first fix guarded the bridge instead, on a
// reading of the architecture rather than of the message the owner
// actually got — which is why the order is pinned here now, for every
// interceptor at once, rather than left to whoever edits this next.
const source = readFileSync(
  join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
  'utf8'
);

describe('webhook control-reply dispatch order', () => {
  const controlDispatch = source.indexOf('if (isControlReply && interactiveReplyId) {');
  const bridge = source.indexOf('const bridged = isControlReply');
  const ownerChatbot = source.indexOf('processOwnerChatbotMessage(');

  it('dispatches control payloads before anything can interpret them', () => {
    expect(controlDispatch).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(-1);
    expect(ownerChatbot).toBeGreaterThan(-1);
    expect(controlDispatch).toBeLessThan(bridge);
    expect(controlDispatch).toBeLessThan(ownerChatbot);
  });

  it('still routes owner and consent decisions to their handlers', () => {
    const block = source.slice(controlDispatch, bridge);
    expect(block).toContain('handleOwnerLocationReply');
    expect(block).toContain('handleLocationConsentReply');
  });

  it('leaves the bridge switched off for control payloads', () => {
    expect(source).toContain('const bridged = isControlReply\n    ? false');
  });
});
