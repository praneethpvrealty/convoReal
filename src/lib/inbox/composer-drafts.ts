const STORAGE_PREFIX = 'convoreal:inbox-draft:';

// Fallback only: SSR, private mode, or a storage quota refusal. When
// localStorage works it stays the single source of truth, so a draft
// survives a reload and never goes stale against it.
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(conversationId: string): string {
  if (!conversationId) return '';
  const store = storage();
  if (!store) return memory.get(conversationId) ?? '';
  try {
    return store.getItem(STORAGE_PREFIX + conversationId) ?? '';
  } catch {
    return memory.get(conversationId) ?? '';
  }
}

export function writeDraft(conversationId: string, text: string): void {
  if (!conversationId) return;
  if (!text) {
    clearDraft(conversationId);
    return;
  }
  memory.set(conversationId, text);
  try {
    storage()?.setItem(STORAGE_PREFIX + conversationId, text);
  } catch {
    // Keeps the in-memory copy, which the open tab reads from anyway.
  }
}

export function clearDraft(conversationId: string): void {
  if (!conversationId) return;
  memory.delete(conversationId);
  try {
    storage()?.removeItem(STORAGE_PREFIX + conversationId);
  } catch {
    // Same as above.
  }
}
