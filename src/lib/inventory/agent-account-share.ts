import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AccountContext } from '@/lib/auth/account';
import { UserFacingError } from '@/lib/auth/account';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  buildSharedPropertyCopy,
  SHARED_PROPERTY_COLUMNS,
} from '@/lib/inventory/shared-property-copy';

const MAX_PROPERTIES_PER_SHARE = 25;

interface RecipientProfile {
  user_id: string;
  account_id: string;
}

interface AgentShareTarget {
  admin: SupabaseClient;
  contact: { id: string; name: string | null; phone: string };
  recipient: RecipientProfile | null;
  senderProfile: { full_name: string | null; phone: string | null } | null;
}

export interface AgentInventoryShareResult {
  registered: boolean;
  recipientName: string;
  sharedCount: number;
  alreadySharedCount: number;
  pending: Array<{ id: string; title: string; status: string }>;
}

export async function lookupAgentShareTarget(
  ctx: AccountContext,
  contactId: string
): Promise<AgentShareTarget> {
  const [{ data: targetContact }, { data: senderProfile }] = await Promise.all([
    ctx.supabase
      .from('contacts')
      .select('id, name, phone, classification')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .eq('classification', 'Agent')
      .maybeSingle(),
    ctx.supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('user_id', ctx.userId)
      .maybeSingle(),
  ]);

  const phoneLast10 = normalizePhone(targetContact?.phone).slice(-10);
  if (!targetContact || !phoneLast10) {
    throw new UserFacingError(
      'Select an Agent contact with a valid phone number'
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: recipientRows, error } = await admin.rpc(
    'find_agent_profile_accounts',
    { p_phone_last10: phoneLast10 }
  );
  if (error) throw error;

  return {
    admin,
    contact: {
      id: targetContact.id,
      name: targetContact.name,
      phone: targetContact.phone,
    },
    recipient:
      ((recipientRows ?? []) as RecipientProfile[]).find(
        (row) => row.account_id !== ctx.accountId
      ) ?? null,
    senderProfile,
  };
}

export async function shareInventoryWithAgent(
  ctx: AccountContext,
  contactId: string,
  propertyIds: string[]
): Promise<AgentInventoryShareResult> {
  const ids = [...new Set(propertyIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length > MAX_PROPERTIES_PER_SHARE) {
    throw new UserFacingError(
      `Choose no more than ${MAX_PROPERTIES_PER_SHARE} properties at a time`
    );
  }

  const target = await lookupAgentShareTarget(ctx, contactId);
  const recipientName = target.contact.name || 'This agent';
  if (!target.recipient || ids.length === 0) {
    return {
      registered: Boolean(target.recipient),
      recipientName,
      sharedCount: 0,
      alreadySharedCount: 0,
      pending: [],
    };
  }

  const { data: sourceRows, error: sourceError } = await ctx.supabase
    .from('properties')
    .select(SHARED_PROPERTY_COLUMNS)
    .eq('account_id', ctx.accountId)
    .in('id', ids);
  if (sourceError) throw sourceError;
  const sources = (sourceRows ?? []) as unknown as Record<string, unknown>[];
  if (sources.length !== ids.length) {
    throw new UserFacingError('One or more selected properties were not found');
  }

  const { data: existingRows, error: existingError } = await target.admin
    .from('properties')
    .select('source_property_id')
    .eq('account_id', target.recipient.account_id)
    .in('source_property_id', ids);
  if (existingError) throw existingError;
  const existingIds = new Set(
    (existingRows ?? []).map((row) => row.source_property_id as string)
  );
  const newSources = sources.filter(
    (source) => !existingIds.has(String(source.id))
  );

  if (newSources.length === 0) {
    return {
      registered: true,
      recipientName,
      sharedCount: 0,
      alreadySharedCount: existingIds.size,
      pending: [],
    };
  }

  const { data: senderAccount } = await target.admin
    .from('accounts')
    .select('name')
    .eq('id', ctx.accountId)
    .maybeSingle();
  const senderContact = await findOrCreateContact(target.admin, {
    accountId: target.recipient.account_id,
    userId: target.recipient.user_id,
    phone: target.senderProfile?.phone,
    name: target.senderProfile?.full_name,
    company: senderAccount?.name,
    source: 'ConvoReal Inventory Share',
    classification: 'Agent',
  });

  const copies = newSources.map((source) =>
    buildSharedPropertyCopy(source, {
      accountId: target.recipient!.account_id,
      userId: target.recipient!.user_id,
      ownerContactId: senderContact.contactId,
      status: 'Pending Review',
    })
  );
  const { data: pending, error: insertError } = await target.admin
    .from('properties')
    .upsert(copies, {
      onConflict: 'account_id,source_property_id',
      ignoreDuplicates: true,
    })
    .select('id, title, status');
  if (insertError) throw insertError;

  const inserted = (pending ?? []) as Array<{
    id: string;
    title: string;
    status: string;
  }>;
  return {
    registered: true,
    recipientName,
    sharedCount: inserted.length,
    alreadySharedCount: ids.length - inserted.length,
    pending: inserted,
  };
}
