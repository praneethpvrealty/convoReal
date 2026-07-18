import {
  MapPin,
  Phone,
  Repeat,
  FileText,
  Users,
  CircleDot,
  type LucideIcon,
} from "lucide-react";

export type EventTypeKey = "site_visit" | "call" | "follow_up" | "document" | "meeting" | "other";

export interface EventTypeMeta {
  key: EventTypeKey;
  label: string;
  icon: LucideIcon;
  /** Chip styling for calendar cells and lane pills. */
  chip: string;
  /** Small solid dot / legend swatch. */
  dot: string;
}

export const EVENT_TYPES: Record<EventTypeKey, EventTypeMeta> = {
  site_visit: {
    key: "site_visit",
    label: "Site Visit",
    icon: MapPin,
    chip: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20",
    dot: "bg-emerald-400",
  },
  call: {
    key: "call",
    label: "Call",
    icon: Phone,
    chip: "bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20",
    dot: "bg-sky-400",
  },
  follow_up: {
    key: "follow_up",
    label: "Follow-up",
    icon: Repeat,
    chip: "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20",
    dot: "bg-amber-400",
  },
  document: {
    key: "document",
    label: "Documents",
    icon: FileText,
    chip: "bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20",
    dot: "bg-violet-400",
  },
  meeting: {
    key: "meeting",
    label: "Meeting",
    icon: Users,
    chip: "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/20",
    dot: "bg-fuchsia-400",
  },
  other: {
    key: "other",
    label: "Other",
    icon: CircleDot,
    chip: "bg-slate-500/10 border-slate-600/40 text-slate-300 hover:bg-slate-500/20",
    dot: "bg-slate-400",
  },
};

export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as EventTypeKey[];

export function eventTypeMeta(key?: string | null): EventTypeMeta {
  return EVENT_TYPES[(key as EventTypeKey) || "other"] || EVENT_TYPES.other;
}

// ── Per-type structured notes ────────────────────────────────
// Each event type carries only the note fields that make sense
// for it: "pre" fields are filled while planning (and ride along
// on the assignee's pre-event WhatsApp brief); "post" fields
// appear once the event exists, for logging what happened.
// A site visit deliberately has no agenda/minutes — just the
// visit outcome.

export type EventFieldKey = "agenda" | "minutes" | "outcome";
export type EventFieldPhase = "pre" | "post";

export interface EventExtraField {
  key: EventFieldKey;
  label: string;
  placeholder: string;
  phase: EventFieldPhase;
}

export const EVENT_TYPE_FIELDS: Record<EventTypeKey, EventExtraField[]> = {
  meeting: [
    { key: "agenda", label: "Agenda", placeholder: "Points to discuss, decisions needed…", phase: "pre" },
    { key: "minutes", label: "Minutes of the meeting", placeholder: "What was discussed and decided…", phase: "post" },
  ],
  call: [
    { key: "agenda", label: "Call agenda / talking points", placeholder: "What to cover on the call…", phase: "pre" },
    { key: "minutes", label: "Call notes / minutes", placeholder: "How the call went, what was agreed…", phase: "post" },
  ],
  follow_up: [
    { key: "agenda", label: "What to follow up on", placeholder: "Pending items to chase…", phase: "pre" },
    { key: "outcome", label: "Outcome / next step", placeholder: "Result of the follow-up and what happens next…", phase: "post" },
  ],
  site_visit: [
    { key: "outcome", label: "Visit feedback / outcome", placeholder: "Client's reaction, objections, interest level…", phase: "post" },
  ],
  document: [
    { key: "agenda", label: "Documents to prepare / carry", placeholder: "EC, khata, sale deed, ID proofs…", phase: "pre" },
    { key: "outcome", label: "Outcome / status", placeholder: "What was verified, signed, or is still pending…", phase: "post" },
  ],
  other: [
    { key: "agenda", label: "Agenda", placeholder: "Points to cover…", phase: "pre" },
    { key: "minutes", label: "Notes / minutes", placeholder: "What happened…", phase: "post" },
  ],
};

export function eventTypeFields(key?: string | null): EventExtraField[] {
  return EVENT_TYPE_FIELDS[(key as EventTypeKey) || "other"] || EVENT_TYPE_FIELDS.other;
}

export interface CalendarEvent {
  id: string;
  account_id: string;
  user_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  agenda?: string | null;
  minutes?: string | null;
  outcome?: string | null;
  event_type: EventTypeKey;
  source: "web" | "whatsapp" | "voice" | "system";
  transcript: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  status: "scheduled" | "completed" | "cancelled";
  contact_id: string | null;
  /** Every contact attached to the event; contact_id mirrors the first. */
  contact_ids?: string[] | null;
  property_id: string | null;
  /** Set when a client taps "Requesting reschedule" on their reminder
   *  (src/lib/whatsapp/webhook-handler.ts). Cleared once the event is
   *  actually moved to a new time. */
  reschedule_requested_at?: string | null;
  /** When the client tapped "Fine" on a reminder (migration 150). */
  client_confirmed_at?: string | null;
  contact?: { id: string; name: string; phone: string; name_tag?: string | null } | null;
  property?: { id: string; title: string; location: string | null; sublocality: string | null } | null;
}

export interface TeamMember {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  org_role?: string;
  team_id: string | null;
}

export function memberInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
