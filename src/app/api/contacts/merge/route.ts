import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { buildContactMergePatch } from '@/lib/contacts/merge';

// POST /api/contacts/merge
// Body: { sourceId: string, targetId: string }
//
// Merges `source` into `target`:
//   1. Re-points conversations, notes, custom values, inquiries, appointments, and todos → target
//   2. Safely merges tags, custom values, and inquiries without duplicate constraint errors
//   3. Merges preferences (budgets, ROI, interest areas, specifications, requirements)
//   4. Marks source as is_merged = true, sets merged_into_id = target
//   5. Inserts a merge log note on the target contact card
//   6. Writes a merge log entry
//
// Requires agent+ role. Both contacts must belong to the caller's account.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json() as { sourceId?: string; targetId?: string };

    const { sourceId, targetId } = body;
    if (!sourceId || !targetId) {
      return NextResponse.json({ error: 'sourceId and targetId are required' }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: 'Source and target must be different contacts' }, { status: 400 });
    }

    const admin = adminClient();

    // Verify both contacts belong to the caller's account and are not already merged
    const { data: contacts, error: fetchErr } = await admin
      .from('contacts')
      .select('id, account_id, name, email, phone, secondary_phones, min_budget, max_budget, no_budget, min_roi, areas_of_interest, property_interests, source, classification, referrer, referrer_contact_id, is_merged, company, lead_temp, requirements, assigned_agent_id, assigned_team_id')
      .in('id', [sourceId, targetId])
      .eq('account_id', ctx.accountId);

    if (fetchErr) throw fetchErr;
    if (!contacts || contacts.length !== 2) {
      return NextResponse.json({ error: 'One or both contacts not found in your account' }, { status: 404 });
    }

    const source = contacts.find((c) => c.id === sourceId)!;
    const target = contacts.find((c) => c.id === targetId)!;

    if (source.is_merged) {
      return NextResponse.json({ error: 'Source contact is already merged' }, { status: 400 });
    }
    if (target.is_merged) {
      return NextResponse.json({ error: 'The contact to keep is already merged' }, { status: 400 });
    }

    // ── 1. Re-point child rows from source → target ────────────────────────

    const { error: conversationMergeError } = await admin.rpc(
      'merge_contact_conversations',
      {
        p_account_id: ctx.accountId,
        p_source_contact_id: sourceId,
        p_target_contact_id: targetId,
      }
    );
    if (conversationMergeError) throw conversationMergeError;

    // Notes, appointments, and todos — always re-point safely
    await Promise.all([
      admin.from('contact_notes')
        .update({ contact_id: targetId })
        .eq('contact_id', sourceId),

      admin.from('appointments')
        .update({ contact_id: targetId })
        .eq('contact_id', sourceId),

      admin.from('todos')
        .update({ contact_id: targetId })
        .eq('contact_id', sourceId),
    ]);

    // Tags — merge relations safely without duplicate key violation
    const { data: targetTags } = await admin
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', targetId);

    const { data: sourceTags } = await admin
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', sourceId);

    const targetTagIds = new Set((targetTags || []).map((t) => t.tag_id));
    const tagsToInsert = (sourceTags || [])
      .map((t) => t.tag_id)
      .filter((tagId) => !targetTagIds.has(tagId));

    if (tagsToInsert.length > 0) {
      await admin.from('contact_tags').insert(
        tagsToInsert.map((tagId) => ({
          contact_id: targetId,
          tag_id: tagId,
        }))
      );
    }
    await admin.from('contact_tags').delete().eq('contact_id', sourceId);

    // Custom Fields — merge values safely without duplicate key violation
    const { data: targetVals } = await admin
      .from('contact_custom_values')
      .select('field_id')
      .eq('contact_id', targetId);

    const { data: sourceVals } = await admin
      .from('contact_custom_values')
      .select('field_id, value, account_id')
      .eq('contact_id', sourceId);

    const targetFieldIds = new Set((targetVals || []).map((v) => v.field_id));
    const valsToInsert = (sourceVals || [])
      .filter((v) => !targetFieldIds.has(v.field_id));

    if (valsToInsert.length > 0) {
      await admin.from('contact_custom_values').insert(
        valsToInsert.map((v) => ({
          contact_id: targetId,
          field_id: v.field_id,
          value: v.value,
          account_id: v.account_id || ctx.accountId,
        }))
      );
    }
    await admin.from('contact_custom_values').delete().eq('contact_id', sourceId);

    // Property Inquiries — merge relations safely without duplicate key violation
    const { data: targetInqs } = await admin
      .from('contact_property_inquiries')
      .select('property_id')
      .eq('contact_id', targetId);

    const { data: sourceInqs } = await admin
      .from('contact_property_inquiries')
      .select('property_id, account_id')
      .eq('contact_id', sourceId);

    const targetPropIds = new Set((targetInqs || []).map((i) => i.property_id));
    const inqsToInsert = (sourceInqs || [])
      .filter((i) => !targetPropIds.has(i.property_id));

    if (inqsToInsert.length > 0) {
      await admin.from('contact_property_inquiries').insert(
        inqsToInsert.map((i) => ({
          contact_id: targetId,
          property_id: i.property_id,
          account_id: i.account_id || ctx.accountId,
        }))
      );
    }
    await admin.from('contact_property_inquiries').delete().eq('contact_id', sourceId);

    // ── 2. Fill gaps and merge preferences on target ───────────────────────
    const patch = buildContactMergePatch(
      source,
      target,
      new Date().toISOString()
    );
    await admin.from('contacts').update(patch).eq('id', targetId);

    // ── 3. Soft-delete source ──────────────────────────────────────────────
    await admin.from('contacts').update({
      is_merged: true,
      merged_into_id: targetId,
      updated_at: new Date().toISOString(),
    }).eq('id', sourceId);

    // ── 4. Add system note on target contact detailing the merge ───────────
    const mergeDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    await admin.from('contact_notes').insert({
      contact_id: targetId,
      user_id: ctx.userId,
      account_id: ctx.accountId,
      note_text: `Contacts got merged on - ${mergeDate}`,
    });

    // ── 5. Write merge log ────────────────────────────────────────────────
    await admin.from('contact_merge_log').insert({
      account_id: ctx.accountId,
      merged_by: ctx.userId,
      source_id: sourceId,
      target_id: targetId,
      source_snapshot: source,
    });

    return NextResponse.json({ success: true, targetId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
