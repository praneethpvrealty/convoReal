/**
 * Meta Marketing API (Graph API, ads endpoints) helpers.
 *
 * Same named-params + typed-error convention as src/lib/whatsapp/meta-api.ts
 * for the WhatsApp Cloud API — every function takes one options object,
 * and Meta error responses are parsed into a friendly message rather than
 * surfaced as a raw fetch failure.
 *
 * NOTE: META_API_VERSION is duplicated from meta-api.ts rather than
 * imported — these are independent Graph API surfaces (WhatsApp Cloud
 * API vs. Marketing API) that may reasonably need to pin different
 * versions over time. Keep both in sync unless a reason not to appears.
 */

export const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    type?: string
    error_user_title?: string
    error_user_msg?: string
  }
}

export class MetaAdsApiError extends Error {
  readonly code: number
  readonly subcode?: number
  readonly userMessage: string

  constructor(message: string, code: number, subcode: number | undefined, userMessage: string) {
    super(message)
    this.name = 'MetaAdsApiError'
    this.code = code
    this.subcode = subcode
    this.userMessage = userMessage
  }
}

/** True for Meta's "access token expired/invalid" family of error codes. */
export function isTokenError(err: unknown): boolean {
  return err instanceof MetaAdsApiError && (err.code === 190 || err.code === 102)
}

async function throwMetaAdsError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code = response.status
  let subcode: number | undefined
  let userMessage = fallback

  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) {
      message = data.error.message
      code = data.error.code ?? code
      subcode = data.error.error_subcode
      userMessage = data.error.error_user_msg || data.error.error_user_title || message
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }

  throw new MetaAdsApiError(message, code, subcode, userMessage)
}

interface GraphRequestOptions {
  accessToken: string
  method?: 'GET' | 'POST' | 'DELETE'
  /** Sent as a JSON body for POST, or query params for GET. */
  params?: Record<string, unknown>
}

/**
 * Low-level Graph API call. GET requests serialize `params` into the
 * query string (Meta's Marketing API accepts JSON-encoded values for
 * nested params, e.g. `targeting`, as query string values too — the
 * caller passes already-JSON-stringified values for nested objects
 * when using GET; POST sends `params` as a JSON body directly).
 */
export async function graphRequest<T>(path: string, opts: GraphRequestOptions): Promise<T> {
  const { accessToken, method = 'GET', params = {} } = opts
  const url = new URL(`${META_API_BASE}/${path.replace(/^\//, '')}`)

  if (method === 'GET') {
    url.searchParams.set('access_token', accessToken)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    const res = await fetch(url.toString())
    if (!res.ok) await throwMetaAdsError(res, `Meta API GET ${path} failed`)
    return (await res.json()) as T
  }

  if (method === 'DELETE') {
    url.searchParams.set('access_token', accessToken)
    const res = await fetch(url.toString(), { method: 'DELETE' })
    if (!res.ok) await throwMetaAdsError(res, `Meta API DELETE ${path} failed`)
    return (await res.json()) as T
  }

  // POST — access_token goes in the body alongside the rest of params.
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      access_token: accessToken,
      ...Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
      ),
    }),
  })
  if (!res.ok) await throwMetaAdsError(res, `Meta API POST ${path} failed`)
  return (await res.json()) as T
}

// ── OAuth token exchange ─────────────────────────────────────────────

export interface MetaTokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number // seconds; long-lived tokens ~60 days
}

/** Exchanges an OAuth `code` for a short-lived user access token. */
export async function exchangeCodeForToken(opts: {
  code: string
  redirectUri: string
  appId: string
  appSecret: string
}): Promise<MetaTokenResponse> {
  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', opts.appId)
  url.searchParams.set('client_secret', opts.appSecret)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('code', opts.code)
  const res = await fetch(url.toString())
  if (!res.ok) await throwMetaAdsError(res, 'Failed to exchange authorization code')
  return (await res.json()) as MetaTokenResponse
}

/** Exchanges a short-lived user token for a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(opts: {
  shortLivedToken: string
  appId: string
  appSecret: string
}): Promise<MetaTokenResponse> {
  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', opts.appId)
  url.searchParams.set('client_secret', opts.appSecret)
  url.searchParams.set('fb_exchange_token', opts.shortLivedToken)
  const res = await fetch(url.toString())
  if (!res.ok) await throwMetaAdsError(res, 'Failed to obtain a long-lived token')
  return (await res.json()) as MetaTokenResponse
}

// ── Asset discovery (ad accounts / pages / IG accounts) ──────────────

export interface MetaAdAccount {
  id: string // 'act_1234567890'
  name: string
  currency: string
  account_status: number
}

export async function listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const data = await graphRequest<{ data: MetaAdAccount[] }>('me/adaccounts', {
    accessToken,
    params: { fields: 'id,name,currency,account_status' },
  })
  return data.data ?? []
}

export interface MetaPage {
  id: string
  name: string
  instagram_business_account?: { id: string }
}

export async function listPages(accessToken: string): Promise<MetaPage[]> {
  const data = await graphRequest<{ data: MetaPage[] }>('me/accounts', {
    accessToken,
    params: { fields: 'id,name,instagram_business_account' },
  })
  return data.data ?? []
}

/** Basic identity check — used to resolve fb_user_id after connecting. */
export async function getMe(accessToken: string): Promise<{ id: string; name?: string }> {
  return graphRequest('me', { accessToken, params: { fields: 'id,name' } })
}
