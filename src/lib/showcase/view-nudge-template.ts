import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import type { InteractiveButton } from '@/lib/whatsapp/meta-api';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME = 'showcase_view_checkin';
export const VIEW_NUDGE_REPLY_PREFIX = 'svn_';

export type ViewNudgeChoice = 'visit' | 'callback' | 'not_for_me';

const CHOICE_CODES: Record<ViewNudgeChoice, string> = {
  visit: 'v',
  callback: 'c',
  not_for_me: 'n',
};

export const VIEW_NUDGE_BUTTON_LABELS: Record<ViewNudgeChoice, string> = {
  visit: 'Book a visit',
  callback: 'Call me back',
  not_for_me: 'Not for me',
};

const CHOICES: ViewNudgeChoice[] = ['visit', 'callback', 'not_for_me'];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function viewNudgeReplyId(
  choice: ViewNudgeChoice,
  propertyId: string
): string {
  return `${VIEW_NUDGE_REPLY_PREFIX}${CHOICE_CODES[choice]}:${propertyId}`;
}

export function parseViewNudgeReplyId(
  replyId: string | null | undefined
): { choice: ViewNudgeChoice; propertyId: string } | null {
  if (!replyId?.startsWith(VIEW_NUDGE_REPLY_PREFIX)) return null;
  const [code, propertyId] = replyId
    .slice(VIEW_NUDGE_REPLY_PREFIX.length)
    .split(':');
  const choice = CHOICES.find((c) => CHOICE_CODES[c] === code);
  if (!choice || !propertyId || !UUID_RE.test(propertyId)) return null;
  return { choice, propertyId };
}

export function viewNudgeButtons(propertyId: string): InteractiveButton[] {
  return CHOICES.map((choice) => ({
    id: viewNudgeReplyId(choice, propertyId),
    title: VIEW_NUDGE_BUTTON_LABELS[choice],
  }));
}

export function viewNudgeButtonParams(
  propertyId: string
): Record<number, string> {
  return Object.fromEntries(
    CHOICES.map((choice, index) => [
      index,
      viewNudgeReplyId(choice, propertyId),
    ])
  );
}

export function buildViewNudgeTemplatePayload(): TemplatePayload {
  return {
    name: SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, you viewed this property on our listings page:',
      '',
      '*{{2}}*',
      '',
      'Tap an option below and our team will take it from there.',
    ].join('\n'),
    footer_text: 'Reply STOP ALERTS to opt out',
    buttons: CHOICES.map((choice) => ({
      type: 'QUICK_REPLY' as const,
      text: VIEW_NUDGE_BUTTON_LABELS[choice],
    })),
    sample_values: {
      body: ['Gopi', '3 BHK Apartment for Sale in Kondapur, Hyderabad'],
    },
  };
}

export function viewNudgeFirstName(
  contactName: string | null | undefined
): string {
  const rawName = contactName?.trim() ?? '';
  const firstName =
    rawName && !isPlaceholderLeadName(rawName)
      ? rawName.split(/\s+/)[0]
      : 'there';
  return sanitizeTemplateParam(firstName) || 'there';
}

export function buildViewNudgeParams(
  contactName: string | null | undefined,
  propertyTitle: string
): [name: string, title: string] {
  return [
    viewNudgeFirstName(contactName),
    sanitizeTemplateParam(propertyTitle) || 'Property',
  ];
}

export function renderViewNudgeBody(params: [string, string]): string {
  return [
    `Hi ${params[0]}, you viewed this property on our listings page:`,
    '',
    `*${params[1]}*`,
    '',
    'Tap an option below and our team will take it from there.',
  ].join('\n');
}

export function buildViewNudgeButtonsBody(params: [string, string]): string {
  return [
    `Hi ${params[0]}, I saw you spent some time on *${params[1]}*.`,
    '',
    'Would you like to see it in person, get a call from our team, or is it not quite right for you?',
  ].join('\n');
}

export interface ViewNudgeTemplateRow {
  name: string;
  status?: string | null;
  category?: string | null;
  language?: string | null;
}

export function usableViewNudgeTemplate<T extends ViewNudgeTemplateRow>(
  rows: T[],
  alertsConsent: string | null | undefined
): T | null {
  const approved = rows.filter(
    (row) =>
      row.name === SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME &&
      row.status === 'APPROVED'
  );
  const utility = approved.find(
    (row) => (row.category ?? '').toUpperCase() === 'UTILITY'
  );
  if (utility) return utility;
  if (alertsConsent !== 'granted') return null;
  return (
    approved.find(
      (row) => (row.category ?? '').toUpperCase() === 'MARKETING'
    ) ?? null
  );
}
