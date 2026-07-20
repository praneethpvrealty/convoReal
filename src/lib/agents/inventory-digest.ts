import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import {
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  buildAgentInventoryDigestParams,
} from '@/lib/whatsapp/agent-inventory-digest-template'
import {
  digestPeriod,
  isDigestDueToday,
  istHour,
  type DigestFrequency,
  type DigestPeriod,
} from '@/lib/owners/owner-digest'
import type { MessageTemplate } from '@/types'

/**
 * Agent inventory reach digests.
 *
 * Periodically (daily or weekly, per-account setting) messages each
 * SOURCE AGENT on WhatsApp — the partner agent whose inventory this
 * account lists as agent-referred (properties.listing_source = 'agent',
 * properties.owner_contact_id = the agent's contact card) — with how
 * far their inventory travelled:
 *   - direct buyers    (property_shares on the listing itself,
 *                       recipient_kind 'buyer')
 *   - indirect buyers  (buyer shares on downstream copies of the
 *                       listing in OTHER accounts, linked via
 *                       properties.source_property_id lineage)
 *   - partner agents   (agent shares on the listing)
 *
 * A digest is sent ONLY when the period added new direct or indirect
 * buyers, and never twice for the same IST day (insert-as-claim on
 * agent_inventory_digest_log, mirroring owner_digest_log). Source
 * agents without a ConvoReal profile (matched by phone, last 10
 * digits) get a signup invite line with every digest; signed-up agents
 * get a dashboard pointer instead. The contact's "STOP UPDATES" reply
 * (contacts.owner_digest_consent = 'declined', webhook-handler.ts) is
 * honored here too, and delivery is template-first because partner
 * agents rarely have an open 24h window.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface PropertyReachStats {
  property_id: string
  title: string
  directBuyers: number
  newDirectBuyers: number
  indirectBuyers: number
  newIndirectBuyers: number
  agentsReached: number
}

export interface AgentInventoryDigest {
  contactId: string
  name: string | null
  properties: PropertyReachStats[]
}

// ── Pure helpers (unit tested) ────────────────────────────────────

const plural = (n: number, singular: string, pluralWord?: string) =>
  `${n} ${n === 1 ? singular : pluralWord || `${singular}s`}`

export function hasReachUpdates(digest: AgentInventoryDigest): boolean {
  return digest.properties.some((p) => p.newDirectBuyers > 0 || p.newIndirectBuyers > 0)
}

export function reachTotals(digest: AgentInventoryDigest) {
  return digest.properties.reduce(
    (acc, p) => ({
      directBuyers: acc.directBuyers + p.directBuyers,
      newDirectBuyers: acc.newDirectBuyers + p.newDirectBuyers,
      indirectBuyers: acc.indirectBuyers + p.indirectBuyers,
      newIndirectBuyers: acc.newIndirectBuyers + p.newIndirectBuyers,
      agentsReached: acc.agentsReached + p.agentsReached,
    }),
    { directBuyers: 0, newDirectBuyers: 0, indirectBuyers: 0, newIndirectBuyers: 0, agentsReached: 0 }
  )
}

/** Compact one-line totals for the template's {{3}} param. */
export function buildAgentReachSummaryLine(digest: AgentInventoryDigest): string {
  const totals = reachTotals(digest)
  const bits: string[] = []
  if (totals.newDirectBuyers > 0) bits.push(plural(totals.newDirectBuyers, 'new direct buyer'))
  if (totals.newIndirectBuyers > 0)
    bits.push(`${plural(totals.newIndirectBuyers, 'new buyer')} via partner agents`)
  bits.push(`${totals.directBuyers} direct / ${totals.indirectBuyers} indirect buyers so far`)
  return bits.join(' · ')
}

/** Closing line when the source agent has no ConvoReal profile yet. */
export function buildSignupInviteLine(siteUrl: string): string {
  return `🚀 Track your inventory network live — sign up free on ConvoReal: ${siteUrl}/signup`
}

/** Closing line for source agents who already signed up. */
export function buildDashboardPointerLine(siteUrl: string): string {
  return `📊 See the full breakdown anytime on your ConvoReal dashboard: ${siteUrl}/dashboard`
}

