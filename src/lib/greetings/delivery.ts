export interface GreetingDelivery {
  status: string;
  total: number;
  sent: number;
  failed: number;
}

export type GreetingStatusTone = 'draft' | 'sending' | 'sent' | 'failed';

export interface GreetingStatusDisplay {
  label: string;
  tone: GreetingStatusTone;
}

interface BroadcastProgressRow {
  status?: string | null;
  total_recipients?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
}

export function greetingDeliveryFromBroadcast(
  row: BroadcastProgressRow | null | undefined
): GreetingDelivery | null {
  if (!row?.status) return null;
  return {
    status: row.status,
    total: row.total_recipients ?? 0,
    sent: row.sent_count ?? 0,
    failed: row.failed_count ?? 0,
  };
}

export function isGreetingDeliveryInFlight(
  delivery: GreetingDelivery | null | undefined
): boolean {
  return delivery?.status === 'sending' || delivery?.status === 'scheduled';
}

export function greetingStatusDisplay(
  status: string,
  delivery: GreetingDelivery | null | undefined
): GreetingStatusDisplay {
  if (status !== 'sent') return { label: 'Draft', tone: 'draft' };
  if (!delivery) return { label: 'Sent', tone: 'sent' };
  if (isGreetingDeliveryInFlight(delivery)) {
    const done = Math.min(delivery.sent + delivery.failed, delivery.total);
    return {
      label: `Sending ${done} of ${delivery.total}`,
      tone: 'sending',
    };
  }
  if (delivery.status === 'failed') return { label: 'Failed', tone: 'failed' };
  if (delivery.failed > 0) {
    return {
      label: `Sent to ${delivery.sent} · ${delivery.failed} failed`,
      tone: 'sent',
    };
  }
  return { label: 'Sent', tone: 'sent' };
}

export const GREETING_IN_FLIGHT_POLL_MS = 5000;

export function greetingInFlightWarning(
  delivery: GreetingDelivery | null | undefined
): string | null {
  if (!delivery || !isGreetingDeliveryInFlight(delivery)) return null;
  const done = Math.min(delivery.sent + delivery.failed, delivery.total);
  return `This greeting is still going out (${done} of ${delivery.total} so far). Sending it again now messages the same contacts twice.`;
}
