import { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import { unavailableListingReply } from '@/lib/inventory/listing-status';
import {
  buildEnquiryNoticeParams,
  enquiryNoticeParamCount,
  pickEnquiryNoticeTemplate,
  ENQUIRY_NOTICE_TEMPLATE_NAMES,
} from '@/lib/whatsapp/enquiry-notice-template';
import {
  buildListingAvailabilityParams,
  LISTING_AVAILABILITY_TEMPLATE_NAME,
  pickListingAvailabilityTemplate,
} from '@/lib/whatsapp/listing-availability-template';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';
import { languageForMetaCode } from '@/lib/languages';
import type { MessageTemplate, Property } from '@/types';

export type UnavailableListingOutcome =
  'available' | 'text' | 'template' | 'no_template' | 'failed';

export function enquiryNoticeSendParams(
  templateName: string,
  contactName: string | null | undefined,
  property: Property,
  brandName: string | null
): string[] {
  const [name, brand, described] = buildEnquiryNoticeParams(
    contactName,
    property,
    brandName
  );
  return enquiryNoticeParamCount(templateName) === 2
    ? [name, described]
    : [name, brand, described];
}

export async function sendUnavailableListingReply({
  supabase,
  accountId,
  userId,
  contactId,
  conversationId,
  leadName,
  propertyId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string | null;
  leadName: string;
  propertyId: string;
}): Promise<UnavailableListingOutcome> {
  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) return 'available';

  const reply = unavailableListingReply(
    leadName,
    (property as Property).title,
    (property as Property).status
  );
  if (!reply) return 'available';

  const base = {
    accountId,
    userId,
    contactId,
    conversationId: conversationId ?? undefined,
    senderType: 'bot' as const,
    customDbClient: supabase,
  };

  const textResult = await sendWhatsAppMessageAndPersist({
    ...base,
    kind: 'text',
    text: reply,
  });
  if (textResult.success) return 'text';
  if (!isReengagementError(textResult.error)) {
    console.error(
      `[lead-webhook] Unavailable-listing reply failed for contact ${contactId}: ${textResult.error}`
    );
    return 'failed';
  }

  const canBecomeAvailable = (property as Property).status !== 'Sold';
  const [{ data: rows }, language, { data: account }] = await Promise.all([
    supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .in('name', [
        ...(canBecomeAvailable ? [LISTING_AVAILABILITY_TEMPLATE_NAME] : []),
        ...ENQUIRY_NOTICE_TEMPLATE_NAMES,
      ])
      .eq('status', 'APPROVED'),
    resolveSendLanguage(supabase, accountId, contactId),
    supabase.from('accounts').select('name').eq('id', accountId).maybeSingle(),
  ]);
  const candidates = narrowToLanguage(
    (rows ?? []) as MessageTemplate[],
    language
  );
  const availabilityTemplate = canBecomeAvailable
    ? pickListingAvailabilityTemplate(candidates)
    : null;
  const template =
    availabilityTemplate ?? pickEnquiryNoticeTemplate(candidates);
  if (!template) {
    console.warn(
      `[lead-webhook] No approved listing status notice template — contact ${contactId} was not told the listing is ${(property as Property).status}`
    );
    return 'no_template';
  }

  const brandName = (account as { name?: string | null } | null)?.name ?? null;
  const params: string[] = availabilityTemplate
    ? buildListingAvailabilityParams(
        leadName,
        property as Property,
        brandName,
        languageForMetaCode(template.language || 'en') ?? 'en'
      )
    : enquiryNoticeSendParams(
        template.name,
        leadName,
        property as Property,
        brandName
      );
  const templateResult = await sendWhatsAppMessageAndPersist({
    ...base,
    kind: 'template',
    templateName: template.name,
    templateLanguage: template.language || 'en_US',
    templateParams: params,
    messageParams: { body: params },
    templateRow: template,
    text: (template.body_text || '').replace(
      /\{\{(\d+)\}\}/g,
      (_, n) => params[Number(n) - 1] ?? ''
    ),
  });
  if (!templateResult.success) {
    console.error(
      `[lead-webhook] Listing status notice failed for contact ${contactId}: ${templateResult.error}`
    );
    return 'failed';
  }
  return 'template';
}
