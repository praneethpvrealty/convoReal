// The server half of the broadcast carrier: the Meta payload and the
// once-per-account submission. The copy, the variable mapping and the
// refusal wording live in carrier-template.ts, which the mobile
// composer shares.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  ensureSharedTemplate,
  readSharedTemplateState,
  type SharedTemplateState,
} from '@/lib/whatsapp/ensure-shared-template';
import {
  BROADCAST_UPDATE_BODY,
  BROADCAST_UPDATE_FOOTER,
  BROADCAST_UPDATE_TEMPLATE_NAME,
  type BroadcastTemplateState,
} from '@/lib/broadcasts/carrier-template';

export function buildBroadcastUpdateTemplatePayload(): TemplatePayload {
  return {
    name: BROADCAST_UPDATE_TEMPLATE_NAME,
    category: 'Marketing',
    language: 'en_US',
    body_text: BROADCAST_UPDATE_BODY,
    footer_text: BROADCAST_UPDATE_FOOTER,
    sample_values: {
      body: [
        'Priya',
        'Skyline Realty',
        'Site visits at Lakeview Residences are open this Saturday and Sunday from 10 am to 5 pm. Reply to book a slot.',
      ],
    },
  };
}

export function readBroadcastUpdateTemplateState(
  db: SupabaseClient,
  accountId: string
): Promise<SharedTemplateState> {
  return readSharedTemplateState(db, accountId, BROADCAST_UPDATE_TEMPLATE_NAME);
}

export function ensureBroadcastUpdateTemplate(
  accountId: string
): Promise<SharedTemplateState> {
  return ensureSharedTemplate(
    accountId,
    BROADCAST_UPDATE_TEMPLATE_NAME,
    buildBroadcastUpdateTemplatePayload,
    'broadcast-update'
  );
}

/** The shape both composers read: status plus what the preview needs. */
export function broadcastTemplateStateResponse(
  state: SharedTemplateState,
  agencyName: string
): BroadcastTemplateState {
  return {
    status: state.status,
    rejectionReason: state.rejectionReason,
    setupError: state.setupError,
    bodyText: state.template?.body_text || BROADCAST_UPDATE_BODY,
    footerText: state.template
      ? (state.template.footer_text ?? null)
      : BROADCAST_UPDATE_FOOTER,
    agencyName,
  };
}
