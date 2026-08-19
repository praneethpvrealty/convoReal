import { signOut } from './auth-store';
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

/** A request that never came back within REQUEST_TIMEOUT_MS. */
export const API_TIMEOUT_STATUS = 408;
/** A request the caller abandoned (e.g. Cancel on a bulk import). */
export const API_CANCELLED_STATUS = 499;

export function isTimeout(err: unknown): boolean {
  return err instanceof ApiError && err.status === API_TIMEOUT_STATUS;
}

export function isCancelled(err: unknown): boolean {
  return err instanceof ApiError && err.status === API_CANCELLED_STATUS;
}

/**
 * How long one call may stall before it is abandoned. React Native's
 * fetch has no default timeout: a connection that is accepted and never
 * answered leaves the promise pending forever — no rejection, so no
 * caller can react. That is how a single contact import left the sheet's
 * spinner running with nothing written server-side.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Uploads get their own budget. A 16 MB video — WhatsApp's ceiling —
 * takes well over 20 seconds on Indian mobile data, so the ordinary
 * timeout would abort a transfer that was progressing fine and leave
 * the agent re-picking the same file.
 */
const UPLOAD_TIMEOUT_MS = 180_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal | null,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  // A caller that gave up between calls (Cancel during a bulk import)
  // hands over a signal that has already fired, so its 'abort' event
  // will never arrive — check the flag as well as subscribing.
  if (callerSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  callerSignal?.addEventListener?.('abort', abortFromCaller);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (callerSignal?.aborted) {
      throw new ApiError(API_CANCELLED_STATUS, 'Cancelled');
    }
    if (controller.signal.aborted) {
      throw new ApiError(
        API_TIMEOUT_STATUS,
        'The server did not respond — check your connection and try again.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.('abort', abortFromCaller);
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
  const { signal: callerSignal, ...rest } = init ?? {};
  const method = (rest.method ?? 'GET').toUpperCase();
  // Replaying a body is only safe when the call has no side effect.
  const isIdempotent = method === 'GET' || method === 'HEAD';

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ApiError(401, 'Not signed in');
  }

  // A multipart body carries its own content type, including the
  // boundary the runtime generates. Naming it ourselves produces a
  // header with no boundary, and the server parses an empty form.
  const isMultipart =
    typeof FormData !== 'undefined' && rest.body instanceof FormData;

  const doFetch = (base: string, token: string) =>
    fetchWithTimeout(
      `${base}${path}`,
      {
        ...rest,
        headers: {
          ...(isMultipart ? null : { 'Content-Type': 'application/json' }),
          ...rest.headers,
          Authorization: `Bearer ${token}`,
        },
      },
      callerSignal,
      isMultipart ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    );

  let res = await doFetch(apiBase(), session.access_token);

  try {
    const finalOrigin = res.url ? new URL(res.url).origin : null;
    if (finalOrigin && finalOrigin !== new URL(apiBase()).origin) {
      // Pin the real origin for every later call either way.
      resolvedBase = finalOrigin;
      // Re-issuing a POST here would send the body twice — the redirected
      // hop may already have reached the server, so a replay can create
      // the record again. Only idempotent calls are repeated; a mutating
      // one that lost its Authorization header on the hop comes back 401
      // and is retried below, which is safe because a 401 means nothing
      // ran.
      if (isIdempotent) res = await doFetch(resolvedBase, session.access_token);
    }
  } catch {
    // res.url unavailable — keep the configured base.
  }

  // GoTrue can revoke an access token (e.g. a sign-out on another
  // surface) while PostgREST still accepts it, so direct table reads
  // keep working but `auth.getUser()` on the API returns 401. A forced
  // refresh mints a valid token — retry once with it.
  let token = session.access_token;
  let refreshDied = false;
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      token = data.session.access_token;
      res = await doFetch(apiBase(), token);
    } else {
      refreshDied = true;
    }
  }

  // Deterministic redirect fallback: some RN fetch stacks don't expose
  // the final URL, so the origin detection above can miss the apex →
  // www 308 (which strips Authorization). If we're still 401 on an
  // apex base, try the www variant directly and pin it when it works.
  if (res.status === 401 && !resolvedBase) {
    const u = new URL(ENV.apiBaseUrl);
    if (!u.hostname.startsWith('www.')) {
      u.hostname = `www.${u.hostname}`;
      const wwwRes = await doFetch(u.origin, token);
      if (wwwRes.status !== 401) {
        resolvedBase = u.origin;
        res = wwwRes;
      }
    }
  }

  // Still 401 and the refresh token is dead: the stored session was
  // revoked (a sign-out on another surface — e.g. Den ↔ staff
  // switching). Reads keep working until the cached token expires,
  // which hides the breakage — recover by forcing a clean sign-in.
  if (res.status === 401 && refreshDied) {
    await signOut();
    throw new ApiError(401, 'Session expired — please sign in again.');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  // 204 No Content (e.g. DELETE /api/properties/[id]) has an empty body —
  // res.json() would throw and turn a successful call into an error dialog.
  if (res.status === 204) return undefined as T;
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

/**
 * Permanently delete the caller's login. An owner also takes the
 * workspace and all of its data; teammates are moved to their own
 * fresh workspaces first. Irreversible — always confirm before calling.
 */
export function deleteAccount() {
  return apiFetch<{ ok: boolean; workspaceDeleted: boolean }>('/api/account/delete', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
}

/** Register this device's Expo push token so the backend can push to it. */
export function registerDevice(token: string, platform: string) {
  return apiFetch<{ data?: { ok: boolean }; error?: string }>(
    '/api/notifications/register-device',
    {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    }
  );
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

/**
 * AI draft replies for a conversation — POST /api/whatsapp/suggest-replies.
 * Returns 2-3 short reply options built from the recent messages; the
 * agent taps one to insert it into the composer. Empty array when the
 * server has no Gemini key or there's nothing to reply to.
 */
export function suggestReplies(conversationId: string) {
  return apiFetch<{ suggestions: string[] }>('/api/whatsapp/suggest-replies', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId }),
  })
}

