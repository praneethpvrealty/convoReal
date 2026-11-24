import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/whatsapp/phone-utils';

import { writeDealEvent, type DealEventSource } from './events';
import {
  DEAL_PARTICIPANT_ROLE_LABELS,
  participantRoleForStakeholder,
  participantsToStore,
  stakeholderFieldsForParticipant,
  type DealParticipantInput,
} from './participants';

interface ParticipantContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

interface SyncInput {
  db: SupabaseClient;
  accountId: string;
  dealId: string;
  userId: string;
  actorName: string | null;
  source: DealEventSource;
  participants: readonly DealParticipantInput[];
}

export interface ParticipantSyncResult {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

/** Every named contact, or null when one is not in this account. */
export async function loadParticipantContacts(
  db: SupabaseClient,
  accountId: string,
  contactIds: readonly string[]
): Promise<Map<string, ParticipantContact> | null> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone, email')
    .eq('account_id', accountId)
    .in('id', ids);
  if (error || (data ?? []).length !== ids.length) return null;
  return new Map((data as ParticipantContact[]).map((c) => [c.id, c]));
}

function stakeholderPhone(raw: string | null): string | null {
  const digits = normalizePhone(raw ?? '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Makes the deal's contact-linked buyer, seller and broker
 * stakeholders match `participants`: adds the missing, re-roles the
 * changed and removes the ones no longer listed. Stakeholders typed
 * in by hand (no contact) and the other roles are never touched.
 *
 * A lone buyer gets no new row (they are simply the deal's contact),
 * but a row they already have is kept: it may carry a share link.
 */
export async function syncDealParticipants(
  input: SyncInput
): Promise<ParticipantSyncResult> {
  const { db, accountId, dealId, participants } = input;
  const result: ParticipantSyncResult = {
    ok: true,
    added: 0,
    updated: 0,
    removed: 0,
  };

  const contacts = await loadParticipantContacts(
    db,
    accountId,
    participants.map((p) => p.contact_id)
  );
  if (!contacts) {
    return { ...result, ok: false, error: 'One or more contacts are invalid' };
  }

  const { data: existingRows, error: existingErr } = await db
    .from('deal_stakeholders')
    .select('id, contact_id, name, role')
    .eq('deal_id', dealId)
    .eq('account_id', accountId)
    .not('contact_id', 'is', null);
  if (existingErr) {
    return { ...result, ok: false, error: existingErr.message };
  }
  const managed = (
    (existingRows ?? []) as {
      id: string;
      contact_id: string;
      name: string;
      role: string;
    }[]
  ).filter((row) => participantRoleForStakeholder(row.role) !== null);
  const byContact = new Map(managed.map((row) => [row.contact_id, row]));
  const wanted = new Set(participants.map((p) => p.contact_id));
  const creatable = new Set(
    participantsToStore(participants).map((p) => p.contact_id)
  );

  const event = (
    eventType:
      'stakeholder_added' | 'stakeholder_updated' | 'stakeholder_removed',
    title: string,
    stakeholderId: string
  ) =>
    writeDealEvent({
      db,
      accountId,
      dealId,
      eventType,
      title,
      actorId: input.userId,
      actorName: input.actorName,
      source: input.source,
      metadata: { stakeholder_id: stakeholderId },
    }).catch(() => null);

  for (const participant of participants) {
    const fields = stakeholderFieldsForParticipant(participant.role);
    const label = DEAL_PARTICIPANT_ROLE_LABELS[participant.role];
    const current = byContact.get(participant.contact_id);
    if (current) {
      if (current.role === fields.role) continue;
      const { error } = await db
        .from('deal_stakeholders')
        .update(fields)
        .eq('id', current.id)
        .eq('account_id', accountId);
      if (error) return { ...result, ok: false, error: error.message };
      result.updated += 1;
      await event(
        'stakeholder_updated',
        `Stakeholder updated: ${current.name}`,
        current.id
      );
      continue;
    }
    if (!creatable.has(participant.contact_id)) continue;
    const contact = contacts.get(participant.contact_id)!;
    const name = (contact.name ?? '').trim() || contact.phone || 'Contact';
    const { data: created, error } = await db
      .from('deal_stakeholders')
      .insert({
        account_id: accountId,
        deal_id: dealId,
        created_by: input.userId,
        contact_id: contact.id,
        name: name.slice(0, 120),
        phone: stakeholderPhone(contact.phone),
        email: contact.email?.trim().toLowerCase() || null,
        ...fields,
      })
      .select('id')
      .single();
    if (error || !created) {
      return {
        ...result,
        ok: false,
        error: error?.message ?? 'Could not add a contact to the deal',
      };
    }
    result.added += 1;
    await event('stakeholder_added', `${label} added: ${name}`, created.id);
  }

  for (const row of managed) {
    if (wanted.has(row.contact_id)) continue;
    const { error } = await db
      .from('deal_stakeholders')
      .delete()
      .eq('id', row.id)
      .eq('account_id', accountId);
    if (error) return { ...result, ok: false, error: error.message };
    result.removed += 1;
    await event(
      'stakeholder_removed',
      `Stakeholder removed: ${row.name}`,
      row.id
    );
  }

  return result;
}
