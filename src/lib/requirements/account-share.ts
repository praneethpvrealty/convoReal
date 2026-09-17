import type { AccountContext } from '@/lib/auth/account';
import { UserFacingError } from '@/lib/auth/account';
import { lookupAgentShareTarget } from '@/lib/inventory/agent-account-share';
import { createNotification } from '@/lib/notifications/create';
import { requirementReference, isShareable } from '@/lib/requirements/share';

const MAX_PROPERTIES_PER_RESPONSE = 25;

export interface AccountRequirementBrief {
  reference: string;
  classification: string;
  requirements: string | null;
  noBudget: boolean;
  minBudget: number | null;
  maxBudget: number | null;
  areas: string[];
  projects: string[];
  propertyTypes: string[];
}

interface RequirementRow {
  id: string;
  classification: string | null;
  requirements: string | null;
  requirement_active: boolean | null;
  no_budget: boolean | null;
  min_budget: number | string | null;
  max_budget: number | string | null;
  pref_budget_min: number | string | null;
  pref_budget_max: number | string | null;
  areas_of_interest: string[] | null;
  pref_areas: string[] | null;
  projects_of_interest: string[] | null;
  pref_projects: string[] | null;
  property_interests: string[] | null;
  pref_property_categories: string[] | null;
  pref_property_types: string[] | null;
}

