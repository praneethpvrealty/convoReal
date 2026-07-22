import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder'
import {
  OWNER_DIGEST_TEMPLATE_NAME,
  OWNER_DIGEST_CONSENT_TEMPLATE_NAME,
  CONSENT_YES_TEXT,
  CONSENT_NO_TEXT,
  buildOwnerDigestParams,
  buildOwnerDigestConsentParams,
} from '@/lib/whatsapp/owner-digest-template'
import type { MessageTemplate } from '@/types'

/**
 * Owner property status digests.
 *
 * Periodically (daily or weekly, per-account setting) messages each
 * property OWNER/SELLER on WhatsApp with the buyer activity on their
 * listings since the last period:
 *   - new enquiries        (contact_property_inquiries)
 *   - shortlisted buyers   (deals created on the property — the lead
 *                           entered the pipeline)
 *   - site visits scheduled (appointments, event_type 'site_visit')
 *   - showcase views       (showcase_events 'view_property')
 *
 * A digest is sent ONLY when at least one of those counters is non-zero
 * for the period, and never twice for the same IST day (owner_digest_log
 * insert-as-claim, mirroring agent_digest_log). Owners opt out anytime by
 * replying "STOP UPDATES" (contacts.owner_digest_opt_out — see
 * webhook-handler.ts), and delivery is template-first because owners
 * rarely have an open 24h service window.
 */

// ── Types ─────────────────────────────────────────────────────────

export type DigestFrequency = 'off' | 'daily' | 'weekly'

export interface PropertyDigestStats {
  property_id: string
  title: string
  inquiries: number
  shortlisted: number
  visits: number
  views: number
}

export interface OwnerDigest {
  contactId: string
  name: string | null
  properties: PropertyDigestStats[]
}

export interface DigestPeriod {
  startIso: string
  endIso: string
  /** Human phrase used in the message, e.g. 'today' / 'this week'. */
  label: string
  /** IST calendar date used as the dedup key (YYYY-MM-DD). */
  digestDate: string
}

// ── Pure helpers (unit tested) ────────────────────────────────────

function istDateParts(now: Date): { ymd: string; weekday: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).format(now)
  return { ymd, weekday }
}

export function istHour(now: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10
  )
}

/**
 * Whether a digest run is due today for the given frequency.
 * Weekly digests go out on Monday (IST).
 */
export function isDigestDueToday(frequency: DigestFrequency, now: Date = new Date()): boolean {
  if (frequency === 'daily') return true
  if (frequency === 'weekly') return istDateParts(now).weekday === 'Monday'
  return false
}

/** The activity window covered by today's digest. */
export function digestPeriod(
  frequency: Exclude<DigestFrequency, 'off'>,
  now: Date = new Date()
): DigestPeriod {
  const days = frequency === 'daily' ? 1 : 7
  const end = now
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: frequency === 'daily' ? 'today' : 'this week',
    digestDate: istDateParts(now).ymd,
  }
}

export function hasUpdates(digest: OwnerDigest): boolean {
  return digest.properties.some(
    (p) => p.inquiries > 0 || p.shortlisted > 0 || p.visits > 0 || p.views > 0
  )
}

const plural = (n: number, singular: string, pluralWord?: string) =>
  `${n} ${n === 1 ? singular : pluralWord || `${singular}s`}`

/** Compact one-line totals for the template's {{3}} param. */
export function buildOwnerDigestSummaryLine(digest: OwnerDigest): string {
  const totals = digest.properties.reduce(
    (acc, p) => ({
      inquiries: acc.inquiries + p.inquiries,
      shortlisted: acc.shortlisted + p.shortlisted,
      visits: acc.visits + p.visits,
      views: acc.views + p.views,
    }),
    { inquiries: 0, shortlisted: 0, visits: 0, views: 0 }
  )
  const bits: string[] = []
  if (totals.inquiries > 0) bits.push(plural(totals.inquiries, 'new enquiry', 'new enquiries'))
  if (totals.shortlisted > 0) bits.push(plural(totals.shortlisted, 'buyer shortlisted', 'buyers shortlisted'))
  if (totals.visits > 0) bits.push(plural(totals.visits, 'site visit scheduled', 'site visits scheduled'))
  if (totals.views > 0) bits.push(plural(totals.views, 'showcase view'))
  return bits.join(' · ')
}

