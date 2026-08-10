import type { ChatTurn } from './engine';

/**
 * Request parsing shared by the three helper chat routes. Every
 * surface accepts the same body — message, pathname, a short history
 * — and every surface must bound it the same way, so the limits live
 * once here rather than in each route.
 */

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_PATHNAME_CHARS = 100;

export interface ParsedChatRequest {
  message: string;
  pathname: string;
  history: ChatTurn[];
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is ChatTurn =>
        !!t &&
        typeof t === 'object' &&
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.text === 'string'
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_MESSAGE_CHARS) }));
}

export function readChatRequest(
  body: unknown
): ParsedChatRequest | { error: string } {
  const b = (body ?? {}) as {
    message?: unknown;
    pathname?: unknown;
    history?: unknown;
  };
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return { error: 'message must be 1-500 characters' };
  }
  return {
    message,
    pathname:
      typeof b.pathname === 'string'
        ? b.pathname.slice(0, MAX_PATHNAME_CHARS)
        : '/',
    history: sanitizeHistory(b.history),
  };
}
