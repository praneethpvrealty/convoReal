/**
 * A listing title as it should read inside a sentence. Agents end titles
 * with a full stop or a dash ("… JP Nagar 4th Phase."), which a message
 * then wraps in bold and follows with its own punctuation: "*… Phase.*
 * is no longer available." The trailing mark is dropped; the words are
 * the title.
 */
export function listingTitleForMessage(
  title: string | null | undefined
): string {
  return (title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!\-–—]+$/u, '')
    .trim();
}
