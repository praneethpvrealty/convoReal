// ============================================================
// Catalog of configurable notification events. Each event maps to a
// createNotification() call site (passed as `eventKey`) and carries the
// default channels used when an account hasn't overridden them in
// Settings → Notifications. "App" folds the in-app bell and mobile push
// into one user-facing switch; WhatsApp is the agent-ping channel.
//
// Defaults here MUST match the historical hardcoded behaviour of each
// call site so turning this on changes nothing until an account edits it.
// ============================================================

export interface NotificationEventDef {
  key: string;
  group: string;
  label: string;
  description: string;
  defaults: { app: boolean; whatsapp: boolean };
}

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  {
    key: 'first_inbound_message',
    group: 'Inbox',
    label: 'New lead messages you',
    description: "The first message on a brand-new lead's thread.",
    defaults: { app: true, whatsapp: true },
  },
  {
    key: 'inbound_reply',
    group: 'Inbox',
    label: 'Contact replies',
    description: 'A reply on a thread you had already caught up on.',
    defaults: { app: true, whatsapp: false },
  },
  {
    key: 'appointment_booked',
    group: 'Calendar',
    label: 'Appointment booked',
    description: 'A lead books a slot from your calendar.',
    defaults: { app: true, whatsapp: true },
  },
  {
    key: 'appointment_reminder',
    group: 'Calendar',
    label: 'Appointment reminder',
    description: 'A heads-up shortly before an appointment starts.',
    defaults: { app: true, whatsapp: false },
  },
  {
    key: 'appointment_overdue',
    group: 'Calendar',
    label: 'Appointment follow-up',
    description: 'A nudge to log the outcome after an appointment.',
    defaults: { app: true, whatsapp: false },
  },
  {
    key: 'daily_digest',
    group: 'Calendar',
    label: 'Daily schedule digest',
    description: 'Your appointments and to-dos for the day.',
    defaults: { app: true, whatsapp: false },
  },
];

const EVENT_BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function getNotificationEvent(key: string): NotificationEventDef | undefined {
  return EVENT_BY_KEY.get(key);
}
