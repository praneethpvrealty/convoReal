/**
 * Google OAuth + YouTube Data API v3 helpers.
 *
 * Same named-params + typed-error convention as src/lib/meta-ads/client.ts —
 * every function takes one options object, and Google error responses are
 * parsed into a friendly message rather than surfaced as a raw fetch
 * failure. All calls are server-side only (routes and the queue worker);
 * nothing here may be imported into client components.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos';

// youtube.upload alone cannot list the user's channel — youtube.readonly
// is needed for the channels.list(mine=true) identity call after connect.
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

interface GoogleErrorResponse {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
  error_description?: string;
}

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

/** True for Google's "token expired/revoked/invalid" family of errors —
 *  the connection needs a re-consent, not a retry. */
export function isAuthError(err: unknown): boolean {
  return (
    err instanceof YouTubeApiError &&
    (err.status === 401 ||
      err.reason === 'invalid_grant' ||
      err.reason === 'authError')
  );
}

async function throwGoogleError(
  response: Response,
  fallback: string
): Promise<never> {
  let message = fallback;
  let reason: string | undefined;

  try {
    const data = (await response.json()) as GoogleErrorResponse;
    if (typeof data.error === 'string') {
      // OAuth token endpoint shape: { error, error_description }
      reason = data.error;
      message = data.error_description || data.error;
    } else if (data.error?.message) {
      // Data API shape: { error: { code, message, errors: [{reason}] } }
      message = data.error.message;
      reason = data.error.errors?.[0]?.reason;
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }

  throw new YouTubeApiError(message, response.status, reason);
}

// ── OAuth ────────────────────────────────────────────────────────────

/** Consent-dialog URL. access_type=offline + prompt=consent guarantees
 *  Google returns a refresh token on every connect, not just the first. */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok)
    await throwGoogleError(res, 'Failed to exchange authorization code');
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok)
    await throwGoogleError(res, 'Failed to refresh the YouTube access token');
  return (await res.json()) as GoogleTokenResponse;
}

/** Revokes a refresh (or access) token. Google returns 200 for
 *  already-revoked tokens; callers treat failures as best-effort. */
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  if (!res.ok)
    await throwGoogleError(res, 'Failed to revoke the YouTube token');
}

// ── Channel identity ─────────────────────────────────────────────────

export interface YouTubeChannel {
  id: string;
  title: string;
}

export async function getMyChannel(
  accessToken: string
): Promise<YouTubeChannel | null> {
  const url = new URL(`${YOUTUBE_API_BASE}/channels`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok)
    await throwGoogleError(res, 'Failed to load your YouTube channel');
  const data = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  };
  const item = data.items?.[0];
  if (!item) return null;
  return { id: item.id, title: item.snippet?.title || 'YouTube channel' };
}

// ── Upload ───────────────────────────────────────────────────────────

/**
 * Uploads video bytes as an Unlisted video via the resumable protocol
 * (initiate → PUT bytes) and returns the new video id. Listing videos
 * are ~2-3MB, so a single PUT suffices — no chunking/resume loop.
 */
export async function uploadVideo(opts: {
  accessToken: string;
  bytes: Buffer;
  title: string;
  description: string;
}): Promise<string> {
  const url = new URL(YOUTUBE_UPLOAD_URL);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('part', 'snippet,status');

  const initRes = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(opts.bytes.length),
    },
    body: JSON.stringify({
      snippet: { title: opts.title, description: opts.description },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    }),
  });
  if (!initRes.ok)
    await throwGoogleError(initRes, 'Failed to start the YouTube upload');

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new YouTubeApiError(
      'YouTube did not return an upload session URL',
      500
    );
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: new Uint8Array(opts.bytes),
  });
  if (!putRes.ok) await throwGoogleError(putRes, 'YouTube upload failed');

  const data = (await putRes.json()) as { id?: string };
  if (!data.id) {
    throw new YouTubeApiError('YouTube upload returned no video id', 500);
  }
  return data.id;
}
