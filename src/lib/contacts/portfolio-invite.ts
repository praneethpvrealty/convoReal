import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact } from '@/types';
import { BRANDING } from '@/config/branding';
import {
  findConversation,
  resolveConversation,
} from '@/lib/conversations/resolve';
import { accountBrandName } from '@/lib/showcase/account-showcase-url';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  buildPortfolioAccessParams,
  PORTFOLIO_ACCESS_TEMPLATE_NAME,
  portfolioAccessButtonSuffix,
} from '@/lib/whatsapp/portfolio-access-template';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';

export type PortfolioSide = 'buyer' | 'owner';

export const PORTFOLIO_BUYER_CLASSIFICATIONS = ['Buyer', 'Owner & Buyer'];
export const PORTFOLIO_OWNER_CLASSIFICATIONS = [
  'Owner',
  'Seller',
  'Owner & Buyer',
];

export interface PortfolioEligibilityFacts {
  hasBuyerActivity: boolean;
  ownsListing: boolean;
}

export interface PortfolioInvite {
  sides: PortfolioSide[];
  side: PortfolioSide | null;
  message: string;
  url: string | null;
}

export interface PortfolioInviteResult {
  success: boolean;
  delivery?: 'free_text' | 'template';
  side: PortfolioSide | null;
  message: string;
  url: string | null;
  error?: string;
}

export const PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR =
  'Portfolio is for buyers and owners. Classify this contact as a Buyer, Owner or Seller first.';

export const PORTFOLIO_INVITE_WINDOW_CLOSED_ERROR =
  'The 24-hour window is closed and the Portfolio access template is not approved yet. Submit it from Settings → Templates, or use personal WhatsApp.';

export const PORTFOLIO_INVITE_PERSONAL_NOTES: Record<PortfolioSide, string> = {
  buyer: '🔑 Shared the buyer Portfolio invite via personal WhatsApp',
  owner: '🔑 Shared the owner Portfolio invite via personal WhatsApp',
};

const clean = (value?: string | null) => value?.trim() || '';

const firstName = (name?: string | null) => clean(name).split(/\s+/)[0] ?? '';

export function portfolioInviteSides(
  classification: string | null | undefined,
  facts: PortfolioEligibilityFacts
): PortfolioSide[] {
  const sides: PortfolioSide[] = [];
  if (
    PORTFOLIO_OWNER_CLASSIFICATIONS.includes(classification ?? '') ||
    facts.ownsListing
  ) {
    sides.push('owner');
  }
  if (
    PORTFOLIO_BUYER_CLASSIFICATIONS.includes(classification ?? '') ||
    facts.hasBuyerActivity
  ) {
    sides.push('buyer');
  }
  return sides;
}

export function portfolioInviteUrl(side: PortfolioSide): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl
  ).replace(/\/$/, '');
  return `${base}/${side === 'owner' ? 'den' : 'buyer'}/login`;
}

export function buildPortfolioInviteMessage({
  side,
  contactName,
  agentName,
  brandName,
  url,
}: {
  side: PortfolioSide;
  contactName?: string | null;
  agentName?: string | null;
  brandName?: string | null;
  url: string;
}): string {
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
  const withBrand = brand ? ` with ${brand}` : '';
  const signIn = `Sign in with this WhatsApp number — you'll get a one-time code here, no app or password needed:\n${url}`;

  if (side === 'owner') {
    return [
      [greeting, intro].filter(Boolean).join('\n'),
      `Your *Owner Portfolio*${withBrand} is ready. Track buyer enquiries, shortlists, site visits and offers on your property in one place, and add another property yourself whenever you want to sell or rent one out.`,
      signIn,
    ].join('\n\n');
  }

  return [
    [greeting, intro].filter(Boolean).join('\n'),
    `You now have your own *Portfolio*${withBrand}. It shows properties matched to your requirements, keeps your shortlist in one place, and lets you update your budget and preferred areas any time — new matches reach you automatically.`,
    signIn,
  ].join('\n\n');
}

