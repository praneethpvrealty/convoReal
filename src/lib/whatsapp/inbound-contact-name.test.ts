import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// CONVOREAL-WORKER-1: a production inbound message arrived with a
// contacts entry that carried wa_id but no profile object, so
// `contact.profile.name` threw and the whole message was dropped
// unanswered. The interface declared profile as required, which is why
// nothing caught it at compile time.

describe('an inbound contact without a profile', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );

  it('reads the profile name defensively', () => {
    expect(source).toContain("contact.profile?.name ?? ''");
    expect(source).not.toContain('contact.profile.name;');
  });

  it('types profile as optional so the guard cannot be dropped again', () => {
    expect(source).toContain('profile?: { name?: string };');
    expect(source).not.toContain('profile: { name: string };');
  });
});

describe('the fallback an empty name lands on', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );

  it('only adopts a profile name when there is one', () => {
    // findOrCreateContact already treats a blank name as "leave the
    // stored name alone", so '' is the value that preserves behaviour
    // for a sender WhatsApp gave us no display name for.
    expect(source).toContain('if (name && name !== existingContact.name)');
  });
});
