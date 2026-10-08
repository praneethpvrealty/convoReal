import { BRANDING } from '@/config/branding';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { metaLanguageCode, type LanguageCode } from '@/lib/languages';
import type { InteractiveButton } from '@/lib/whatsapp/meta-api';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME = 'showcase_view_followup';
export const SHOWCASE_VIEW_NUDGE_LEGACY_TEMPLATE_NAME = 'showcase_view_checkin';
export const SHOWCASE_VIEW_NUDGE_TEMPLATE_NAMES = [
  SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME,
  SHOWCASE_VIEW_NUDGE_LEGACY_TEMPLATE_NAME,
] as const;
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

const FOLLOWUP_BODY_LINES = (name: string, brand: string, title: string) => [
  `Hi ${name}, this is a follow-up on the listing ${brand} shared with you:`,
  '',
  `Property: ${title}`,
  '',
  'It seems you are interested in this property. Choose an option below so we can action your request, or reply here.',
];

export function buildViewNudgeTemplatePayload(): TemplatePayload {
  return {
    name: SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: FOLLOWUP_BODY_LINES('{{1}}', '{{2}}', '{{3}}').join('\n'),
    buttons: CHOICES.map((choice) => ({
      type: 'QUICK_REPLY' as const,
      text: VIEW_NUDGE_BUTTON_LABELS[choice],
    })),
    sample_values: {
      body: [
        'Gopi',
        'Aryavarta Ventures',
        '3 BHK Apartment for Sale in Kondapur, Hyderabad',
      ],
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

export interface ViewNudgeParams {
  name: string;
  brand: string;
  title: string;
}

export function buildViewNudgeParams(
  contactName: string | null | undefined,
  brandName: string | null | undefined,
  propertyTitle: string
): ViewNudgeParams {
  return {
    name: viewNudgeFirstName(contactName),
    brand: sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    title: sanitizeTemplateParam(propertyTitle) || 'Property',
  };
}

export function viewNudgeTemplateBodyParams(
  templateName: string,
  params: ViewNudgeParams
): string[] {
  return templateName === SHOWCASE_VIEW_NUDGE_LEGACY_TEMPLATE_NAME
    ? [params.name, params.title]
    : [params.name, params.brand, params.title];
}

export function renderViewNudgeBody(
  templateName: string,
  params: ViewNudgeParams
): string {
  if (templateName === SHOWCASE_VIEW_NUDGE_LEGACY_TEMPLATE_NAME) {
    return [
      `Hi ${params.name}, you viewed this property on our listings page:`,
      '',
      `*${params.title}*`,
      '',
      'Tap an option below and our team will take it from there.',
    ].join('\n');
  }
  return FOLLOWUP_BODY_LINES(params.name, params.brand, params.title).join(
    '\n'
  );
}

export function buildViewNudgeButtonsBody(params: ViewNudgeParams): string {
  return [
    `Hi ${params.name}, I saw you spent some time on *${params.title}*.`,
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

const ENGLISH_META_CODES = new Set(['en_US', 'en_GB', 'en']);

export function usableViewNudgeTemplate<T extends ViewNudgeTemplateRow>(
  rows: T[],
  alertsConsent: string | null | undefined,
  language: LanguageCode = 'en'
): T | null {
  const isUtility = (row: T) =>
    (row.category ?? '').toUpperCase() === 'UTILITY';
  const eligible = rows.filter(
    (row) =>
      row.status === 'APPROVED' &&
      (SHOWCASE_VIEW_NUDGE_TEMPLATE_NAMES as readonly string[]).includes(
        row.name
      ) &&
      (isUtility(row) || alertsConsent === 'granted')
  );
  const wanted = metaLanguageCode(language);
  const inEnglish = eligible.filter((row) =>
    ENGLISH_META_CODES.has(row.language ?? '')
  );
  const inWanted = ENGLISH_META_CODES.has(wanted)
    ? inEnglish
    : eligible.filter((row) => row.language === wanted);
  const tier = inWanted.length
    ? inWanted
    : inEnglish.length
      ? inEnglish
      : eligible;
  const rank = (row: T) =>
    (isUtility(row) ? 0 : 2) +
    (row.name === SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME ? 0 : 1);
  return [...tier].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