export async function portfolioEligibilityFacts(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<PortfolioEligibilityFacts> {
  const [inquiries, ratings, listings] = await Promise.all([
    db
      .from('contact_property_inquiries')
      .select('id')
      .eq('contact_id', contactId)
      .limit(1),
    db
      .from('property_ratings')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .limit(1),
    db
      .from('properties')
      .select('id')
      .eq('account_id', accountId)
      .eq('owner_contact_id', contactId)
      .neq('listing_source', 'agent')
      .limit(1),
  ]);
  const found = (result: { data: unknown }) =>
    Array.isArray(result.data) && result.data.length > 0;
  return {
    hasBuyerActivity: found(inquiries) || found(ratings),
    ownsListing: found(listings),
  };
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

export function parsePortfolioSide(value: unknown): PortfolioSide | null {
  return value === 'buyer' || value === 'owner' ? value : null;
}

export async function buildPortfolioInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: Contact;
  side?: PortfolioSide | null;
}): Promise<PortfolioInvite> {
  const { db, accountId, userId, contact } = args;
  const facts = await portfolioEligibilityFacts(db, accountId, contact.id);
  const sides = portfolioInviteSides(contact.classification, facts);
  const side =
    args.side && sides.includes(args.side) ? args.side : (sides[0] ?? null);
  if (!side) return { sides, side: null, message: '', url: null };

  const [brandName, agentName] = await Promise.all([
    accountBrandName(db, accountId),
    agentDisplayName(db, userId),
  ]);
  const url = portfolioInviteUrl(side);
  return {
    sides,
    side,
    url,
    message: buildPortfolioInviteMessage({
      side,
      contactName: contact.name,
      agentName,
      brandName,
      url,
    }),
  };
}

interface PortfolioTemplateRow {
  name: string;
  language?: string | null;
  status?: string | null;
  body_text?: string | null;
}

export async function sendPortfolioInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: Contact;
  side?: PortfolioSide | null;
}): Promise<PortfolioInviteResult> {
  const { db, accountId, userId, contact } = args;
  const invite = await buildPortfolioInvite(args);
  const { side, message, url } = invite;

  if (!side) {
    return {
      success: false,
      side,
      message,
      url,
      error: PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR,
    };
  }

  if (!contact.phone?.replace(/\D/g, '')) {
    return {
      success: false,
      side,
      message,
      url,
      error: 'This contact has no phone number.',
    };
  }

  const existing = await findConversation<{ id: string }>(db, {
    accountId,
    contactId: contact.id,
    columns: 'id',
  });
  const { data: lastCustomer } = existing
    ? await db
        .from('messages')
        .select('created_at')
        .eq('conversation_id', existing.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (existing && isWithinCustomerWindow(lastCustomer?.created_at)) {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: contact.id,
      conversationId: existing.id,
      kind: 'text',
      senderType: 'agent',
      text: message,
      customDbClient: db,
    });
    return {
      success: result.success,
      delivery: result.success ? 'free_text' : undefined,
      side,
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
    .eq('name', PORTFOLIO_ACCESS_TEMPLATE_NAME);
  const template = narrowToLanguage(
    (rows ?? []) as PortfolioTemplateRow[],
    language
  ).find((row) => (row.status ?? '').toUpperCase() === 'APPROVED');
  if (!template || !url) {
    return {
      success: false,
      side,
      message,
      url,
      error: PORTFOLIO_INVITE_WINDOW_CLOSED_ERROR,
    };
  }

  const { conversation, error: conversationError } = await resolveConversation<{
    id: string;
  }>(db, { accountId, contactId: contact.id, userId, columns: 'id' });
  if (!conversation) {
    return {
      success: false,
      side,
      message,
      url,
      error: conversationError?.message || 'Could not open the contact thread.',
    };
  }

  const templateParams = buildPortfolioAccessParams(
    contact.name,
    await accountBrandName(db, accountId)
  );
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
      buttonParams: { 0: portfolioAccessButtonSuffix(url) },
    },
    text: (template.body_text || '').replace(
      /\{\{(\d+)\}\}/g,
      (_, n) => templateParams[Number(n) - 1] ?? ''
    ),
    templateRow: template,
    customDbClient: db,
  });
  return {
    success: result.success,
    delivery: result.success ? 'template' : undefined,
    side,
    message,
    url,
    error: result.error,
  };
}

export async function logPersonalPortfolioInvite(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  side: PortfolioSide;
}): Promise<void> {
  const { db, accountId, userId, contactId, side } = args;
  const now = new Date().toISOString();
  const [note, touch] = await Promise.all([
    db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: userId,
      note_text: PORTFOLIO_INVITE_PERSONAL_NOTES[side],
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
