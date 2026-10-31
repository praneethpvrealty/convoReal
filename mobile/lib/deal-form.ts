export function dealFormMissing({
  title,
  hasContact,
  hasStage,
  lostReasonMissing,
  creating,
}: {
  title: string;
  hasContact: boolean;
  hasStage: boolean;
  lostReasonMissing: boolean;
  creating: boolean;
}): string | null {
  const needs: string[] = [];
  if (!title.trim()) needs.push('a title');
  if (!hasContact) needs.push('a contact');
  if (!hasStage) needs.push('a stage');
  if (needs.length > 0) {
    const list =
      needs.length === 1
        ? needs[0]
        : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`;
    return `Add ${list} to ${creating ? 'create' : 'save'} the deal.`;
  }
  if (lostReasonMissing) return 'Pick why the deal was lost.';
  return null;
}
