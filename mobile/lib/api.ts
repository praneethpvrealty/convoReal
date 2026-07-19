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
/**
 * Canonical API origin. If EXPO_PUBLIC_API_BASE_URL points at a domain
 * that 308-redirects (apex → www), fetch follows the redirect but the
 * spec STRIPS the Authorization header on the cross-origin hop — every
 * authenticated call then lands as anonymous and 401s while direct
 * Supabase reads keep working. The first apiFetch detects the final
 * origin from the response and pins it for all later calls.
 */
let resolvedBase: string | null = null;

export function apiBase(): string {
  return resolvedBase ?? ENV.apiBaseUrl;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ApiError(401, 'Not signed in');
  }

  const doFetch = (base: string, token: string) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await doFetch(apiBase(), session.access_token);

  try {
    const finalOrigin = res.url ? new URL(res.url).origin : null;
    if (finalOrigin && finalOrigin !== new URL(apiBase()).origin) {
      resolvedBase = finalOrigin;
      res = await doFetch(resolvedBase, session.access_token);
    }
  } catch {
    // res.url unavailable — keep the configured base.
  }

  // GoTrue can revoke an access token (e.g. a sign-out on another
  // surface) while PostgREST still accepts it, so direct table reads
  // keep working but `auth.getUser()` on the API returns 401. A forced
  // refresh mints a valid token — retry once with it.
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      res = await doFetch(apiBase(), data.session.access_token);
    }
  }

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
  return `${apiBase()}${relativeMediaUrl}`;
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

// ------------------------------------------------------------------
// Google Maps proxies — the key stays on the server; mobile calls the
// same /api/maps/* routes the web autocompletes use. A 501 means no
// GOOGLE_MAPS_API_KEY is configured; callers degrade gracefully.
// ------------------------------------------------------------------

/** UUIDv4 from the getRandomValues polyfill — Places session token. */
export function sessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface PlaceSuggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
}

export function placesAutocomplete(input: string, session: string) {
  return apiFetch<{ suggestions: PlaceSuggestion[] }>(
    `/api/maps/autocomplete?input=${encodeURIComponent(input)}&session=${session}`
  );
}

export function placeDetails(placeId: string, session: string) {
  return apiFetch<{
    place: {
      place_id: string;
      name: string;
      formatted_address: string;
      latitude: number;
      longitude: number;
      sublocality?: string | null;
      city?: string | null;
    };
  }>(`/api/maps/place-details?place_id=${encodeURIComponent(placeId)}&session=${session}`);
}

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

/**
 * Template send — same body the web thread posts
 * (message-thread.tsx): positional body values in template_params,
 * the rendered text in content_text for the local bubble.
 */
export function sendTemplateMessage(opts: {
  conversationId: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  renderedText: string;
}) {
  return apiFetch<{ message?: unknown; error?: string }>('/api/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: opts.conversationId,
      message_type: 'template',
      template_name: opts.templateName,
      template_language: opts.templateLanguage,
      template_params: opts.bodyParams,
      template_message_params: { body: opts.bodyParams },
      content_text: opts.renderedText,
    }),
  });
}