/** Rich free-form message for owners with an open 24h window. */
export function buildOwnerDigestMessage(digest: OwnerDigest, periodLabel: string): string {
  const firstName = digest.name?.trim().split(/\s+/)[0] || 'there'
  const lines: string[] = [
    `📊 *Your Property Update — ${periodLabel}*`,
    '',
    `Hi ${firstName}, here's the buyer activity on your ${
      digest.properties.length === 1 ? 'listing' : 'listings'
    }:`,
  ]
  for (const p of digest.properties) {
    if (p.inquiries === 0 && p.shortlisted === 0 && p.visits === 0 && p.views === 0) continue
    lines.push('', `*${p.title}*`)
    if (p.inquiries > 0) lines.push(`• ${plural(p.inquiries, 'new enquiry', 'new enquiries')}`)
    if (p.shortlisted > 0) lines.push(`• ${plural(p.shortlisted, 'buyer shortlisted', 'buyers shortlisted')}`)
    if (p.visits > 0) lines.push(`• ${plural(p.visits, 'site visit scheduled', 'site visits scheduled')}`)
    if (p.views > 0) lines.push(`• ${plural(p.views, 'showcase view')}`)
  }
  lines.push(
    '',
    'Reply to this message for details or to talk to your agent.',
    '_Reply STOP UPDATES to pause these updates._'
  )
  return lines.join('\n')
}

/** Owner-side WhatsApp control commands ("their dashboard" is the chat).
 *  Covers free-text STOP/START phrasing plus the consent request's
 *  Yes/No quick-reply buttons (which arrive as their button text). */
export function parseOwnerDigestCommand(
  text: string | null | undefined
): 'stop' | 'start' | null {
  if (!text) return null
  const cleaned = text.trim().toLowerCase()
  if (cleaned.length > 40) return null
  if (cleaned === CONSENT_YES_TEXT.toLowerCase()) return 'start'
  if (cleaned === CONSENT_NO_TEXT.toLowerCase()) return 'stop'
  if (/^(stop|pause)\s+(property\s+)?updates?$/.test(cleaned)) return 'stop'
  if (/^(start|resume)\s+(property\s+)?updates?$/.test(cleaned)) return 'start'
  return null
}

// ── Engine ────────────────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000
/** Only deliver during IST business-friendly morning hours. */
const SEND_HOUR_START_IST = 8
const SEND_HOUR_END_IST = 13
/** Safety cap per run — protects Meta rate limits on huge accounts. */
const MAX_DIGESTS_PER_ACCOUNT_PER_RUN = 200

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1
    return idx >= 0 && idx < params.length ? params[idx] : match
  })
}

async function isSessionOpen(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!conv) return false
  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString()
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id)
    .eq('sender_type', 'customer')
    .gte('created_at', since)
  return (count ?? 0) > 0
}

interface AccountRunSummary {
  accountId: string
  owners: number
  sent: number
  consentRequested: number
  skippedNoUpdates: number
  skippedDeclined: number
  skippedAwaitingConsent: number
  skippedAlreadySent: number
  skippedNoTemplate: number
  failed: number
}

