/**
 * Delivery-failure normalization shared by the webhook, dispatcher, and UI.
 *
 * Older rows can contain a failure note appended to `content_text`. New rows
 * keep the original body untouched and store failure metadata in dedicated
 * columns. Keeping the legacy stripper makes old conversations safe to
 * resend/forward while the structured fields prevent this bug recurring.
 */

export const DELIVERY_FAILURE_MARKER = '❌ Delivery Failed:';
export const META_MARKETING_FREQUENCY_ERROR = 131049;
export const MARKETING_SUPPRESSION_MS = 24 * 60 * 60 * 1000;
export const MARKETING_SUPPRESSION_MESSAGE =
  'WhatsApp temporarily limited marketing messages to this contact. Wait until the cooldown ends or until the contact replies.';

interface FailureLike {
  status?: string | null;
  content_text?: string | null;
  error_code?: number | null;
  error_info?: string | null;
  retry_after?: string | null;
  created_at?: string | null;
}

export interface DeliveryFailurePresentation {
  title: string;
  detail: string;
  retryAt: string | null;
  canRetry: boolean;
}

/** The message as it was composed, without the appended failure note. */
export function stripDeliveryFailure(text: string | null | undefined): string {
  if (!text) return '';
  const at = text.indexOf(DELIVERY_FAILURE_MARKER);
  return (at === -1 ? text : text.slice(0, at)).trim();
}

export function metaErrorCode(value: unknown): number | null {
  const text = value instanceof Error ? value.message : String(value ?? '');
  const match = text.match(/(?:Error|error|#)\s*(\d{5,6})/);
  return match ? Number(match[1]) : null;
}

export function isMarketingFrequencyError(value: unknown): boolean {
  return metaErrorCode(value) === META_MARKETING_FREQUENCY_ERROR;
}

export function marketingRetryAfter(at: Date = new Date()): string {
  return new Date(at.getTime() + MARKETING_SUPPRESSION_MS).toISOString();
}

export function isMarketingTemplateSuppressed(
  category: string | null | undefined,
  suppressedUntil: string | null | undefined,
  now: Date = new Date()
): boolean {
  return Boolean(
    category?.toUpperCase() === 'MARKETING' &&
    suppressedUntil &&
    new Date(suppressedUntil).getTime() > now.getTime()
  );
}

export function deliveryErrorCode(message: FailureLike): number | null {
  return (
    message.error_code ??
    metaErrorCode(message.error_info) ??
    metaErrorCode(message.content_text)
  );
}

export function deliveryRetryAfter(message: FailureLike): string | null {
  if (message.retry_after) return message.retry_after;
  if (
    deliveryErrorCode(message) === META_MARKETING_FREQUENCY_ERROR &&
    message.created_at
  ) {
    const created = new Date(message.created_at);
    if (!Number.isNaN(created.getTime())) return marketingRetryAfter(created);
  }
  return null;
}

export function canRetryDeliveryFailure(
  message: FailureLike,
  now: Date = new Date()
): boolean {
  if (message.status !== 'failed') return true;
  if (deliveryErrorCode(message) !== META_MARKETING_FREQUENCY_ERROR)
    return true;
  const retryAt = deliveryRetryAfter(message);
  return Boolean(retryAt && new Date(retryAt).getTime() <= now.getTime());
}

export function deliveryFailurePresentation(
  message: FailureLike,
  now: Date = new Date()
): DeliveryFailurePresentation | null {
  if (message.status !== 'failed') return null;
  if (deliveryErrorCode(message) === META_MARKETING_FREQUENCY_ERROR) {
    const retryAt = deliveryRetryAfter(message);
    const canRetry = canRetryDeliveryFailure(message, now);
    return {
      title: 'Not delivered — WhatsApp marketing limit',
      detail: canRetry
        ? 'The cooldown has ended. You can try once, or wait for the contact to reply.'
        : MARKETING_SUPPRESSION_MESSAGE,
      retryAt,
      canRetry,
    };
  }
  return {
    title: 'Delivery failed',
    detail: message.error_info || 'WhatsApp could not deliver this message.',
    retryAt: message.retry_after ?? null,
    canRetry: true,
  };
}

export function deliveryFailureUpdate(
  errors: Array<{
    code: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>,
  at: Date = new Date()
): {
  error_code: number | null;
  error_info: string;
  retry_after: string | null;
} {
  const first = errors[0];
  if (first?.code === META_MARKETING_FREQUENCY_ERROR) {
    return {
      error_code: META_MARKETING_FREQUENCY_ERROR,
      error_info: MARKETING_SUPPRESSION_MESSAGE,
      retry_after: marketingRetryAfter(at),
    };
  }
  const detail = errors
    .map((error) =>
      [error.message || error.title, error.error_data?.details]
        .filter(Boolean)
        .join(': ')
    )
    .filter(Boolean)
    .join('\n');
  return {
    error_code: first?.code ?? null,
    error_info: detail || 'WhatsApp could not deliver this message.',
    retry_after: null,
  };
}
