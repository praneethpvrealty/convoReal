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

export interface CalendarEvent {
  id: string;
  account_id: string;
  user_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  event_type: EventTypeKey;
  source: "web" | "whatsapp" | "voice" | "system";
  transcript: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  status: "scheduled" | "completed" | "cancelled";
  contact_id: string | null;
  property_id: string | null;
  contact?: { id: string; name: string; phone: string } | null;
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