/** Freeform consent request (open 24h window). Pure — unit tested. */
export function buildConsentRequestMessage(digest: OwnerDigest): string {
  const firstName = digest.name?.trim().split(/\s+/)[0] || 'there'
  const titles = digest.properties.map((p) => p.title?.trim()).filter(Boolean)
  const listingPhrase =
    titles.length === 1
      ? `your listing *${titles[0]}*`
      : titles.length === 2
        ? `your listings *${titles[0]}* and *${titles[1]}*`
        : `your ${digest.properties.length} listings`
  return [
    `Hi ${firstName}, buyers have been showing interest in ${listingPhrase}. 👀`,
    '',
    'Would you like to receive a short WhatsApp status update (new enquiries, shortlists and scheduled site visits) whenever there is fresh buyer activity on your property?',
    '',
    '_You can change your mind anytime by replying STOP UPDATES or START UPDATES._',
  ].join('\n')
}

/** Interactive button ids for the freeform consent request. The reply
 *  titles round-trip through parseOwnerDigestCommand, so ids are only
 *  informational. */
export const CONSENT_BUTTONS = [
  { id: 'owner_digest_yes', title: CONSENT_YES_TEXT },
  { id: 'owner_digest_no', title: CONSENT_NO_TEXT },
]

type ConsentOutcome = 'sent' | 'no_template' | 'already_claimed' | 'failed'

