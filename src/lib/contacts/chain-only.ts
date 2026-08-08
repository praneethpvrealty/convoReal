/**
 * Chain-only contacts exist to carry a reshare-chain attribution, not
 * as leads of the listing account. Every outbound funnels through
 * sendWhatsAppMessageAndPersist, so that is where the block lives —
 * the consent walk passes `allowChainOnly` to reach its own
 * intermediaries, and nothing else can.
 */
export const CHAIN_ONLY_BLOCKED_MESSAGE =
  'This contact is a re-share chain intermediary and cannot be messaged directly.';

export function isChainOnlyBlockedError(err: unknown): boolean {
  const text =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return text.includes(CHAIN_ONLY_BLOCKED_MESSAGE);
}
