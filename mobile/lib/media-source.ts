// Where a message's media actually lives.
//
// `messages.media_url` holds one of two very different things:
//
//   inbound  — "/api/whatsapp/media/<mediaId>", the auth-gated proxy that
//              fetches a fresh Meta CDN URL per request;
//   outbound — a Supabase Storage reference for the attachment the agent
//              sent, public because Meta has to fetch it by link.
//
// They need opposite handling: the proxy needs a bearer token and the
// app's own origin, storage needs neither and is on a different host.
// Before agents could send media every row was inbound, so the thread
// prefixed everything with the API base — which would have turned an
// outbound photo into a broken URL.

import { apiBase } from './api';
import { storagePublicUrl } from './storage-url';

export type MediaSource =
  /** Auth-gated proxy: fetch with bearer headers. */
  | { kind: 'proxy'; uri: string }
  /** Public object: no headers, and none should be sent. */
  | { kind: 'public'; uri: string };

/** The proxy path the webhook writes for inbound media. */
const PROXY_PREFIX = '/api/whatsapp/media/';

/**
 * Resolve a stored `media_url` to something fetchable, or null when the
 * row carries no media at all.
 */
export function mediaSource(mediaUrl: string | null | undefined): MediaSource | null {
  if (!mediaUrl) return null;
  const value = mediaUrl.trim();
  if (!value) return null;

  if (value.startsWith(PROXY_PREFIX)) {
    return { kind: 'proxy', uri: `${apiBase()}${value}` };
  }

  // Any other relative path is still ours — an older row, or a proxy
  // path written before the prefix settled. Treating it as public would
  // point it at the Supabase host, where it does not exist.
  if (value.startsWith('/')) {
    return { kind: 'proxy', uri: `${apiBase()}${value}` };
  }

  const resolved = storagePublicUrl(value);
  return resolved ? { kind: 'public', uri: resolved } : null;
}
