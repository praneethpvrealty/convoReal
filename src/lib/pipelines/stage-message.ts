import { stageTypeOf, type StageInput } from './stage-semantics';

export type StageMessageIntent =
  | 'arrange_visit'
  | 'confirm_visit'
  | 'owner_meeting'
  | 'negotiation'
  | 'due_diligence'
  | 'agreement'
  | 'brokerage'
  | 'closed'
  | 'reengage'
  | 'check_in';

export interface StageMessageInput {
  stage: StageInput | null | undefined;
  contactName?: string | null;
  propertyTitle?: string | null;
  propertyCode?: string | null;
  propertyUrl?: string | null;
}

export interface StageMessage {
  intent: StageMessageIntent;
  title: string;
  message: string;
}

const clean = (value?: string | null) => value?.trim() || '';

function nextStep(stageName: string): string {
  const parts = stageName.split(/→|->/);
  return (parts[parts.length - 1] ?? stageName).trim().toLowerCase();
}

export function stageMessageIntent(
  stage: StageInput | null | undefined
): StageMessageIntent {
  if (!stage) return 'check_in';
  const type = stageTypeOf(stage);
  if (type === 'lost') return 'reengage';
  if (type === 'brokerage_paid' || type === 'won') return 'closed';
  if (type === 'brokerage_pending') return 'brokerage';
  const name = typeof stage === 'string' ? stage : stage.name;
  const step = nextStep(name);
  if (/regist|agreement|sale deed/.test(step)) return 'agreement';
  if (/due diligence|legal|document/.test(step)) return 'due_diligence';
  if (/negotiat|offer|token/.test(step)) return 'negotiation';
  if (/owner/.test(step)) return 'owner_meeting';
  if (/visit/.test(step)) return 'confirm_visit';
  if (/shortlist|enquir|inquir|lead|\bnew\b/.test(step)) return 'arrange_visit';
  return 'check_in';
}

const TITLES: Record<StageMessageIntent, string> = {
  arrange_visit: 'Offer a site visit',
  confirm_visit: 'Fix the site visit',
  owner_meeting: "Set up the owner's meeting",
  negotiation: 'Follow up on the offer',
  due_diligence: 'Start due diligence',
  agreement: 'Fix the agreement date',
  brokerage: 'Brokerage follow-up',
  closed: 'Thank and ask for referrals',
  reengage: 'Re-engage',
  check_in: 'Check in',
};

export function buildStageMessage({
  stage,
  contactName,
  propertyTitle,
  propertyCode,
  propertyUrl,
}: StageMessageInput): StageMessage {
  const intent = stageMessageIntent(stage);
  const first = clean(contactName).split(/\s+/)[0] ?? '';
  const hi = first ? `Hi ${first},` : 'Hi,';
  const title = clean(propertyTitle);
  const code = clean(propertyCode);
  const subject = title
    ? code
      ? `${title} (${code})`
      : title
    : code || 'the property';

  const bodies: Record<StageMessageIntent, string> = {
    arrange_visit: `${hi} hope you had a chance to look at ${subject}. Would you like me to arrange a site visit? Let me know a day and time that suits you and I'll set it up.`,
    confirm_visit: `${hi} let's fix your site visit for ${subject}. Which day and time work best for you this week? I'll confirm it with the owner.`,
    owner_meeting: `${hi} glad ${subject} worked for you. Shall I set up a meeting with the owner? Please share a convenient day and time.`,
    negotiation: `${hi} following up on ${subject}. Have you had a chance to think about the price? Share your offer and I'll take it to the owner.`,
    due_diligence: `${hi} great that we've confirmed ${subject}. Next is due diligence — I'll share the property documents for your lawyer to review. Please let me know if you need anything specific.`,
    agreement: `${hi} the legal checks on ${subject} are done. Let's fix a date for the agreement and registration — which dates work for you?`,
    brokerage: `${hi} congratulations on completing ${subject}! I'll share the brokerage invoice shortly — please let me know a convenient time to settle it.`,
    closed: `${hi} thank you for closing ${subject} with us — it was a pleasure working with you. If friends or family are looking to buy or sell, I'd be glad to help them too.`,
    reengage: `${hi} I know ${subject} didn't work out. Are you still looking? Tell me what you'd like and I'll share options that fit.`,
    check_in: `${hi} just checking in on ${subject}. How would you like to take it forward?`,
  };

  const link = clean(propertyUrl);
  const withLink =
    link && intent !== 'closed' && intent !== 'brokerage'
      ? `${bodies[intent]}\n\n📸 Photos & full details:\n${link}`
      : bodies[intent];

  return { intent, title: TITLES[intent], message: withLink };
}
