// A template the Engine submits to Meta once per account, on its own,
// and reuses for every send of its kind — the occasion greeting and
// the broadcast update both work this way. PENDING / REJECTED / DRAFT
// rows are left alone so a rejection never loops back into Meta.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  submitMessageTemplate,
  uploadSampleMedia,
} from '@/lib/whatsapp/meta-api';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import type { MessageTemplate } from '@/types';

export interface SharedTemplateState {
  status: string | null;
  template: MessageTemplate | null;
  rejectionReason: string | null;
  setupError: 'whatsapp_not_connected' | 'submission_failed' | null;
}

export function templateOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  );
}

/**
 * The account's latest row under `name`, without touching Meta.
 *
 * DESC sorts NULLS FIRST, so without nullsFirst a never-submitted draft
 * outranks the approved row and every send is refused.
 */
export async function readSharedTemplateState(
  db: SupabaseClient,
  accountId: string,
  name: string
): Promise<SharedTemplateState> {
  const { data: latestRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', name)
    .order('last_submitted_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) {
    return {
      status: null,
      template: null,
      rejectionReason: null,
      setupError: null,
    };
  }
  const template = latestRow as unknown as MessageTemplate;
  const status = String(template.status ?? '').toUpperCase();
  return {
    status,
    template: status === 'APPROVED' ? template : null,
    rejectionReason: template.rejection_reason ?? null,
    setupError: null,
  };
}

/**
 * Returns the account's state for the shared template, submitting the
 * canned payload to Meta when the account has no row for it at all.
 */
export async function ensureSharedTemplate(
  accountId: string,
  name: string,
  buildPayload: (origin: string) => TemplatePayload,
  logTag: string
): Promise<SharedTemplateState> {
  const db = supabaseAdmin();
  const existing = await readSharedTemplateState(db, accountId, name);
  if (existing.status !== null) return existing;

  try {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (
      !config?.waba_id ||
      !config.access_token ||
      config.integration_type === 'sandbox'
    ) {
      return { ...existing, setupError: 'whatsapp_not_connected' };
    }

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.owner_user_id) {
      return { ...existing, setupError: 'submission_failed' };
    }

    const payload = buildPayload(templateOrigin());
    const accessToken = decrypt(config.access_token as string);

    // Meta rejects a plain URL for media headers ("Missing sample
    // parameter") — the sample must go through the resumable upload and
    // be referenced by handle, exactly as the submit route does.
    if (payload.header_media_url) {
      const sample = await fetch(payload.header_media_url);
      if (!sample.ok) {
        throw new Error(
          `Could not fetch the header sample (HTTP ${sample.status})`
        );
      }
      const fileType =
        sample.headers.get('content-type')?.split(';')[0] || 'image/png';
      payload.header_handle = await uploadSampleMedia({
        accessToken,
        data: await sample.arrayBuffer(),
        fileType,
      });
    }

    const meta = await submitMessageTemplate({
      wabaId: config.waba_id as string,
      accessToken,
      payload: buildMetaTemplatePayload(payload),
    });

    await db.from('message_templates').insert({
      account_id: accountId,
      user_id: account.owner_user_id,
      name: payload.name,
      category: payload.category,
      language: payload.language,
      header_type: payload.header_type,
      header_media_url: payload.header_media_url,
      header_handle: payload.header_handle ?? null,
      body_text: payload.body_text,
      footer_text: payload.footer_text ?? null,
      buttons: payload.buttons ?? null,
      sample_values: payload.sample_values ?? null,
      status: normalizeStatus(meta.status),
      meta_template_id: meta.id,
      submission_error: null,
      last_submitted_at: new Date().toISOString(),
    });

    console.log(
      `[${logTag}] auto-submitted ${name} template for account ${accountId} (status ${meta.status})`
    );
    return {
      status: normalizeStatus(meta.status),
      template: null,
      rejectionReason: null,
      setupError: null,
    };
  } catch (err) {
    console.error(`[${logTag}] template auto-submit failed:`, err);
    return { ...existing, setupError: 'submission_failed' };
  }
}
