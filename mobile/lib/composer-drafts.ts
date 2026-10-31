/**
 * Unsent composer text per conversation, kept in memory for the app
 * session so leaving a thread and coming back finds the draft where it
 * was. Cleared on sign-out with the rest of the signed-in state.
 */
const drafts = new Map<string, string>();

export function composerDraft(conversationId: string): string {
  return drafts.get(conversationId) ?? '';
}

export function saveComposerDraft(conversationId: string, text: string) {
  if (text.trim()) drafts.set(conversationId, text);
  else drafts.delete(conversationId);
}

export function clearComposerDrafts() {
  drafts.clear();
}
