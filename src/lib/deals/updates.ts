import type { DealMilestoneStatus } from './milestones';
import type { DealStakeholder } from './stakeholders';
import {
  isDealVisibility,
  sideCanSee,
  type DealSide,
  type DealVisibility,
} from './visibility';

/**
 * Published updates — Phase 3 of the Transaction Workspace.
 *
 * An update is composed for one audience from milestones and timeline
 * entries that audience may already see, and published as a durable
 * snapshot: `deal_updates` is insert-only in the database, so what a
 * buyer was told on the 18th reads the same on the 30th. A correction
 * is a new update naming the one it supersedes.
 *
 * Delivery is a separate fact per recipient. Sent, opened and
 * acknowledged are three timestamps, never inferred from one another.
 */

export type DealUpdateVisibility = Exclude<DealVisibility, 'internal'>;

export const DEAL_UPDATE_VISIBILITIES: readonly DealUpdateVisibility[] = [
  'buyer_side',
  'seller_side',
  'all_stakeholders',
];

export function isDealUpdateVisibility(v: unknown): v is DealUpdateVisibility {
  return isDealVisibility(v) && v !== 'internal';
}

/** The sides an update reaches. */
export function sidesForUpdate(visibility: DealUpdateVisibility): DealSide[] {
  return visibility === 'all_stakeholders'
    ? ['buyer', 'seller']
    : [visibility === 'buyer_side' ? 'buyer' : 'seller'];
}

/**
 * Whether an item may be quoted in an update. Every side that will
 * read the update must already be allowed to see the item: a
 * buyer-side update can quote buyer-side and shared items, never an
 * internal or seller-side one, and an update to both sides quotes only
 * what both sides may see.
 */
export function snapshotItemAllowed(
  update: DealUpdateVisibility,
  item: DealVisibility
): boolean {
  return sidesForUpdate(update).every((side) => sideCanSee(side, item));
}

/** Whether a stakeholder can be a recipient of an update. */
export function isEligibleRecipient(
  stakeholder: Pick<DealStakeholder, 'side'>,
  visibility: DealUpdateVisibility
): boolean {
  return (
    stakeholder.side !== 'internal' && sideCanSee(stakeholder.side, visibility)
  );
}

export type UpdateChannel =
  'engine_whatsapp' | 'personal_whatsapp' | 'portal_only';

export const UPDATE_CHANNELS: readonly UpdateChannel[] = [
  'engine_whatsapp',
  'personal_whatsapp',
  'portal_only',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const UPDATE_CHANNEL_LABELS: Record<UpdateChannel, string> = {
  engine_whatsapp: 'WhatsApp (business number)',
  personal_whatsapp: 'WhatsApp (my phone)',
  portal_only: 'Link only',
};

export function isUpdateChannel(v: unknown): v is UpdateChannel {
  return (
    typeof v === 'string' && (UPDATE_CHANNELS as readonly string[]).includes(v)
  );
}

export type UpdateDeliveryMode =
  'free_form' | 'template' | 'handoff' | 'portal';

export type UpdateRecipientStatus = 'pending' | 'sent' | 'failed';

export type UpdateRecipientStage =
  'pending' | 'sent' | 'opened' | 'acknowledged' | 'failed';

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const UPDATE_STAGE_LABELS: Record<UpdateRecipientStage, string> = {
  pending: 'To hand over',
  sent: 'Sent',
  opened: 'Opened',
  acknowledged: 'Acknowledged',
  failed: 'Not delivered',
};

export interface DealUpdateSnapshot {
  property_label: string | null;
  stage: string | null;
  progress: { total: number; done: number };
  milestones: Array<{
    id: string;
    title: string;
    status: DealMilestoneStatus;
    target_date: string | null;
    completed_at: string | null;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    title: string;
    created_at: string;
  }>;
}

export interface DealUpdate {
  id: string;
  account_id: string;
  deal_id: string;
  headline: string;
  body: string | null;
  visibility: DealUpdateVisibility;
  snapshot: DealUpdateSnapshot;
  supersedes_update_id: string | null;
  source: 'web' | 'mobile' | 'api' | 'system';
  published_by: string | null;
  published_by_name: string | null;
  created_at: string;
}

export interface DealUpdateRecipient {
  id: string;
  account_id: string;
  update_id: string;
  deal_id: string;
  stakeholder_id: string;
  link_id: string | null;
  contact_id: string | null;
  channel: UpdateChannel;
  delivery_mode: UpdateDeliveryMode | null;
  status: UpdateRecipientStatus;
  message_id: string | null;
  failed_reason: string | null;
  sent_at: string | null;
  link_delivered_at: string | null;
  opened_at: string | null;
  acknowledged_at: string | null;
  acknowledged_via: 'portal' | 'whatsapp' | null;
  created_at: string;
  updated_at: string;
}

/** The furthest a recipient has got, for display. The three facts stay
 *  separate on the row; this only picks the one to lead with. */
export function recipientStage(
  r: Pick<DealUpdateRecipient, 'status' | 'opened_at' | 'acknowledged_at'>
): UpdateRecipientStage {
  if (r.acknowledged_at) return 'acknowledged';
  if (r.opened_at) return 'opened';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'sent') return 'sent';
  return 'pending';
}