async function sendConsentRequest(
  db: SupabaseClient,
  args: {
    accountId: string
    digest: OwnerDigest
    period: DigestPeriod
    consentTemplate: MessageTemplate | null
  }
): Promise<ConsentOutcome> {
  const { accountId, digest, period, consentTemplate } = args

  // The consent request claims the owner's day slot too — one message
  // per owner per day, whichever kind it is.
  const { data: claim, error: claimErr } = await db
    .from('owner_digest_log')
    .insert({
      account_id: accountId,
      owner_contact_id: digest.contactId,
      digest_date: period.digestDate,
      period_start: period.startIso,
      period_end: period.endIso,
      stats: digest.properties,
      channel: 'consent_requested',
    })
    .select('id')
    .single()
  if (claimErr || !claim) {
    return claimErr?.code === '23505' ? 'already_claimed' : 'failed'
  }

  const markRequested = () =>
    db
      .from('contacts')
      .update({
        owner_digest_consent_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', digest.contactId)
      .eq('account_id', accountId)

  const open = await isSessionOpen(db, accountId, digest.contactId)
  if (open) {
    const res = await sendWhatsAppMessageAndPersist({
      accountId,
      contactId: digest.contactId,
      kind: 'interactive',
      interactiveType: 'buttons',
      senderType: 'bot',
      interactiveBody: buildConsentRequestMessage(digest),
      interactiveButtons: CONSENT_BUTTONS,
    })
    if (!res.success) {
      await db.from('owner_digest_log').update({ channel: 'failed' }).eq('id', claim.id)
      return 'failed'
    }
    await markRequested()
    return 'sent'
  }

  if (!consentTemplate) {
    await db
      .from('owner_digest_log')
      .update({ channel: 'skipped_no_template' })
      .eq('id', claim.id)
    return 'no_template'
  }

  const params = buildOwnerDigestConsentParams(
    digest.name,
    digest.properties.map((p) => p.title)
  )
  const bodyParams = truncateParametersToBudget(consentTemplate.body_text, [...params])
  const res = await sendWhatsAppMessageAndPersist({
    accountId,
    contactId: digest.contactId,
    kind: 'template',
    senderType: 'bot',
    templateName: consentTemplate.name,
    templateLanguage: consentTemplate.language || 'en_US',
    templateParams: bodyParams,
    messageParams: { body: bodyParams },
    templateRow: consentTemplate,
    text: resolveTemplateBodyText(consentTemplate.body_text, bodyParams),
  })
  if (!res.success) {
    await db.from('owner_digest_log').update({ channel: 'failed' }).eq('id', claim.id)
    return 'failed'
  }
  await markRequested()
  return 'sent'
}

/**
 * Per-owner activity stats for one account. Exported for the Owners
 * Den dashboard (GET /api/den/dashboard), which calls it per linked
 * account with `ownerContactIds` narrowing to just that Den user's
 * contact — the WhatsApp digest run passes no filter and keeps its
 * original every-owner behavior.
 */
export async function gatherOwnerDigests(
  db: SupabaseClient,
  accountId: string,
  period: DigestPeriod,
  ownerContactIds?: string[]
): Promise<OwnerDigest[]> {
  if (ownerContactIds && ownerContactIds.length === 0) return []

  // Every listing with a known owner contact.
  let propertiesQuery = db
    .from('properties')
    .select('id, title, owner_contact_id')
    .eq('account_id', accountId)
  propertiesQuery = ownerContactIds
    ? propertiesQuery.in('owner_contact_id', ownerContactIds)
    : propertiesQuery.not('owner_contact_id', 'is', null)
  const { data: properties } = await propertiesQuery
  if (!properties || properties.length === 0) return []

  const propertyIds = properties.map((p) => p.id as string)

  const [inquiriesRes, dealsRes, visitsRes, viewsRes] = await Promise.all([
    db
      .from('contact_property_inquiries')
      .select('property_id, contact_id')
      .in('property_id', propertyIds)
      .gte('created_at', period.startIso)
      .lt('created_at', period.endIso)
      .limit(5000),
    db
      .from('deals')
      .select('property_id, contact_id')
      .eq('account_id', accountId)
      .in('property_id', propertyIds)
      .gte('created_at', period.startIso)
      .lt('created_at', period.endIso)
      .limit(5000),
    db
      .from('appointments')
      .select('property_id, contact_id')
      .eq('account_id', accountId)
      .eq('event_type', 'site_visit')
      .eq('status', 'scheduled')
      .in('property_id', propertyIds)
      .gte('created_at', period.startIso)
      .lt('created_at', period.endIso)
      .limit(5000),
    db
      .from('showcase_events')
      .select('property_id, session_key')
      .eq('account_id', accountId)
      .eq('event_type', 'view_property')
      .in('property_id', propertyIds)
      .gte('created_at', period.startIso)
      .lt('created_at', period.endIso)
      .limit(5000),
  ])

  const statsByProperty = new Map<string, PropertyDigestStats>()
  for (const p of properties) {
    statsByProperty.set(p.id as string, {
      property_id: p.id as string,
      title: (p.title as string) || 'Your property',
      inquiries: 0,
      shortlisted: 0,
      visits: 0,
      views: 0,
    })
  }

  const countDistinct = (
    rows: Array<Record<string, unknown>> | null,
    key: string,
    bump: (stats: PropertyDigestStats, distinctCount: number) => void
  ) => {
    const byProperty = new Map<string, Set<string>>()
    for (const row of rows || []) {
      const pid = row.property_id as string | null
      if (!pid) continue
      const val = (row[key] as string | null) || `anon-${byProperty.get(pid)?.size ?? 0}-${pid}`
      if (!byProperty.has(pid)) byProperty.set(pid, new Set())
      byProperty.get(pid)!.add(val)
    }
    for (const [pid, set] of byProperty) {
      const stats = statsByProperty.get(pid)
      if (stats) bump(stats, set.size)
    }
  }

  countDistinct(inquiriesRes.data, 'contact_id', (s, n) => (s.inquiries = n))
  countDistinct(dealsRes.data, 'contact_id', (s, n) => (s.shortlisted = n))
  countDistinct(visitsRes.data, 'contact_id', (s, n) => (s.visits = n))
  countDistinct(viewsRes.data, 'session_key', (s, n) => (s.views = n))

  // Bucket per owner.
  const byOwner = new Map<string, PropertyDigestStats[]>()
  for (const p of properties) {
    const ownerId = p.owner_contact_id as string
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, [])
    byOwner.get(ownerId)!.push(statsByProperty.get(p.id as string)!)
  }

  return Array.from(byOwner.entries()).map(([contactId, props]) => ({
    contactId,
    name: null, // filled from the contacts lookup later
    properties: props,
  }))
}

/**
 * Run the digest pass for every account with the feature enabled.
 * Invoked by /api/cron/owner-digest (daily). Idempotent within a day.
 */
export async function sendOwnerStatusDigests(options?: {
  db?: SupabaseClient
  now?: Date
  /** Skip the IST morning-hours gate (manual/test runs). */
  force?: boolean
}): Promise<{ ran: boolean; reason?: string; accounts: AccountRunSummary[] }> {
  const db = options?.db || supabaseAdmin()
  const now = options?.now || new Date()

  const hour = istHour(now)
  if (!options?.force && (hour < SEND_HOUR_START_IST || hour >= SEND_HOUR_END_IST)) {
    return { ran: false, reason: `outside IST send window (hour=${hour})`, accounts: [] }
  }

  const { data: settingsRows } = await db
    .from('owner_digest_settings')
    .select('account_id, frequency')
    .neq('frequency', 'off')
  if (!settingsRows || settingsRows.length === 0) {
    return { ran: true, accounts: [] }
  }

  const summaries: AccountRunSummary[] = []

  for (const settings of settingsRows) {
    const accountId = settings.account_id as string
    const frequency = settings.frequency as Exclude<DigestFrequency, 'off'>
    if (!isDigestDueToday(frequency, now)) continue

    const summary: AccountRunSummary = {
      accountId,
      owners: 0,
      sent: 0,
      consentRequested: 0,
      skippedNoUpdates: 0,
      skippedDeclined: 0,
      skippedAwaitingConsent: 0,
      skippedAlreadySent: 0,
      skippedNoTemplate: 0,
      failed: 0,
    }
    summaries.push(summary)

    try {
      const period = digestPeriod(frequency, now)
      const digests = await gatherOwnerDigests(db, accountId, period)
      summary.owners = digests.length
      if (digests.length === 0) continue

      // Owner contact details (phone for send, name for greeting,
      // consent state for the consent-first gate).
      const ownerIds = digests.map((d) => d.contactId)
      const { data: ownerRows } = await db
        .from('contacts')
        .select('id, name, phone, owner_digest_consent, owner_digest_consent_requested_at')
        .eq('account_id', accountId)
        .in('id', ownerIds)
      const ownerById = new Map(
        (ownerRows || []).map((c) => [c.id as string, c as Record<string, unknown>])
      )

      // Latest approved templates — looked up once per account.
      const approvedTemplate = async (name: string): Promise<MessageTemplate | null> => {
        const { data: row } = await db
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', name)
          .order('last_submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const template = row as MessageTemplate | null
        return template?.status === 'APPROVED' ? template : null
      }
      const [digestTemplate, consentTemplate] = await Promise.all([
        approvedTemplate(OWNER_DIGEST_TEMPLATE_NAME),
        approvedTemplate(OWNER_DIGEST_CONSENT_TEMPLATE_NAME),
      ])

      let sentThisRun = 0
      for (const digest of digests) {
        if (sentThisRun >= MAX_DIGESTS_PER_ACCOUNT_PER_RUN) break

        if (!hasUpdates(digest)) {
          summary.skippedNoUpdates++
          continue
        }
        const owner = ownerById.get(digest.contactId)
        if (!owner || !owner.phone) continue
        // Consent-first: the owner's choice ALWAYS overrides the account
        // setting. declined → never send; pending → ask once, then wait.
        const consent = (owner.owner_digest_consent as string | null) ?? 'pending'
        if (consent === 'declined') {
          summary.skippedDeclined++
          continue
        }
        digest.name = (owner.name as string | null) ?? null

        if (consent !== 'granted') {
          if (owner.owner_digest_consent_requested_at) {
            // Asked before, no answer yet — stay silent, never re-ask.
            summary.skippedAwaitingConsent++
            continue
          }
          const outcome = await sendConsentRequest(db, {
            accountId,
            digest,
            period,
            consentTemplate,
          })
          if (outcome === 'sent') {
            summary.consentRequested++
            sentThisRun++
          } else if (outcome === 'no_template') {
            summary.skippedNoTemplate++
          } else if (outcome === 'already_claimed') {
            summary.skippedAlreadySent++
          } else {
            summary.failed++
          }
          continue
        }

        // Insert-as-claim dedup: the UNIQUE(account, owner, day) row is
        // claimed BEFORE sending; a racing tick loses with 23505.
        const activeProps = digest.properties.filter(
          (p) => p.inquiries > 0 || p.shortlisted > 0 || p.visits > 0 || p.views > 0
        )
        const { data: claim, error: claimErr } = await db
          .from('owner_digest_log')
          .insert({
            account_id: accountId,
            owner_contact_id: digest.contactId,
            digest_date: period.digestDate,
            period_start: period.startIso,
            period_end: period.endIso,
            stats: activeProps,
          })
          .select('id')
          .single()
        if (claimErr || !claim) {
          if (claimErr?.code === '23505') summary.skippedAlreadySent++
          else summary.failed++
          continue
        }

        const recordChannel = (channel: string) =>
          db.from('owner_digest_log').update({ channel }).eq('id', claim.id)

        const open = await isSessionOpen(db, accountId, digest.contactId)
        if (open) {
          const res = await sendWhatsAppMessageAndPersist({
            accountId,
            contactId: digest.contactId,
            kind: 'text',
            senderType: 'bot',
            text: buildOwnerDigestMessage(
              { ...digest, properties: activeProps },
              period.label
            ),
          })
          if (res.success) {
            summary.sent++
            sentThisRun++
            await recordChannel('freeform')
          } else {
            summary.failed++
            await recordChannel('failed')
          }
          continue
        }

        if (!digestTemplate) {
          summary.skippedNoTemplate++
          await recordChannel('skipped_no_template')
          continue
        }

        const params = buildOwnerDigestParams(
          digest.name,
          activeProps.map((p) => p.title),
          period.label,
          buildOwnerDigestSummaryLine(digest)
        )
        const bodyParams = truncateParametersToBudget(digestTemplate.body_text, [...params])
        const res = await sendWhatsAppMessageAndPersist({
          accountId,
          contactId: digest.contactId,
          kind: 'template',
          senderType: 'bot',
          templateName: digestTemplate.name,
          templateLanguage: digestTemplate.language || 'en_US',
          templateParams: bodyParams,
          messageParams: { body: bodyParams },
          templateRow: digestTemplate,
          text: resolveTemplateBodyText(digestTemplate.body_text, bodyParams),
        })
        if (res.success) {
          summary.sent++
          sentThisRun++
          await recordChannel('template')
        } else {
          summary.failed++
          await recordChannel('failed')
        }
      }
    } catch (err) {
      console.error(`[owner-digest] account ${accountId} failed:`, err)
      summary.failed++
    }
  }

  return { ran: true, accounts: summaries }
}

/**
 * Record the owner's digest decision from their WhatsApp reply — the
 * ONLY code path that can set consent to granted/declined, which is
 * what makes the owner's choice authoritative over any account setting.
 * Returns the confirmation text to send back, or null when the update
 * failed (caller stays silent).
 */
export async function applyOwnerDigestCommand(args: {
  command: 'stop' | 'start'
  accountId: string
  contactId: string
  db?: SupabaseClient
}): Promise<string | null> {
  const db = args.db || supabaseAdmin()
  const { error } = await db
    .from('contacts')
    .update({
      owner_digest_consent: args.command === 'stop' ? 'declined' : 'granted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
  if (error) {
    console.error('[owner-digest] consent update failed:', error.message)
    return null
  }
  return args.command === 'stop'
    ? "Understood — you won't receive property status updates. Reply START UPDATES anytime if you change your mind."
    : "✅ Great! You'll receive a short status update whenever there's new buyer activity on your property. Reply STOP UPDATES anytime to pause."
}
