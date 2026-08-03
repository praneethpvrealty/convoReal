// The invite that moves a contact off an agent's personal WhatsApp and
// onto the Engine's number. Mirrors the web's
// src/components/contacts/move-to-engine-dialog.tsx — same wa.me link,
// same START ALERTS payload, so a contact invited from either surface
// arrives the same way.
//
// Pure module (no I/O, no Expo imports) so the copy is unit tested; the
// screen fetches /api/whatsapp/engine-number itself.

export interface EngineNumber {
  phone: string;
  /** Sandbox tenants need a #code so the first message routes to them. */
  prefix: string;
  sandbox: boolean;
}

/** The link the CONTACT taps. Pointed at the Engine number, not theirs. */
export function buildEngineInviteLink(engine: EngineNumber): string {
  const digits = engine.phone.replace(/\D/g, '');
  const text = encodeURIComponent(`${engine.prefix}START ALERTS`);
  return `https://wa.me/${digits}?text=${text}`;
}

export function buildEngineInvite(engine: EngineNumber, contactName: string): string {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  return (
    `Hi ${firstName} 👋\n\n` +
    `I've saved what you're looking for. You'll hear from me the moment something matching comes up — ` +
    `those updates come from our listings number so nothing gets lost.\n\n` +
    `Tap here once to switch them on:\n${buildEngineInviteLink(engine)}`
  );
}
