import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  buildSharedPropertyCopy,
  SHARED_PROPERTY_COLUMNS,
} from '@/lib/inventory/shared-property-copy';

interface RecipientProfile {
  user_id: string;
  account_id: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `agent:shareInventoryAccount:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const [{ id }, body] = await Promise.all([
      params,
      request.json().catch(() => null),
    ]);
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : '';
    if (!id || !contactId) {
      return NextResponse.json(
        { error: 'Property and agent contact are required' },
        { status: 400 }
      );
    }

    const [
      { data: sourceRow },
      { data: targetContact },
      { data: senderProfile },
    ] = await Promise.all([
      ctx.supabase
        .from('properties')
        .select(SHARED_PROPERTY_COLUMNS)
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
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

    const source = sourceRow as Record<string, unknown> | null;
    if (!source) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }
    const phoneLast10 = normalizePhone(targetContact?.phone).slice(-10);
    if (!targetContact || !phoneLast10) {
      return NextResponse.json(
        { error: 'Select an Agent contact with a valid phone number' },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: recipientRows, error: recipientError } = await admin.rpc(
      'find_agent_profile_accounts',
      { p_phone_last10: phoneLast10 }
    );
    if (recipientError) throw recipientError;
    const recipient = ((recipientRows ?? []) as RecipientProfile[]).find(
      (row) => row.account_id !== ctx.accountId
    );
    if (!recipient) {
      return NextResponse.json(
        {
          error: `${targetContact.name || 'This agent'} does not have a separate ConvoReal account yet`,
        },
        { status: 404 }
      );
    }

    const { data: existing } = await admin
      .from('properties')
      .select('id, status')
      .eq('account_id', recipient.account_id)
      .eq('source_property_id', source.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          error:
            existing.status === 'Pending Review'
              ? 'This property is already waiting for that agent’s review'
              : 'This property is already in that agent’s inventory',
        },
        { status: 409 }
      );
    }

    const { data: senderAccount } = await admin
      .from('accounts')
      .select('name')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const senderContact = await findOrCreateContact(admin, {
      accountId: recipient.account_id,
      userId: recipient.user_id,
      phone: senderProfile?.phone,
      name: senderProfile?.full_name,
      company: senderAccount?.name,
      source: 'ConvoReal Inventory Share',
      classification: 'Agent',
    });

    const { data: pending, error: insertError } = await admin
      .from('properties')
      .upsert(
        buildSharedPropertyCopy(source, {
          accountId: recipient.account_id,
          userId: recipient.user_id,
          ownerContactId: senderContact.contactId,
          status: 'Pending Review',
        }),
        {
          onConflict: 'account_id,source_property_id',
          ignoreDuplicates: true,
        }
      )
      .select('id, title, status')
      .maybeSingle();
    if (insertError) throw insertError;
    if (!pending) {
      return NextResponse.json(
        { error: 'This property is already shared with that agent' },
        { status: 409 }
      );
    }

    return NextResponse.json({ data: pending }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
