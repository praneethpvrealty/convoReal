// Mirror of src/lib/notifications/events.ts (the mobile app can't import
// from the web src tree). Keep the keys and defaults in sync with it —
// the backend resolves channels from the same notification_preferences
// rows regardless of which app wrote them.

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
