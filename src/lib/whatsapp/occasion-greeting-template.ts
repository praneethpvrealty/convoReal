// The shared "occasion_greeting" WhatsApp template every festival /
// occasion greeting broadcast sends through. One template serves every
// occasion: the greeting itself is body variable {{2}} and the card
// image rides in the IMAGE header at send time, so a new occasion never
// needs a new Meta submission (and never burns a template name — see
// AGENTS.md §2.7).
//
// Category is Marketing on purpose. A festival greeting is promotional
// under Meta's two-part test, and a Utility submission would be
// approved as Marketing anyway (normalizeCategory keeps whatever Meta
// assigns). Sends are gated by the STOP ALERTS opt-out: declined
// contacts are filtered out of every broadcast audience.

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  submitMessageTemplate,
  uploadSampleMedia,
} from '@/lib/whatsapp/meta-api';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import type { VariableMapping } from '@/lib/broadcasts/sender';
import type { MessageTemplate } from '@/types';

export const OCCASION_GREETING_TEMPLATE_NAME = 'occasion_greeting';

export function buildOccasionGreetingTemplatePayload(
  origin: string
): TemplatePayload {
  const base = origin.replace(/\/+$/, '');
  return {
    name: OCCASION_GREETING_TEMPLATE_NAME,
    category: 'Marketing',
    language: 'en_US',
    header_type: 'image',
    // Review-time sample only — a stable PNG every deployment serves.
    // Real sends override it with the greeting's card image
    // (headerMediaUrl), falling back to the account's brand image.
    header_media_url: `${base}/brand/app-icon-1024.png`,
    body_text:
      'Dear {{1}}, we have a special wish for you today. {{2}} Warm regards from all of us at {{3}} — thank you for your continued trust.',
    footer_text: 'Reply STOP ALERTS to opt out of these messages',
    sample_values: {
      body: [
        'Priya',
        'May Lord Ganesha fill your home with prosperity, wisdom and new beginnings this Ganesh Chaturthi!',
        'Skyline Realty',
      ],
    },
  };
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The broadcast variable mappings for one greeting: {{1}} resolves per
 *  recipient (greetable name fallback), {{2}} and {{3}} are static. */
export function buildOccasionGreetingVariables(
  messageText: string,
  agencyName: string
): Record<string, VariableMapping> {
  return {
    '1': { type: 'field', value: 'name' },
    '2': { type: 'static', value: singleLine(messageText) },
    '3': { type: 'static', value: singleLine(agencyName) },
  };
}

export interface OccasionGreetingTemplateState {
  status: string | null;
  template: MessageTemplate | null;
  rejectionReason: string | null;
}

function templateOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  );
}

/**
 * Returns the account's occasion_greeting template state, auto-submitting
 * the predefined payload to Meta when the account has no row for it at
 * all (fire-once seeding, same pattern as ensureSoldUpdateTemplate).
 * PENDING/REJECTED/DRAFT rows are left alone so a rejection never loops.
 */
export async function ensureOccasionGreetingTemplate(
  accountId: string
): Promise<OccasionGreetingTemplateState> {
  const db = supabaseAdmin();

  const { data: latestRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', OCCASION_GREETING_TEMPLATE_NAME)
    .order('last_submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRow) {
    const template = latestRow as unknown as MessageTemplate;
    const status = String(template.status ?? '').toUpperCase();
    return {
      status,
      template: status === 'APPROVED' ? template : null,
      rejectionReason: template.rejection_reason ?? null,
    };
  }

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
      return { status: null, template: null, rejectionReason: null };
    }

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.owner_user_id) {
      return { status: null, template: null, rejectionReason: null };
    }

    const payload = buildOccasionGreetingTemplatePayload(templateOrigin());
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
      `[occasion-greeting] auto-submitted ${OCCASION_GREETING_TEMPLATE_NAME} template for account ${accountId} (status ${meta.status})`
    );
    return {
      status: normalizeStatus(meta.status),
      template: null,
      rejectionReason: null,
    };
  } catch (err) {
    console.error('[occasion-greeting] template auto-submit failed:', err);
    return { status: null, template: null, rejectionReason: null };
  }
}