export const UPDATE_HEADLINE_MAX = 120;
export const UPDATE_BODY_MAX = 1500;
export const UPDATE_MAX_ITEMS = 20;
export const UPDATE_MAX_RECIPIENTS = 20;

export interface UpdateComposeInput {
  headline: string;
  body: string | null;
  visibility: DealUpdateVisibility;
  milestoneIds: string[];
  eventIds: string[];
  supersedesUpdateId: string | null;
  recipients: Array<{ stakeholderId: string; channel: UpdateChannel }>;
  ttl: unknown;
  otpRequired: boolean;
  source: 'web' | 'mobile' | 'api';
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function idList(v: unknown, label: string): ParseResult<string[]> {
  if (v === undefined || v === null) return { ok: true, value: [] };
  if (!Array.isArray(v)) return { ok: false, error: `${label} must be a list` };
  const ids = v.filter(
    (x): x is string => typeof x === 'string' && x.trim() !== ''
  );
  if (ids.length !== v.length)
    return { ok: false, error: `${label} must be ids` };
  if (ids.length > UPDATE_MAX_ITEMS) {
    return { ok: false, error: `At most ${UPDATE_MAX_ITEMS} ${label}` };
  }
  return { ok: true, value: Array.from(new Set(ids)) };
}

export function parseUpdateInput(
  raw: unknown
): ParseResult<UpdateComposeInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'headline is required' };
  }
  const input = raw as Record<string, unknown>;
  const headline =
    typeof input.headline === 'string' ? input.headline.trim() : '';
  if (!headline) return { ok: false, error: 'headline is required' };
  if (headline.length > UPDATE_HEADLINE_MAX) {
    return {
      ok: false,
      error: `Headline must be ${UPDATE_HEADLINE_MAX} characters or less`,
    };
  }
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length > UPDATE_BODY_MAX) {
    return {
      ok: false,
      error: `Message must be ${UPDATE_BODY_MAX.toLocaleString()} characters or less`,
    };
  }
  if (!isDealUpdateVisibility(input.visibility)) {
    return {
      ok: false,
      error:
        'An update goes to the buyer side, the seller side or all stakeholders',
    };
  }
  const milestones = idList(input.milestone_ids, 'milestones');
  if (!milestones.ok) return milestones;
  const events = idList(input.event_ids, 'events');
  if (!events.ok) return events;

  const supersedes =
    typeof input.supersedes_update_id === 'string' &&
    input.supersedes_update_id.trim()
      ? input.supersedes_update_id.trim()
      : null;

  const rawRecipients = Array.isArray(input.recipients) ? input.recipients : [];
  if (rawRecipients.length > UPDATE_MAX_RECIPIENTS) {
    return {
      ok: false,
      error: `At most ${UPDATE_MAX_RECIPIENTS} recipients per update`,
    };
  }
  const recipients: UpdateComposeInput['recipients'] = [];
  const seen = new Set<string>();
  for (const r of rawRecipients) {
    if (!r || typeof r !== 'object') {
      return { ok: false, error: 'Each recipient needs a stakeholder_id' };
    }
    const rec = r as Record<string, unknown>;
    const stakeholderId =
      typeof rec.stakeholder_id === 'string' ? rec.stakeholder_id.trim() : '';
    if (!stakeholderId) {
      return { ok: false, error: 'Each recipient needs a stakeholder_id' };
    }
    if (seen.has(stakeholderId)) continue;
    seen.add(stakeholderId);
    const channel = rec.channel ?? 'portal_only';
    if (!isUpdateChannel(channel)) {
      return { ok: false, error: 'Unknown delivery channel' };
    }
    recipients.push({ stakeholderId, channel });
  }

  return {
    ok: true,
    value: {
      headline,
      body: body || null,
      visibility: input.visibility,
      milestoneIds: milestones.value,
      eventIds: events.value,
      supersedesUpdateId: supersedes,
      recipients,
      ttl: input.ttl,
      otpRequired: input.otp_required === true,
      source:
        input.source === 'mobile' || input.source === 'api'
          ? input.source
          : 'web',
    },
  };
}

export interface SnapshotSources {
  property_label: string | null;
  stage: string | null;
  milestones: readonly {
    id: string;
    title: string;
    status: DealMilestoneStatus;
    position: number;
    target_date: string | null;
    completed_at: string | null;
    visibility: DealVisibility;
  }[];
  events: readonly {
    id: string;
    event_type: string;
    title: string;
    created_at: string;
    visibility: DealVisibility;
  }[];
}

/**
 * Freeze the selected items into the update. Refuses an item the
 * audience may not see, and an id that is not on this deal, rather
 * than silently dropping it — the agent chose it and should know.
 */
