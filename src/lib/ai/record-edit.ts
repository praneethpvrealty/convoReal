// ============================================================
// Quote-reply corrections to a committed contact or property.
//
// The draft-session flow already applies conversational edits while a
// draft is open (updateListingDraft / updateContactDraft). Once the
// record is committed the session is gone, so a correction typed
// against the "✅ created" card had nowhere to land and was read as a
// fresh ingestion. bot_message_targets (migration 185) names the row;
// this applies the instruction to it.
//
// Fields are whitelisted per entity rather than taking whatever the
// model returns — an edit must not be able to reassign account_id,
// flip is_published, or rewrite ids.
// ============================================================

import { generateJsonFromParts } from '@/lib/ai/gemini';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type EditableEntity = 'contact' | 'property';

const EDITABLE_FIELDS: Record<EditableEntity, string[]> = {
  contact: ['name', 'email', 'classification', 'notes'],
  property: [
    'title',
    'description',
    'price',
    'location',
    'sublocality',
    'city',
    'type',
    'status',
    'bedrooms',
    'bathrooms',
    'area_sqft',
    'facing_direction',
  ],
};

const NUMERIC_FIELDS = new Set(['price', 'bedrooms', 'bathrooms', 'area_sqft']);

/** Only the whitelisted keys, only when the model actually changed
 *  them, coerced to the column's type. */
export function buildRecordPatch(
  entityType: EditableEntity,
  current: Record<string, unknown>,
  proposed: unknown
): Record<string, unknown> {
  const obj = (proposed && typeof proposed === 'object' ? proposed : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS[entityType]) {
    if (!(field in obj)) continue;
    const raw = obj[field];
    if (raw === undefined) continue;

    let value: unknown = raw;
    if (NUMERIC_FIELDS.has(field)) {
      if (raw === null || raw === '') {
        value = null;
      } else if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) continue;
        value = raw;
      } else {
        // "call for price" strips to "", and Number('') is 0 — which
        // would silently mark a listing free rather than skip the edit.
        const digits = String(raw).replace(/[^0-9.]/g, '');
        if (!digits) continue;
        const n = Number(digits);
        if (!Number.isFinite(n)) continue;
        value = n;
      }
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      value = trimmed;
    } else if (raw !== null) {
      continue;
    }

    if (value !== current[field]) patch[field] = value;
  }
  return patch;
}

export async function parseRecordUpdate(params: {
  entityType: EditableEntity;
  current: Record<string, unknown>;
  instruction: string;
}): Promise<Record<string, unknown>> {
  const fields = EDITABLE_FIELDS[params.entityType];
  const current = Object.fromEntries(fields.map((f) => [f, params.current[f] ?? null]));

  const system =
    `You are a CRM data editor. The user is correcting an existing ${params.entityType} record.\n` +
    `Apply their instruction and return the record as it should now read, as JSON with exactly these keys: ${fields.join(', ')}.\n` +
    'Carry every field the instruction does not mention through UNCHANGED. Never blank a field just because it went unmentioned. ' +
    'Prices are plain rupee numbers (1.2 crore -> 12000000). ' +
    'If the instruction is not an edit to this record at all, return the record exactly as given.\n\n' +
    `Current record:\n${JSON.stringify(current, null, 2)}\n\n` +
    'Respond with ONLY the JSON object.';

  const raw = await generateJsonFromParts([{ text: params.instruction }], system, {
    tier: 'lite',
    feature: 'chatbot_classify',
  });

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as Record<string, unknown>) : {};
  }
}

/** Returns the applied patch, 'stale' when the row is gone, or null
 *  when nothing changed. */
export async function applyRecordUpdate(params: {
  entityType: EditableEntity;
  entityId: string;
  accountId: string;
  instruction: string;
}): Promise<Record<string, unknown> | 'stale' | null> {
  const admin = supabaseAdmin();
  const table = params.entityType === 'contact' ? 'contacts' : 'properties';

  const { data: row, error } = await admin
    .from(table)
    .select('*')
    .eq('id', params.entityId)
    .eq('account_id', params.accountId)
    .maybeSingle();
  if (error) {
    console.error('[record-edit] fetch failed:', error);
    return null;
  }
  if (!row) return 'stale';

  const proposed = await parseRecordUpdate({
    entityType: params.entityType,
    current: row as Record<string, unknown>,
    instruction: params.instruction,
  });
  const patch = buildRecordPatch(params.entityType, row as Record<string, unknown>, proposed);
  if (Object.keys(patch).length === 0) return null;

  const { error: updErr } = await admin
    .from(table)
    .update(patch)
    .eq('id', params.entityId)
    .eq('account_id', params.accountId);
  if (updErr) {
    console.error('[record-edit] update failed:', updErr);
    return null;
  }
  return patch;
}
