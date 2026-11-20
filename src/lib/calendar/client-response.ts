export type ClientResponseKind = 'reschedule_requested' | 'confirmed';

export interface ClientResponse {
  kind: ClientResponseKind;
  at: string;
}

export function clientResponse(appt: {
  reschedule_requested_at?: string | null;
  client_confirmed_at?: string | null;
}): ClientResponse | null {
  if (appt.reschedule_requested_at) {
    return { kind: 'reschedule_requested', at: appt.reschedule_requested_at };
  }
  if (appt.client_confirmed_at) {
    return { kind: 'confirmed', at: appt.client_confirmed_at };
  }
  return null;
}

export const CLIENT_RESPONSE_LABELS: Record<ClientResponseKind, string> = {
  reschedule_requested: 'Reschedule requested',
  confirmed: 'Client confirmed',
};

export function clientResponseNotice(response: ClientResponse): string {
  const when = new Date(response.at).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return response.kind === 'reschedule_requested'
    ? `Client requested a reschedule on ${when}. Reminders for this time are on hold; moving the event clears this notice.`
    : `Client confirmed on ${when} via the reminder's "Fine" button.`;
}