/** Rich free-form message for source agents with an open 24h window. */
export function buildAgentInventoryDigestMessage(
  digest: AgentInventoryDigest,
  periodLabel: string,
  closingLine: string
): string {
  const firstName = digest.name?.trim().split(/\s+/)[0] || 'there'
  const lines: string[] = [
    `📣 *Your Inventory Reach Update — ${periodLabel}*`,
    '',
    `Hi ${firstName}, here's how your ${
      digest.properties.length === 1 ? 'referred listing' : 'referred listings'
    } performed across our buyer network:`,
  ]
  for (const p of digest.properties) {
    if (p.directBuyers === 0 && p.indirectBuyers === 0 && p.agentsReached === 0) continue
    lines.push('', `*${p.title}*`)
    if (p.directBuyers > 0)
      lines.push(
        `• ${plural(p.directBuyers, 'direct buyer')}${
          p.newDirectBuyers > 0 ? ` (${p.newDirectBuyers} new)` : ''
        }`
      )
    if (p.indirectBuyers > 0)
      lines.push(
        `• ${plural(p.indirectBuyers, 'buyer')} via partner agents${
          p.newIndirectBuyers > 0 ? ` (${p.newIndirectBuyers} new)` : ''
        }`
      )
    if (p.agentsReached > 0)
      lines.push(`• shared with ${plural(p.agentsReached, 'partner agent')}`)
  }
  lines.push('', closingLine, '_Reply STOP UPDATES to pause these updates._')
  return lines.join('\n')
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
const SEND_HOUR_START_IST = 8
const SEND_HOUR_END_IST = 13
const MAX_DIGESTS_PER_ACCOUNT_PER_RUN = 200
/** Lineage walk cap — a share chain deeper than this is counted up to
 *  the cap, never followed indefinitely. */
const MAX_LINEAGE_DEPTH = 4

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  ).replace(/\/$/, '')
}

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

/**
 * Walk properties.source_property_id lineage downward from the given
 * roots across ALL accounts (service-role client). Returns every
 * descendant property id mapped to its root ancestor.
 */
export async function collectDescendants(
  db: SupabaseClient,
  rootIds: string[]
): Promise<Map<string, string>> {
  const rootByDescendant = new Map<string, string>()
  const rootOf = new Map<string, string>(rootIds.map((id) => [id, id]))
  let frontier = rootIds
  for (let depth = 0; depth < MAX_LINEAGE_DEPTH && frontier.length > 0; depth++) {
    const { data: children } = await db
      .from('properties')
      .select('id, source_property_id')
      .in('source_property_id', frontier)
      .limit(5000)
    if (!children || children.length === 0) break
    const next: string[] = []
    for (const child of children) {
      const childId = child.id as string
      const root = rootOf.get(child.source_property_id as string)
      if (!root || rootOf.has(childId)) continue
      rootOf.set(childId, root)
      rootByDescendant.set(childId, root)
      next.push(childId)
    }
    frontier = next
  }
  return rootByDescendant
}

/**
 * Per-source-agent reach stats for one account. Exported for the
 * dashboard network-reach API, which calls it per account with
 * `agentContactIds` narrowing to the signed-in agent's contact — the
 * WhatsApp digest run passes no filter and covers every source agent.
 */
