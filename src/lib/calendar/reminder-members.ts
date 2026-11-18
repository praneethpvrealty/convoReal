export interface ReminderMemberSource {
  user_id: string | null;
  assigned_to: string | null;
  remind_creator?: boolean | null;
}

export function reminderMemberIds(appt: ReminderMemberSource): string[] {
  const ids: string[] = [];
  if (appt.assigned_to && appt.assigned_to !== appt.user_id) {
    ids.push(appt.assigned_to);
  }
  if (appt.user_id && appt.remind_creator !== false) ids.push(appt.user_id);
  return ids;
}
