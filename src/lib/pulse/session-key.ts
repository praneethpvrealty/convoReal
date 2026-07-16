/**
 * The showcase visitor's session key — same value the Pulse tracker
 * uses (see tracker.ts), persisted in localStorage so every beacon,
 * inquiry, and Ask-chat message from one browser shares an identity.
 * That's what lets a later phone-number reveal (inquiry form, Ask
 * chat) retroactively attribute this session's earlier "Anonymous
 * Guest" events to the real contact.
 */
const SESSION_KEY_STORAGE = 'showcase_session_key';

export function getShowcaseSessionKey(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY_STORAGE);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode) — ephemeral per-call session
    return crypto.randomUUID();
  }
}
