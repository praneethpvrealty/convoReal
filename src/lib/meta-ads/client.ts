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

// ── Campaign creation (Phase C) ──────────────────────────────────────
//
// These map 1:1 onto the Marketing API objects created, in order, by
// POST /api/meta-ads/campaigns. Each returns the created object's id.
// The route creates everything PAUSED and flips the campaign ACTIVE
// last, deleting already-created objects on any mid-sequence failure —
// so a partial failure never leaves an ad silently spending.

interface AdAccountScoped {
  accessToken: string
  adAccountId: string // 'act_...'
}

/** Uploads image bytes to the ad account, returning its image_hash. */
export async function uploadAdImage(
  opts: AdAccountScoped & { bytes: Buffer; filename?: string },
): Promise<string> {
  const url = new URL(`${META_API_BASE}/${opts.adAccountId}/adimages`)
  const form = new FormData()
  form.set('access_token', opts.accessToken)
  form.set('filename', new Blob([new Uint8Array(opts.bytes)]), opts.filename || 'ad-image.jpg')
  const res = await fetch(url.toString(), { method: 'POST', body: form })
  if (!res.ok) await throwMetaAdsError(res, 'Failed to upload the ad image')
  const data = (await res.json()) as { images?: Record<string, { hash: string }> }
  const first = data.images ? Object.values(data.images)[0] : undefined
  if (!first?.hash) throw new MetaAdsApiError('No image hash returned', 0, undefined, 'Image upload failed')
  return first.hash
}

export async function createCampaign(
  opts: AdAccountScoped & { name: string; specialAdCategories: string[] },
): Promise<string> {
  const data = await graphRequest<{ id: string }>(`${opts.adAccountId}/campaigns`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params: {
      name: opts.name,
      objective: 'OUTCOME_ENGAGEMENT',
      status: 'PAUSED',
      special_ad_categories: opts.specialAdCategories,
    },
  })
  return data.id
}

export async function createAdSet(
  opts: AdAccountScoped & {
    name: string
    campaignId: string
    pageId: string
    dailyBudgetMinor: number
    targeting: Record<string, unknown>
    endTime?: string | null
  },
): Promise<string> {
  const params: Record<string, unknown> = {
    name: opts.name,
    campaign_id: opts.campaignId,
    destination_type: 'WHATSAPP',
    optimization_goal: 'CONVERSATIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: opts.dailyBudgetMinor,
    promoted_object: { page_id: opts.pageId },
    targeting: opts.targeting,
    status: 'PAUSED',
  }
  if (opts.endTime) params.end_time = opts.endTime
  const data = await graphRequest<{ id: string }>(`${opts.adAccountId}/adsets`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params,
  })
  return data.id
}

export async function createAdCreative(
  opts: AdAccountScoped & {
    name: string
    pageId: string
    igAccountId?: string | null
    message: string
    headline: string
    imageHash: string
    waLink: string
  },
): Promise<string> {
  const linkData: Record<string, unknown> = {
    message: opts.message,
    name: opts.headline,
    image_hash: opts.imageHash,
    link: opts.waLink,
    call_to_action: { type: 'WHATSAPP_MESSAGE' },
  }
  const objectStorySpec: Record<string, unknown> = { page_id: opts.pageId, link_data: linkData }
  if (opts.igAccountId) objectStorySpec.instagram_actor_id = opts.igAccountId

  const data = await graphRequest<{ id: string }>(`${opts.adAccountId}/adcreatives`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params: { name: opts.name, object_story_spec: objectStorySpec },
  })
  return data.id
}

export async function createAd(
  opts: AdAccountScoped & { name: string; adsetId: string; creativeId: string },
): Promise<string> {
  const data = await graphRequest<{ id: string }>(`${opts.adAccountId}/ads`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params: {
      name: opts.name,
      adset_id: opts.adsetId,
      creative: { creative_id: opts.creativeId },
      status: 'PAUSED',
    },
  })
  return data.id
}

/** Flips a campaign/adset/ad status (e.g. PAUSED → ACTIVE). */
export async function setObjectStatus(opts: {
  accessToken: string
  objectId: string
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
}): Promise<void> {
  await graphRequest(`${opts.objectId}`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params: { status: opts.status },
  })
}

/** Updates an ad set's daily budget (minor currency units). */
export async function setAdSetDailyBudget(opts: {
  accessToken: string
  adsetId: string
  dailyBudgetMinor: number
}): Promise<void> {
  await graphRequest(`${opts.adsetId}`, {
    accessToken: opts.accessToken,
    method: 'POST',
    params: { daily_budget: opts.dailyBudgetMinor },
  })
}

/**
 * Resolves a city name to a Meta geo `key` for ad-set targeting, used
 * when a property has no coordinates. Returns null when Meta finds no
 * matching city — the caller then rejects the request rather than
 * targeting the wrong (or entire) country.
 */
export async function resolveCityGeoKey(accessToken: string, query: string): Promise<string | null> {
  const data = await graphRequest<{ data: Array<{ key: string; name: string; type: string }> }>('search', {
    accessToken,
    params: { type: 'adgeolocation', location_types: JSON.stringify(['city']), q: query, limit: '1' },
  })
  return data.data?.[0]?.key ?? null
}

/** Best-effort delete of a created object during failure cleanup. */
export async function deleteObject(accessToken: string, objectId: string): Promise<void> {
  try {
    await graphRequest(`${objectId}`, { accessToken, method: 'DELETE' })
  } catch (err) {
    console.error(`[meta-ads] cleanup delete of ${objectId} failed (non-fatal):`, err)
  }
}

// ── Insights (Phase D) ────────────────────────────────────────────────

interface RawInsightsRow {
  spend?: string
  impressions?: string
  reach?: string
  actions?: Array<{ action_type: string; value: string }>
}

export interface CampaignInsights {
  spendInr: number
  impressions: number
  reach: number
  /** "Chats started" per Meta's own attribution — a Meta-side metric,
   *  distinct from (and not to be confused with) real CRM leads. */
  conversationsStarted: number
}

const CONVERSATIONS_ACTION_TYPE = 'onsite_conversion.messaging_conversation_started_7d'

/** Lifetime insights for one campaign. Null if Meta has no data yet
 *  (e.g. a campaign that just went live). */
export async function getCampaignInsights(accessToken: string, campaignId: string): Promise<CampaignInsights | null> {
  const data = await graphRequest<{ data: RawInsightsRow[] }>(`${campaignId}/insights`, {
    accessToken,
    params: { fields: 'spend,impressions,reach,actions' },
  })
  const row = data.data?.[0]
  if (!row) return null

  const conversations = row.actions?.find((a) => a.action_type === CONVERSATIONS_ACTION_TYPE)

  return {
    spendInr: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    conversationsStarted: conversations ? Number(conversations.value) : 0,
  }
}
