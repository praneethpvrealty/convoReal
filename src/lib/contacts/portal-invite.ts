import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact, Property } from '@/types';
import { resolveConversation } from '@/lib/conversations/resolve';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import {
  accountBrandName,
  accountShowcaseBase,
} from '@/lib/showcase/account-showcase-url';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import {
  buildPropertySelectionUpdateParams,
  PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME,
  sanitizeTemplateParam,
} from '@/lib/whatsapp/inventory-update-template';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';

export interface PortalInviteFilters {
  search: string | null;
  category: string | null;
  listingType: 'Sale' | 'Rent' | null;
}

export interface PortalInviteMessageInput {
  contactName?: string | null;
  agentName?: string | null;
  brandName?: string | null;
  portalUrl: string;
  filters?: PortalInviteFilters | null;
}

export interface PortalInvite {
  message: string;
  url: string;
  filters: PortalInviteFilters;
}

export type PortalInviteDelivery = 'free_text' | 'template' | 'personal';

export interface PortalInviteResult {
  success: boolean;
  delivery?: PortalInviteDelivery;
  message: string;
  url: string;
  error?: string;
}

export const PORTAL_INVITE_PERSONAL_NOTE =
  '🔗 Shared the property portal link via personal WhatsApp';

export const PORTAL_INVITE_WINDOW_CLOSED_ERROR =
  'The 24-hour window is closed and the property selection template is not approved yet. Set it up from Share showcase, or use personal WhatsApp.';

const clean = (value?: string | null) => value?.trim() || '';

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const firstName = (name?: string | null) => clean(name).split(/\s+/)[0] ?? '';

export function portalInviteFilters(contact: Contact): PortalInviteFilters {
  const source = resolveRequirementSource(contact);
  const area = [
    ...(source.areas_of_interest || []),
    ...(source.pref_areas || []),
  ].find((entry) => clean(entry));
  const category = [
    ...(source.property_interests || []),
    ...(source.pref_property_types || []),
    ...(source.pref_property_categories || []).map(titleCase),
  ].find((entry) => clean(entry));
  const intent = (source.pref_listing_types || []).find(
    (entry) => entry === 'Sale' || entry === 'Rent'
  );
  return {
    search: area ? clean(area) : null,
    category: category ? clean(category) : null,
    listingType: intent === 'Sale' || intent === 'Rent' ? intent : null,
  };
}

export function buildPortalInviteUrl(
  showcaseBase: string,
  contact: Pick<Contact, 'id'>,
  filters: PortalInviteFilters
): string {
  const url = new URL(showcaseBase);
  if (filters.listingType)
    url.searchParams.set('listing_type', filters.listingType);
  if (filters.category) url.searchParams.set('category', filters.category);
  if (filters.search) url.searchParams.set('search', filters.search);
  url.searchParams.set('v', contact.id);
  return url.toString();
}

export function describePortalInviteFilters(
  filters?: PortalInviteFilters | null
): string {
  if (!filters) return '';
  const intent =
    filters.listingType === 'Rent'
      ? 'for rent'
      : filters.listingType === 'Sale'
        ? 'for sale'
        : '';
  return [
    filters.category ? filters.category.toLowerCase() : '',
    intent,
    filters.search ? `in ${filters.search}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildPortalInviteMessage({
  contactName,
  agentName,
  brandName,
  portalUrl,
  filters,
}: PortalInviteMessageInput): string {
  const name = firstName(contactName);
  const greeting = name ? `Hi ${name} 👋` : 'Hi 👋';
  const agent = clean(agentName);
  const brand = clean(brandName);
  const intro = agent
    ? brand
      ? `I'm ${agent} from ${brand}.`
      : `I'm ${agent}, your real estate consultant.`
    : brand
      ? `This is ${brand}.`
      : '';
  const scope = describePortalInviteFilters(filters);
  const opensOn = scope
    ? `It already opens on ${scope} for you — change the filters any time to widen the search.`
    : 'Use the filters at the top to narrow it down to exactly what you are looking for.';

  return [
    [greeting, intro].filter(Boolean).join('\n'),
    `Here is our property portal, where every listing is verified and kept up to date by our team:\n${portalUrl}`,
    `You can search and filter by location, budget, property type and more to find the properties that match your requirements. ${opensOn}`,
    `Shortlist the ones you like and send the enquiry from the portal — it reaches me directly, and I'll take it forward from there with photos, exact locations and site visits.`,
  ].join('\n\n');
}

async function agentDisplayName(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data } = await db
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    return (
      clean((data as { full_name?: string | null } | null)?.full_name) || null
    );
  } catch {
    return null;
  }
}

