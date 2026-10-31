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