export interface RequirementAccountShareSummary {
  id: string;
  reference: string;
  brief: AccountRequirementBrief;
  senderName: string | null;
  senderAccountName: string;
  recipientAccountId: string;
  recipientUserId: string;
  status: 'sent' | 'viewed' | 'responded' | 'declined';
  viewedAt: string | null;
  respondedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  responseCount: number;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clean(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function buildAccountRequirementBrief(
  row: RequirementRow
): AccountRequirementBrief {
  return {
    reference: requirementReference(row.id),
    classification: row.classification || 'Buyer',
    requirements: row.requirements?.trim() || null,
    noBudget: row.no_budget === true,
    minBudget: numberOrNull(row.min_budget) ?? numberOrNull(row.pref_budget_min),
    maxBudget: numberOrNull(row.max_budget) ?? numberOrNull(row.pref_budget_max),
    areas: clean([...(row.areas_of_interest ?? []), ...(row.pref_areas ?? [])]),
    projects: clean([
      ...(row.projects_of_interest ?? []),
      ...(row.pref_projects ?? []),
    ]),
    propertyTypes: clean([
      ...(row.property_interests ?? []),
      ...(row.pref_property_categories ?? []),
      ...(row.pref_property_types ?? []),
    ]),
  };
}

export async function shareRequirementWithAgent(
  ctx: AccountContext,
  requirementContactId: string,
  recipientContactId: string
): Promise<{
  registered: boolean;
  recipientName: string;
  share: RequirementAccountShareSummary | null;
  alreadyShared: boolean;
}> {
  const target = await lookupAgentShareTarget(ctx, recipientContactId);
  const recipientName = target.contact.name || 'This agent';
  if (!target.recipient) {
    return {
      registered: false,
      recipientName,
      share: null,
      alreadyShared: false,
    };
  }

  const { data: rawRequirement, error: requirementError } = await ctx.supabase
    .from('contacts')
    .select(
      'id, classification, requirements, requirement_active, no_budget, min_budget, max_budget, pref_budget_min, pref_budget_max, areas_of_interest, pref_areas, projects_of_interest, pref_projects, property_interests, pref_property_categories, pref_property_types'
    )
    .eq('id', requirementContactId)
    .eq('account_id', ctx.accountId)
    .in('classification', ['Buyer', 'Owner & Buyer'])
    .maybeSingle();
  if (requirementError) throw requirementError;
  if (!rawRequirement) throw new UserFacingError('Buyer requirement not found');

  const row = rawRequirement as RequirementRow;
  const brief = buildAccountRequirementBrief(row);
  if (
    !isShareable({
      id: row.id,
      requirements: brief.requirements,
      requirement_active: row.requirement_active,
      no_budget: brief.noBudget,
      min_budget: brief.minBudget,
      max_budget: brief.maxBudget,
      areas_of_interest: brief.areas,
      projects_of_interest: brief.projects,
    })
  ) {
    throw new UserFacingError(
      row.requirement_active === false
        ? 'Reactivate this requirement before sharing it'
        : 'Add a requirement, location or budget before sharing it'
    );
  }

  const { data: existing, error: existingError } = await target.admin
    .from('requirement_account_shares')
    .select(
      'id, reference, brief, sender_name, sender_account_name, recipient_account_id, recipient_user_id, status, viewed_at, responded_at, declined_at, created_at'
    )
    .eq('account_id', ctx.accountId)
    .eq('contact_id', requirementContactId)
    .eq('recipient_user_id', target.recipient.user_id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return {
      registered: true,
      recipientName,
      share: toSummary(existing, 0),
      alreadyShared: true,
    };
  }

  const { data: inserted, error: insertError } = await target.admin
    .from('requirement_account_shares')
    .insert({
      account_id: ctx.accountId,
      contact_id: requirementContactId,
      sender_user_id: ctx.userId,
      recipient_account_id: target.recipient.account_id,
      recipient_user_id: target.recipient.user_id,
      recipient_contact_id: recipientContactId,
      reference: brief.reference,
      brief,
      sender_name: target.senderProfile?.full_name || null,
      sender_account_name: ctx.account.name,
    })
    .select(
      'id, reference, brief, sender_name, sender_account_name, recipient_account_id, recipient_user_id, status, viewed_at, responded_at, declined_at, created_at'
    )
    .single();
  if (insertError) throw insertError;

  await createNotification({
    accountId: target.recipient.account_id,
    userId: target.recipient.user_id,
    type: 'requirement_shared',
    title: 'Buyer requirement shared with you',
    body: `${ctx.account.name} shared ${brief.reference}. Open it to review the brief and respond from your inventory.`,
    entityType: 'requirement_account_share',
    entityId: inserted.id,
    link: `/shared-requirements?share=${inserted.id}`,
    channels: { inApp: true, push: true, whatsapp: false },
  });

  return {
    registered: true,
    recipientName,
    share: toSummary(inserted, 0),
    alreadyShared: false,
  };
}

export async function listRequirementAccountShares(
  ctx: AccountContext,
  box: 'received' | 'sent'
): Promise<RequirementAccountShareSummary[]> {
  const admin = (await lookupAdmin());
  let query = admin
    .from('requirement_account_shares')
    .select(
      'id, reference, brief, sender_name, sender_account_name, recipient_account_id, recipient_user_id, status, viewed_at, responded_at, declined_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  query =
    box === 'received'
      ? query
          .eq('recipient_account_id', ctx.accountId)
          .eq('recipient_user_id', ctx.userId)
      : query.eq('account_id', ctx.accountId);

  const { data, error } = await query;
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id as string);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: responses, error: responseError } = await admin
      .from('requirement_account_share_responses')
      .select('share_id')
      .in('share_id', ids);
    if (responseError) throw responseError;
    for (const response of responses ?? []) {
      const id = response.share_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return (data ?? []).map((row) => toSummary(row, counts.get(row.id as string) ?? 0));
}

export async function getRequirementAccountShare(
  ctx: AccountContext,
  shareId: string
): Promise<{
  share: RequirementAccountShareSummary;
  properties: Array<{
    id: string;
    title: string;
    location: string | null;
    price: number | null;
    status: string | null;
  }>;
  responsePropertyIds: string[];
  responseProperties: Array<{
    id: string;
    title: string;
    location: string | null;
    price: number | null;
    status: string | null;
  }>;
}> {
  const admin = await lookupAdmin();
  const { data: share, error } = await admin
    .from('requirement_account_shares')
    .select(
      'id, account_id, reference, brief, sender_name, sender_account_name, recipient_account_id, recipient_user_id, status, viewed_at, responded_at, declined_at, created_at'
    )
    .eq('id', shareId)
    .maybeSingle();
  if (error) throw error;
  if (!share) throw new UserFacingError('Shared requirement not found', 404);

  const isRecipient =
    share.recipient_account_id === ctx.accountId &&
    share.recipient_user_id === ctx.userId;
  const isSender = share.account_id === ctx.accountId;
  if (!isRecipient && !isSender) {
    throw new UserFacingError('Shared requirement not found', 404);
  }

  if (isRecipient && !share.viewed_at) {
    const viewedAt = new Date().toISOString();
    const { error: viewError } = await admin
      .from('requirement_account_shares')
      .update({ viewed_at: viewedAt, status: 'viewed' })
      .eq('id', shareId)
      .eq('recipient_account_id', ctx.accountId)
      .eq('recipient_user_id', ctx.userId)
      .eq('status', 'sent');
    if (viewError) throw viewError;
    share.viewed_at = viewedAt;
    share.status = 'viewed';
  }

  const [{ data: responseRows, error: responseError }, inventory] =
    await Promise.all([
      admin
        .from('requirement_account_share_responses')
        .select('property_id')
        .eq('share_id', shareId),
      isRecipient
        ? admin
            .from('properties')
            .select('id, title, location, price, status')
            .eq('account_id', ctx.accountId)
            .neq('status', 'Sold')
            .order('updated_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (responseError) throw responseError;
  if (inventory.error) throw inventory.error;

  const responsePropertyIds = (responseRows ?? []).map(
    (response) => response.property_id as string
  );
  let responseProperties: Array<{
    id: string;
    title: string;
    location: string | null;
    price: number | null;
    status: string | null;
  }> = [];
  if (responsePropertyIds.length > 0) {
    const { data: rows, error: rowsError } = await admin
      .from('properties')
      .select('id, title, location, price, status')
      .eq('account_id', share.recipient_account_id)
      .in('id', responsePropertyIds);
    if (rowsError) throw rowsError;
    responseProperties = (rows ?? []).map((property) => ({
      id: property.id as string,
      title: (property.title as string) || 'Untitled property',
      location: (property.location as string | null) ?? null,
      price: numberOrNull(property.price as number | string | null),
      status: (property.status as string | null) ?? null,
    }));
  }

  return {
    share: toSummary(share, responsePropertyIds.length),
    properties: (inventory.data ?? []).map((property) => ({
      id: property.id as string,
      title: (property.title as string) || 'Untitled property',
      location: (property.location as string | null) ?? null,
      price: numberOrNull(property.price as number | string | null),
      status: (property.status as string | null) ?? null,
    })),
    responsePropertyIds,
    responseProperties,
  };
}

export async function respondToRequirementAccountShare(
  ctx: AccountContext,
  shareId: string,
  propertyIds: string[],
  note: string | null
): Promise<{ responseCount: number }> {
  const ids = [...new Set(propertyIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new UserFacingError('Select at least one matching property');
  }
  if (ids.length > MAX_PROPERTIES_PER_RESPONSE) {
    throw new UserFacingError(
      `Choose no more than ${MAX_PROPERTIES_PER_RESPONSE} properties`
    );
  }

  const admin = await lookupAdmin();
  const { data: share, error: shareError } = await admin
    .from('requirement_account_shares')
    .select(
      'id, account_id, sender_user_id, reference, recipient_account_id, recipient_user_id'
    )
    .eq('id', shareId)
    .eq('recipient_account_id', ctx.accountId)
    .eq('recipient_user_id', ctx.userId)
    .maybeSingle();
  if (shareError) throw shareError;
  if (!share) throw new UserFacingError('Shared requirement not found', 404);

  const { data: properties, error: propertyError } = await admin
    .from('properties')
    .select('id')
    .eq('account_id', ctx.accountId)
    .in('id', ids);
  if (propertyError) throw propertyError;
  if ((properties ?? []).length !== ids.length) {
    throw new UserFacingError('One or more selected properties were not found');
  }

  const normalizedNote = note?.trim().slice(0, 1000) || null;
  const { error: responseError } = await admin
    .from('requirement_account_share_responses')
    .upsert(
      ids.map((propertyId) => ({
        account_id: ctx.accountId,
        sender_account_id: share.account_id,
        share_id: shareId,
        property_id: propertyId,
        responder_user_id: ctx.userId,
        note: normalizedNote,
      })),
      { onConflict: 'share_id,property_id', ignoreDuplicates: true }
    );
  if (responseError) throw responseError;

  const respondedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from('requirement_account_shares')
    .update({ status: 'responded', responded_at: respondedAt })
    .eq('id', shareId)
    .eq('recipient_account_id', ctx.accountId)
    .eq('recipient_user_id', ctx.userId);
  if (updateError) throw updateError;

  if (share.sender_user_id) {
    await createNotification({
      accountId: share.account_id,
      userId: share.sender_user_id,
      type: 'requirement_response',
      title: 'Agent responded to a buyer requirement',
      body: `${share.reference} received ${ids.length} matching ${ids.length === 1 ? 'property' : 'properties'}.`,
      entityType: 'requirement_account_share',
      entityId: shareId,
      link: `/shared-requirements?box=sent&share=${shareId}`,
      channels: { inApp: true, push: true, whatsapp: false },
    });
  }

  return { responseCount: ids.length };
}

export async function declineRequirementAccountShare(
  ctx: AccountContext,
  shareId: string
): Promise<void> {
  const admin = await lookupAdmin();
  const declinedAt = new Date().toISOString();
  const { data, error } = await admin
    .from('requirement_account_shares')
    .update({ status: 'declined', declined_at: declinedAt })
    .eq('id', shareId)
    .eq('recipient_account_id', ctx.accountId)
    .eq('recipient_user_id', ctx.userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('Shared requirement not found', 404);
}

function toSummary(
  row: Record<string, unknown>,
  responseCount: number
): RequirementAccountShareSummary {
  return {
    id: row.id as string,
    reference: row.reference as string,
    brief: row.brief as AccountRequirementBrief,
    senderName: (row.sender_name as string | null) ?? null,
    senderAccountName: row.sender_account_name as string,
    recipientAccountId: row.recipient_account_id as string,
    recipientUserId: row.recipient_user_id as string,
    status: row.status as RequirementAccountShareSummary['status'],
    viewedAt: (row.viewed_at as string | null) ?? null,
    respondedAt: (row.responded_at as string | null) ?? null,
    declinedAt: (row.declined_at as string | null) ?? null,
    createdAt: row.created_at as string,
    responseCount,
  };
}

async function lookupAdmin() {
  const { supabaseAdmin } = await import('@/lib/automations/admin-client');
  return supabaseAdmin();
}