/** Contract of POST /api/whatsapp/send (src/app/api/whatsapp/send/route.ts).
 *  `replyToMessageId` quotes an earlier message in the same thread — the
 *  server resolves it to Meta's wamid so WhatsApp renders the quote. */
export function sendTextMessage(
  conversationId: string,
  text: string,
  replyToMessageId?: string
) {
  return apiFetch<{ message?: unknown; error?: string }>('/api/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: conversationId,
      message_type: 'text',
      content_text: text,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }),
  });
}

/** Persist a personal WhatsApp hand-off to a journey item for timeline traceability. */
export function logPersonalWhatsAppJourneySend(args: {
  itemId: string;
  message: string;
  source: 'web' | 'mobile';
}) {
  return apiFetch<{
    ok: boolean;
    duplicate: boolean;
    eventId: string | null;
  }>(
    '/api/journey/events',
    {
      method: 'POST',
      body: JSON.stringify({
        item_id: args.itemId,
        message: args.message,
        source: args.source,
      }),
    }
  );
}

/**
 * Send into a WhatsApp group — POST /api/whatsapp/groups/{id}/send.
 *
 * A group thread cannot use /api/whatsapp/send: that route resolves the
 * conversation's contact, and a group conversation has none. There is
 * also no 24-hour window to check here, and no template fallback to
 * offer if one were closed.
 */
export function sendGroupMessage(opts: {
  groupId: string;
  text?: string;
  media?: StagedMedia;
  caption?: string;
  replyToMessageId?: string;
}) {
  return apiFetch<{ success: boolean }>(
    `/api/whatsapp/groups/${encodeURIComponent(opts.groupId)}/send`,
    {
      method: 'POST',
      body: JSON.stringify(
        opts.media
          ? {
              message_type: 'media',
              media_url: opts.media.media_url,
              media_kind: opts.media.media_kind,
              media_filename: opts.media.filename,
              ...(opts.caption ? { content_text: opts.caption } : {}),
              ...(opts.replyToMessageId
                ? { reply_to_message_id: opts.replyToMessageId }
                : {}),
            }
          : {
              message_type: 'text',
              content_text: opts.text,
              ...(opts.replyToMessageId
                ? { reply_to_message_id: opts.replyToMessageId }
                : {}),
            }
      ),
    }
  );
}

