import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import type { PropertyReachStats } from '@/lib/agents/inventory-digest'

interface AgentDigestLog {
  period_start: string
  period_end: string
  stats: PropertyReachStats[]
}

export interface DirectBuyerReachDetail {
  propertyId: string
  propertyTitle: string
  buyerName: string
  sharedAt: string
}

export function isAgentInventoryDetailsRequest(
  text: string | null | undefined
): boolean {
  return /^tell me more$/i.test((text || '').trim())
}

function istDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value))
}

export function buildAgentInventoryDetailsReply(
  contactName: string | null,
  stats: PropertyReachStats[],
  directBuyerDetails: DirectBuyerReachDetail[]
): string {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there'
  const detailsByProperty = new Map<string, DirectBuyerReachDetail[]>()
  for (const detail of directBuyerDetails) {
    const existing = detailsByProperty.get(detail.propertyId) ?? []
    existing.push(detail)
    detailsByProperty.set(detail.propertyId, existing)
  }

  const lines = [
    `Hi ${firstName}, here are the new reach details from your latest update:`,
  ]
  for (const property of stats) {
    if (property.newDirectBuyers === 0 && property.newIndirectBuyers === 0)
      continue
    lines.push('', `*${property.title}*`)
    for (const detail of detailsByProperty.get(property.property_id) ?? []) {
      lines.push(
        `• Shared directly with *${detail.buyerName}* on ${istDateTime(detail.sharedAt)}`
      )
    }
    const unresolvedDirect =
      property.newDirectBuyers -
      (detailsByProperty.get(property.property_id)?.length ?? 0)
    if (unresolvedDirect > 0) {
      lines.push(
        `• Shared directly with ${unresolvedDirect} other buyer${unresolvedDirect === 1 ? '' : 's'}`
      )
    }
    if (property.newIndirectBuyers > 0) {
      lines.push(
        `• Shared with ${property.newIndirectBuyers} new buyer${property.newIndirectBuyers === 1 ? '' : 's'} through partner consultants`
      )
    }
  }
  lines.push(
    '',
    '_“Shared” means the property was sent to the buyer; it does not yet mean they enquired, shortlisted it, or requested a visit._',
    'Your consultant will update you separately when the buyer responds.'
  )
  return lines.join('\n')
}

export async function handleAgentInventoryDetailsRequest(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  contactId: string
  contactName: string | null
  conversationId: string
  text: string
}): Promise<boolean> {
  if (!isAgentInventoryDetailsRequest(args.text)) return false

  const { data: log } = await args.db
    .from('agent_inventory_digest_log')
    .select('period_start, period_end, stats')
    .eq('account_id', args.accountId)
    .eq('agent_contact_id', args.contactId)
    .in('channel', ['template', 'freeform'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!log) return false

  const snapshot = log as AgentDigestLog
  const activeStats = (snapshot.stats || []).filter(
    (property) => property.newDirectBuyers > 0 || property.newIndirectBuyers > 0
  )
  if (activeStats.length === 0) return false

  const directPropertyIds = activeStats
    .filter((property) => property.newDirectBuyers > 0)
    .map((property) => property.property_id)
  const directBuyerDetails: DirectBuyerReachDetail[] = []
  if (directPropertyIds.length > 0) {
    const { data: shares } = await args.db
      .from('property_shares')
      .select('property_id, contact_id, created_at')
      .eq('account_id', args.accountId)
      .eq('recipient_kind', 'buyer')
      .in('property_id', directPropertyIds)
      .gte('created_at', snapshot.period_start)
      .lte('created_at', snapshot.period_end)

    const contactIds = Array.from(
      new Set((shares || []).map((share) => share.contact_id as string))
    )
    const { data: contacts } = contactIds.length
      ? await args.db
          .from('contacts')
          .select('id, name')
          .eq('account_id', args.accountId)
          .in('id', contactIds)
      : { data: [] }
    const nameById = new Map(
      (contacts || []).map((contact) => [
        contact.id as string,
        (contact.name as string) || 'Buyer',
      ])
    )
    const titleById = new Map(
      activeStats.map((property) => [property.property_id, property.title])
    )
    for (const share of shares || []) {
      directBuyerDetails.push({
        propertyId: share.property_id as string,
        propertyTitle:
          titleById.get(share.property_id as string) || 'Your property',
        buyerName: nameById.get(share.contact_id as string) || 'Buyer',
        sharedAt: share.created_at as string,
      })
    }
  }

  const reply = buildAgentInventoryDetailsReply(
    args.contactName,
    activeStats,
    directBuyerDetails
  )
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text: reply,
  })
  return result.success
}