export async function gatherAgentInventoryDigests(
  db: SupabaseClient,
  accountId: string,
  period: DigestPeriod,
  agentContactIds?: string[]
): Promise<AgentInventoryDigest[]> {
  if (agentContactIds && agentContactIds.length === 0) return []

  let propertiesQuery = db
    .from('properties')
    .select('id, title, owner_contact_id')
    .eq('account_id', accountId)
    .eq('listing_source', 'agent')
  propertiesQuery = agentContactIds
    ? propertiesQuery.in('owner_contact_id', agentContactIds)
    : propertiesQuery.not('owner_contact_id', 'is', null)
  const { data: properties } = await propertiesQuery
  if (!properties || properties.length === 0) return []

  const rootIds = properties.map((p) => p.id as string)
  const rootByDescendant = await collectDescendants(db, rootIds)
  const descendantIds = Array.from(rootByDescendant.keys())

  const [directRes, indirectRes] = await Promise.all([
    db
      .from('property_shares')
      .select('property_id, contact_id, recipient_kind, created_at')
      .eq('account_id', accountId)
      .in('property_id', rootIds)
      .limit(5000),
    descendantIds.length > 0
      ? db
          .from('property_shares')
          .select('property_id, contact_id, created_at')
          .eq('recipient_kind', 'buyer')
          .in('property_id', descendantIds)
          .limit(5000)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])

  const statsByProperty = new Map<string, PropertyReachStats>()
  for (const p of properties) {
    statsByProperty.set(p.id as string, {
      property_id: p.id as string,
      title: (p.title as string) || 'Your property',
      directBuyers: 0,
      newDirectBuyers: 0,
      indirectBuyers: 0,
      newIndirectBuyers: 0,
      agentsReached: 0,
    })
  }

  const directBuyers = new Map<string, Set<string>>()
  const newDirectBuyers = new Map<string, Set<string>>()
  const agentsReached = new Map<string, Set<string>>()
  for (const row of directRes.data || []) {
    const pid = row.property_id as string
    const cid = row.contact_id as string
    const target = row.recipient_kind === 'agent' ? agentsReached : directBuyers
    if (!target.has(pid)) target.set(pid, new Set())
    target.get(pid)!.add(cid)
    if (row.recipient_kind === 'buyer' && (row.created_at as string) >= period.startIso) {
      if (!newDirectBuyers.has(pid)) newDirectBuyers.set(pid, new Set())
      newDirectBuyers.get(pid)!.add(cid)
    }
  }

  const indirectBuyers = new Map<string, Set<string>>()
  const newIndirectBuyers = new Map<string, Set<string>>()
  for (const row of indirectRes.data || []) {
    const root = rootByDescendant.get(row.property_id as string)
    if (!root) continue
    const cid = row.contact_id as string
    if (!indirectBuyers.has(root)) indirectBuyers.set(root, new Set())
    indirectBuyers.get(root)!.add(cid)
    if ((row.created_at as string) >= period.startIso) {
      if (!newIndirectBuyers.has(root)) newIndirectBuyers.set(root, new Set())
      newIndirectBuyers.get(root)!.add(cid)
    }
  }

  for (const [pid, stats] of statsByProperty) {
    stats.directBuyers = directBuyers.get(pid)?.size ?? 0
    stats.newDirectBuyers = newDirectBuyers.get(pid)?.size ?? 0
    stats.indirectBuyers = indirectBuyers.get(pid)?.size ?? 0
    stats.newIndirectBuyers = newIndirectBuyers.get(pid)?.size ?? 0
    stats.agentsReached = agentsReached.get(pid)?.size ?? 0
  }

  const byAgent = new Map<string, PropertyReachStats[]>()
  for (const p of properties) {
    const agentId = p.owner_contact_id as string
    if (!byAgent.has(agentId)) byAgent.set(agentId, [])
    byAgent.get(agentId)!.push(statsByProperty.get(p.id as string)!)
  }

  return Array.from(byAgent.entries()).map(([contactId, props]) => ({
    contactId,
    name: null,
    properties: props,
  }))
}

interface AccountRunSummary {
  accountId: string
  agents: number
  sent: number
  invitesIncluded: number
  skippedNoUpdates: number
  skippedDeclined: number
  skippedAlreadySent: number
  skippedNoTemplate: number
  failed: number
}

/**
 * Run the digest pass for every account with the feature enabled.
 * Invoked by /api/cron/agent-inventory-digest (daily). Idempotent
 * within a day.
 */
