// The buttons a sent template bubble should show. A message row keeps
// only template_name, so the thread looks the account's template rows up
// by name and matches the right language variant against the rendered
// body. Dependency-free: the mobile thread imports it through @shared/.

export interface TemplateBubbleRow {
  name: string;
  language?: string | null;
  status?: string | null;
  body_text?: string | null;
  buttons?: { type: string; text: string }[] | null;
}

export interface TemplateBubbleMessage {
  template_name?: string | null;
  content_text?: string | null;
}

export type TemplateBubbleButtonKind = 'url' | 'reply' | 'call' | 'copy';

export interface TemplateBubbleButton {
  kind: TemplateBubbleButtonKind;
  label: string;
}

/** Distinct template names in a thread, for one `in()` read. */
export function templateNamesIn(messages: TemplateBubbleMessage[]): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    const name = message.template_name?.trim();
    if (name) names.add(name);
  }
  return [...names].sort();
}

function literalPrefix(body: string | null | undefined): string {
  const text = body ?? '';
  const at = text.indexOf('{{');
  return (at === -1 ? text : text.slice(0, at)).trim();
}

/**
 * The template row a sent message was rendered from. Several language
 * variants share a name, so the one whose literal opening the stored body
 * starts with wins; an approved row breaks a tie, so a draft never
 * relabels a live send.
 */
export function matchTemplateRow<T extends TemplateBubbleRow>(
  rows: T[],
  message: TemplateBubbleMessage
): T | null {
  const name = message.template_name?.trim().toLowerCase();
  if (!name) return null;
  const candidates = rows.filter(
    (row) => row.name.trim().toLowerCase() === name
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const body = (message.content_text ?? '').trim();
  let best: T | null = null;
  let bestScore = -1;
  for (const row of candidates) {
    const prefix = literalPrefix(row.body_text);
    const matches = prefix.length > 0 && body.startsWith(prefix);
    const approved = (row.status ?? '').toUpperCase() === 'APPROVED' ? 1 : 0;
    const score = (matches ? prefix.length * 2 : 0) + approved;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

export function templateBubbleButtons(
  row: TemplateBubbleRow | null | undefined
): TemplateBubbleButton[] {
  return (row?.buttons ?? [])
    .filter((button) => button.text?.trim())
    .map((button) => {
      const type = button.type.toUpperCase();
      const kind: TemplateBubbleButtonKind =
        type === 'URL'
          ? 'url'
          : type === 'PHONE_NUMBER'
            ? 'call'
            : type === 'COPY_CODE'
              ? 'copy'
              : 'reply';
      return { kind, label: button.text.trim() };
    });
}