export function buildUpdateSnapshot(args: {
  visibility: DealUpdateVisibility;
  sources: SnapshotSources;
  milestoneIds: readonly string[];
  eventIds: readonly string[];
}): ParseResult<DealUpdateSnapshot> {
  const { visibility, sources } = args;
  const milestones: DealUpdateSnapshot['milestones'] = [];
  for (const id of args.milestoneIds) {
    const m = sources.milestones.find((x) => x.id === id);
    if (!m) return { ok: false, error: 'Milestone not found on this deal' };
    if (!snapshotItemAllowed(visibility, m.visibility)) {
      return {
        ok: false,
        error: `"${m.title}" is not visible to this audience. Change its visibility first or leave it out.`,
      };
    }
    milestones.push({
      id: m.id,
      title: m.title,
      status: m.status,
      target_date: m.target_date,
      completed_at: m.completed_at,
    });
  }
  milestones.sort((a, b) => {
    const pa = sources.milestones.find((m) => m.id === a.id)?.position ?? 0;
    const pb = sources.milestones.find((m) => m.id === b.id)?.position ?? 0;
    return pa - pb;
  });

  const events: DealUpdateSnapshot['events'] = [];
  for (const id of args.eventIds) {
    const e = sources.events.find((x) => x.id === id);
    if (!e)
      return { ok: false, error: 'Timeline entry not found on this deal' };
    if (!snapshotItemAllowed(visibility, e.visibility)) {
      return {
        ok: false,
        error: `"${e.title}" is not visible to this audience. Leave it out or file a note that is.`,
      };
    }
    events.push({
      id: e.id,
      event_type: e.event_type,
      title: e.title,
      created_at: e.created_at,
    });
  }
  events.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const total = sources.milestones.length;
  const done = sources.milestones.filter(
    (m) => m.status === 'completed' || m.status === 'skipped'
  ).length;

  return {
    ok: true,
    value: {
      property_label: sources.property_label,
      stage: sources.stage,
      progress: { total, done },
      milestones,
      events,
    },
  };
}

const MILESTONE_MARK: Record<DealMilestoneStatus, string> = {
  completed: '✅',
  skipped: '➖',
  in_progress: '🔄',
  pending: '⬜',
};

/**
 * The notice a recipient receives — the same text whether the Engine
 * sends it inside the window, the agent hands it over from their own
 * phone, or the preview shows it. Fixed format, no marketing: the
 * headline, the message, the quoted items, and the private link.
 */
export function renderUpdateNotice(args: {
  recipientName: string;
  brandName: string;
  dealTitle: string;
  headline: string;
  body: string | null;
  snapshot: Pick<DealUpdateSnapshot, 'milestones' | 'events' | 'progress'>;
  url: string | null;
  correction?: boolean;
}): string {
  const first = args.recipientName.trim().split(/\s+/)[0] || 'there';
  const lines: string[] = [
    `Hi ${first}, ${args.correction ? 'a correction' : 'an update'} on ${args.dealTitle} from ${args.brandName}.`,
    '',
    `*${args.headline}*`,
  ];
  if (args.body) lines.push('', args.body);
  if (args.snapshot.milestones.length > 0) {
    lines.push('');
    for (const m of args.snapshot.milestones) {
      lines.push(
        `${MILESTONE_MARK[m.status]} ${m.title}${m.target_date && m.status !== 'completed' ? ` (by ${m.target_date})` : ''}`
      );
    }
  }
  if (args.snapshot.events.length > 0) {
    lines.push('');
    for (const e of args.snapshot.events) lines.push(`• ${e.title}`);
  }
  if (args.snapshot.progress.total > 0) {
    lines.push(
      '',
      `Progress: ${args.snapshot.progress.done} of ${args.snapshot.progress.total} milestones done.`
    );
  }
  if (args.url) {
    lines.push(
      '',
      `Full details on your private link: ${args.url}`,
      "It expires automatically. Please don't forward it."
    );
  }
  return lines.join('\n');
}

/** The URL a notice points at: the recipient's own link, naming the
 *  update so the open is recorded against it. */
export function updateNoticeUrl(linkUrl: string, updateId: string): string {
  return `${linkUrl}?u=${encodeURIComponent(updateId)}`;
}

/**
 * How an Engine send goes out, decided the same way for the preview
 * and the publish. Free-form inside the recipient's 24-hour window;
 * outside it only the purchase-progress template is honest, and only
 * to the buyer whose purchase it is. Anything else cannot be sent
 * through the business number and the agent is told so.
 */
export function engineDeliveryMode(args: {
  side: DealSide;
  withinWindow: boolean;
  templateApproved: boolean;
}): { mode: 'free_form' | 'template' } | { mode: null; reason: string } {
  if (args.withinWindow) return { mode: 'free_form' };
  if (args.side !== 'buyer') {
    return {
      mode: null,
      reason:
        'Their 24-hour window is closed and no approved template addresses the seller side. Hand the link over from your phone.',
    };
  }
  if (!args.templateApproved) {
    return {
      mode: null,
      reason:
        'Their 24-hour window is closed and the Purchase progress template is not approved on this account. Hand the link over from your phone, or submit the template in Settings → Templates.',
    };
  }
  return { mode: 'template' };
}

/** The wa.me handoff from the agent's own phone. */
export function personalWhatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