export async function buildPortalInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: Contact;
}): Promise<PortalInvite> {
  const { db, accountId, userId, contact } = args;
  const [base, brandName, agentName] = await Promise.all([
    accountShowcaseBase(db, accountId),
    accountBrandName(db, accountId),
    agentDisplayName(db, userId),
  ]);
  const filters = portalInviteFilters(contact);
  const url = buildPortalInviteUrl(base, contact, filters);
  return {
    message: buildPortalInviteMessage({
      contactName: contact.name,
      agentName,
      brandName,
      portalUrl: url,
      filters,
    }),
    url,
    filters,
  };
}

interface PortalTemplateRow {
  name: string;
  language?: string | null;
  status?: string | null;
  body_text?: string | null;
  buttons?: { type: string; url?: string | null }[] | null;
}

function resolveBodyText(body: string | null | undefined, params: string[]) {
  return (body || '').replace(
    /\{\{(\d+)\}\}/g,
    (_, n) => params[Number(n) - 1] ?? ''
  );
}

export function portalInviteButtonParams(
  buttons: PortalTemplateRow['buttons'],
  url: string
): Record<number, string> {
  const params: Record<number, string> = {};
  const query = new URL(url).search;
  (buttons ?? []).forEach((button, index) => {
    if (button.type === 'URL' && (button.url ?? '').includes('{{1}}')) {
      params[index] = query;
    }
  });
  return params;
}

export async function sendPortalInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: Contact;
}): Promise<PortalInviteResult> {
  const { db, accountId, userId, contact } = args;
  const invite = await buildPortalInvite(args);
  const { message, url } = invite;

  if (!contact.phone?.replace(/\D/g, '')) {
    return {
      success: false,
      message,
      url,
      error: 'This contact has no phone number.',
    };
  }

  const { conversation, error: conversationError } = await resolveConversation<{
    id: string;
  }>(db, { accountId, contactId: contact.id, userId, columns: 'id' });
  if (!conversation) {
    return {
      success: false,
      message,
      url,
      error: conversationError?.message || 'Could not open the contact thread.',
    };
  }

  const { data: lastCustomer } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (isWithinCustomerWindow(lastCustomer?.created_at)) {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: contact.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'agent',
      text: message,
      customDbClient: db,
    });
    return {
      success: result.success,
      delivery: result.success ? 'free_text' : undefined,
      message,
      url,
      error: result.error,
    };
  }

  const language = await resolveSendLanguage(db, accountId, contact.id);
  const { data: rows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME);
  const template = narrowToLanguage(
    (rows ?? []) as PortalTemplateRow[],
    language
  ).find((row) => (row.status ?? '').toUpperCase() === 'APPROVED');
  if (!template) {
    return {
      success: false,
      message,
      url,
      error: PORTAL_INVITE_WINDOW_CLOSED_ERROR,
    };
  }

  const { data: published } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false });
  const [selection] = buildPropertySelectionUpdateParams(
    (published ?? []) as Property[],
    contact
  );
  const templateParams = [
    sanitizeTemplateParam(firstName(contact.name) || 'there'),
    selection,
  ];
  const buttonParams = portalInviteButtonParams(template.buttons, url);
  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId: contact.id,
    conversationId: conversation.id,
    kind: 'template',
    senderType: 'agent',
    templateName: template.name,
    templateLanguage: template.language || 'en_US',
    templateParams,
    messageParams: {
      body: templateParams,
      ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
    },
    text: resolveBodyText(template.body_text, templateParams),
    templateRow: template,
    customDbClient: db,
  });
  return {
    success: result.success,
    delivery: result.success ? 'template' : undefined,
    message,
    url,
    error: result.error,
  };
}

export async function logPersonalPortalInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
}): Promise<void> {
  const { db, accountId, userId, contactId } = args;
  const now = new Date().toISOString();
  const [note, touch] = await Promise.all([
    db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: userId,
      note_text: PORTAL_INVITE_PERSONAL_NOTE,
    }),
    db
      .from('contacts')
      .update({ last_contacted_at: now })
      .eq('id', contactId)
      .eq('account_id', accountId),
  ]);
  if (note.error) throw note.error;
  if (touch.error) throw touch.error;
}
