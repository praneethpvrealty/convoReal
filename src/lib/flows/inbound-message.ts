import type { ParsedInbound } from './types';

interface InboundMessage {
  id: string;
  type?: string;
  button?: { text?: string | null } | null;
}

export function toFlowInbound(
  message: InboundMessage,
  contentText: string | null,
  interactiveReplyId: string | null,
  inboundText: string
): ParsedInbound {
  const tappedLabel =
    message.type === 'button' ? (message.button?.text ?? null) : null;
  if (interactiveReplyId) {
    return {
      kind: 'interactive_reply',
      reply_id: interactiveReplyId,
      reply_title: tappedLabel ?? contentText ?? '',
      meta_message_id: message.id,
    };
  }
  return {
    kind: 'text',
    text: tappedLabel ?? inboundText,
    meta_message_id: message.id,
  };
}
