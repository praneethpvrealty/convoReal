import type { AutomationTriggerType } from '@/types';

export interface TriggerMeta {
  label: string;
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string;
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New Message',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'First Message from Contact',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Keyword Match',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'New Contact',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversation Assigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Tag Added',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Time-Based',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  },
};

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    }
  );
}

export const UNAVAILABLE_TRIGGERS: readonly string[] = [
  'conversation_assigned',
  'tag_added',
  'time_based',
];

export function isTriggerAvailable(t: AutomationTriggerType | string): boolean {
  return !UNAVAILABLE_TRIGGERS.includes(t);
}

export function triggerLabel(t: AutomationTriggerType | string): string {
  const label = triggerMeta(t).label;
  return isTriggerAvailable(t) ? label : `${label} (not yet available)`;
}

export function triggerActivationSentence(
  t: AutomationTriggerType | string,
  config?: Record<string, unknown> | null
): string {
  switch (t) {
    case 'new_message_received':
      return 'This will run for every incoming message from every contact.';
    case 'first_inbound_message':
      return 'This will run the first time each contact ever messages you.';
    case 'keyword_match': {
      const raw: unknown = config?.keywords;
      const keywords = Array.isArray(raw)
        ? raw.filter(
            (k): k is string => typeof k === 'string' && k.trim() !== ''
          )
        : [];
      return keywords.length > 0
        ? `This will run for every incoming message that matches ${keywords
            .map((k) => `"${k}"`)
            .join(', ')}, from every contact.`
        : 'This will run for every incoming message that matches its keywords, from every contact.';
    }
    case 'new_contact_created':
      return 'This will run for every new contact, whether it arrives by WhatsApp message, portal email lead or voice call.';
    default:
      return 'This trigger is not yet available, so this automation will not run until you pick another trigger.';
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