/**
 * Engine-local message state — PATCH /api/whatsapp/messages/{id}.
 *
 * 'pin'/'unpin' mark a message for the team; 'hide'/'restore' control
 * whether it appears in this account's inbox. None of them touch the
 * contact's copy: WhatsApp offers no way to recall a sent message, and
 * no way to pin one outside a group.
 */
export function setMessageState(
  messageId: string,
  action: 'pin' | 'unpin' | 'hide' | 'restore'
) {
  return apiFetch<{ data: { id: string; action: string } }>(
    `/api/whatsapp/messages/${encodeURIComponent(messageId)}`,
    { method: 'PATCH', body: JSON.stringify({ action }) }
  );
}

export interface StagedMedia {
  media_url: string;
  media_kind: 'image' | 'video' | 'audio' | 'document';
  filename: string | null;
  mime_type: string;
  size: number;
}

/**
 * Stage an attachment for sending — POST /api/whatsapp/media/upload.
 *
 * Streams the file straight off disk as multipart rather than reading it
 * into a base64 string first: a 16 MB video becomes ~21 MB of JavaScript
 * string that way, which is how a phone runs out of memory mid-send.
 * The server checks type and size against WhatsApp's own caps and hands
 * back the storage path to pass to sendMediaMessage.
 */
export async function uploadChatMedia(file: {
  uri: string;
  name: string;
  mimeType: string;
}): Promise<StagedMedia> {
  const form = new FormData();
  // React Native's FormData takes this shape for a file on disk; the
  // cast is the standard workaround for the DOM lib's File-only type.
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);

  const { data } = await apiFetch<{ data: StagedMedia }>(
    '/api/whatsapp/media/upload',
    {
      method: 'POST',
      body: form,
    }
  );
  return data;
}

/**
 * Send a staged attachment — POST /api/whatsapp/send with
 * message_type 'media'. `caption` is ignored by WhatsApp on audio.
 */
export function sendMediaMessage(opts: {
  conversationId: string;
  media: StagedMedia;
  caption?: string;
  replyToMessageId?: string;
}) {
  return apiFetch<{ success: boolean }>('/api/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: opts.conversationId,
      message_type: 'media',
      media_url: opts.media.media_url,
      media_kind: opts.media.media_kind,
      media_filename: opts.media.filename,
      ...(opts.caption ? { content_text: opts.caption } : {}),
      ...(opts.replyToMessageId
        ? { reply_to_message_id: opts.replyToMessageId }
        : {}),
    }),
  });
}

/**
 * Leave (or withdraw) the agent's reaction on a message — POST
 * /api/whatsapp/react. An empty `emoji` removes it; anything else
 * replaces whatever the agent had there, matching WhatsApp's own
 * one-reaction-per-person rule.
 */
export function reactToMessage(messageId: string, emoji: string) {
  return apiFetch<{ success: boolean }>('/api/whatsapp/react', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, emoji }),
  });
}

/**
 * Send one message's text on to other contacts — POST
 * /api/whatsapp/forward. Each recipient gets it in their own thread from
 * the business number; the per-contact outcome comes back in `results`
 * so a closed 24-hour window reads differently from a failed send.
 */
export function forwardMessage(messageId: string, contactIds: string[]) {
  return apiFetch<{
    data: {
      results: {
        contact_id: string;
        name: string;
        sent: boolean;
        window_closed?: boolean;
        error?: string;
      }[];
    };
  }>('/api/whatsapp/forward', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, contact_ids: contactIds }),
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
