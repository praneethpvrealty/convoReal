import { ENV } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Call a Next.js API route with the current Supabase access token as
 * `Authorization: Bearer` — the transport the web repo's
 * `src/lib/supabase/server.ts` accepts alongside cookies. supabase-js
 * refreshes the session under us; always read it at call time, never
 * cache the token.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ApiError(401, 'Not signed in');
  }

  const res = await fetch(`${ENV.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/**
 * `messages.media_url` stores a RELATIVE proxy path
 * (`/api/whatsapp/media/{mediaId}`) — resolve it against the web app.
 * The proxy is auth-gated, so fetch with `authHeaders()`; expired Meta
 * media returns 404 MEDIA_UNAVAILABLE and should render a placeholder.
 */
export function absoluteMediaUrl(relativeMediaUrl: string): string {
  return `${ENV.apiBaseUrl}${relativeMediaUrl}`;
}

/** Bearer headers for non-JSON requests (e.g. <Image> media fetches). */
export async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// ------------------------------------------------------------------
// Typed wrappers for the routes the app uses today
// ------------------------------------------------------------------

/** Contract of POST /api/whatsapp/send (src/app/api/whatsapp/send/route.ts). */
export function sendTextMessage(conversationId: string, text: string) {
  return apiFetch<{ message?: unknown; error?: string }>('/api/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: conversationId,
      message_type: 'text',
      content_text: text,
    }),
  });
}