export async function sendAgentInventoryDigests(options?: {
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
    .from('agent_inventory_digest_settings')
    .select('account_id, frequency')
    .neq('frequency', 'off')
  if (!settingsRows || settingsRows.length === 0) {
    return { ran: true, accounts: [] }
  }

  const summaries: AccountRunSummary[] = []
  const hasProfileByPhone = new Map<string, boolean>()
  const hasProfile = async (phone: string): Promise<boolean> => {
    const last10 = normalizePhone(phone).slice(-10)
    if (!last10) return false
    if (!hasProfileByPhone.has(last10)) {
      const { data } = await db.rpc('phone_has_profile', { p_phone_last10: last10 })
      hasProfileByPhone.set(last10, data === true)
    }
    return hasProfileByPhone.get(last10)!
  }

  for (const settings of settingsRows) {
    const accountId = settings.account_id as string
    const frequency = settings.frequency as Exclude<DigestFrequency, 'off'>
    if (!isDigestDueToday(frequency, now)) continue

    const summary: AccountRunSummary = {
      accountId,
      agents: 0,
      sent: 0,
      invitesIncluded: 0,
      skippedNoUpdates: 0,
      skippedDeclined: 0,
      skippedAlreadySent: 0,
      skippedNoTemplate: 0,
      failed: 0,
    }
    summaries.push(summary)

    try {
      const period = digestPeriod(frequency, now)
      const digests = await gatherAgentInventoryDigests(db, accountId, period)
      summary.agents = digests.length
      if (digests.length === 0) continue

      const agentIds = digests.map((d) => d.contactId)
      const { data: agentRows } = await db
        .from('contacts')
        .select('id, name, phone, classification, owner_digest_consent')
        .eq('account_id', accountId)
        .in('id', agentIds)
      const agentById = new Map(
        (agentRows || []).map((c) => [c.id as string, c as Record<string, unknown>])
      )

      const { data: templateRow } = await db
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', AGENT_INVENTORY_DIGEST_TEMPLATE_NAME)
        .order('last_submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const template = templateRow as MessageTemplate | null
      const digestTemplate = template?.status === 'APPROVED' ? template : null

      let sentThisRun = 0
      for (const digest of digests) {
        if (sentThisRun >= MAX_DIGESTS_PER_ACCOUNT_PER_RUN) break

        if (!hasReachUpdates(digest)) {
          summary.skippedNoUpdates++
          continue
        }
        const agent = agentById.get(digest.contactId)
        if (!agent || !agent.phone) continue
        // The contact's own WhatsApp reply always wins — "STOP UPDATES"
        // (webhook-handler → owner_digest_consent 'declined') silences
        // this digest too.
        if ((agent.owner_digest_consent as string | null) === 'declined') {
          summary.skippedDeclined++
          continue
        }
        digest.name = (agent.name as string | null) ?? null

        const signedUp = await hasProfile(agent.phone as string)
        const closingLine = signedUp
          ? buildDashboardPointerLine(siteUrl())
          : buildSignupInviteLine(siteUrl())

        const activeProps = digest.properties.filter(
          (p) => p.directBuyers > 0 || p.indirectBuyers > 0 || p.agentsReached > 0
        )
        const { data: claim, error: claimErr } = await db
          .from('agent_inventory_digest_log')
          .insert({
            account_id: accountId,
            agent_contact_id: digest.contactId,
            digest_date: period.digestDate,
            period_start: period.startIso,
            period_end: period.endIso,
            stats: activeProps,
            invite_included: !signedUp,
          })
          .select('id')
          .single()
        if (claimErr || !claim) {
          if (claimErr?.code === '23505') summary.skippedAlreadySent++
          else summary.failed++
          continue
        }

        const recordChannel = (channel: string) =>
          db.from('agent_inventory_digest_log').update({ channel }).eq('id', claim.id)

        const open = await isSessionOpen(db, accountId, digest.contactId)
        if (open) {
          const res = await sendWhatsAppMessageAndPersist({
            accountId,
            contactId: digest.contactId,
            kind: 'text',
            senderType: 'bot',
            text: buildAgentInventoryDigestMessage(
              { ...digest, properties: activeProps },
              period.label,
              closingLine
            ),
          })
          if (res.success) {
            summary.sent++
            if (!signedUp) summary.invitesIncluded++
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

        const params = buildAgentInventoryDigestParams(
          digest.name,
          activeProps.length,
          period.label,
          buildAgentReachSummaryLine(digest),
          closingLine
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
          if (!signedUp) summary.invitesIncluded++
          sentThisRun++
          await recordChannel('template')
        } else {
          summary.failed++
          await recordChannel('failed')
        }
      }
    } catch (err) {
      console.error(`[agent-inventory-digest] account ${accountId} failed:`, err)
      summary.failed++
    }
  }

  return { ran: true, accounts: summaries }
}
