/**
 * Delivery-failure normalization shared by the webhook, dispatcher, and UI.
 *
 * Older rows can contain a failure note appended to `content_text`. New rows
 * keep the original body untouched and store failure metadata in dedicated
 * columns. Keeping the legacy stripper makes old conversations safe to
 * resend/forward while the structured fields prevent this bug recurring.
 */

export const DELIVERY_FAILURE_MARKER = '❌ Delivery Failed:';

/** Per-recipient frequency cap on Marketing templates. */
export const META_MARKETING_FREQUENCY_ERROR = 131049;

/**
 * Meta holds this number in an experiment group and drops Marketing
 * templates to it outright. Utility and Authentication templates, and
 * free-form replies inside the 24-hour window, are unaffected, and the
 * block lifts when the contact messages the business.
 */
export const META_MARKETING_EXPERIMENT_ERROR = 130472;

/** Both block Marketing to one recipient, and both clear on a reply. */
export const MARKETING_BLOCK_ERRORS: readonly number[] = [
  META_MARKETING_FREQUENCY_ERROR,
  META_MARKETING_EXPERIMENT_ERROR,
];

export const MARKETING_SUPPRESSION_MS = 24 * 60 * 60 * 1000;

/**
 * Nothing says how long an experiment runs, so this is a horizon, not a
 * countdown: long enough that the pause is not quietly lifted while the
 * block is still live, and a reply clears it the moment it ends.
 */
export const EXPERIMENT_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const MARKETING_SUPPRESSION_MESSAGE =
  'WhatsApp temporarily limited marketing messages to this contact. Wait until the cooldown ends or until the contact replies.';

export const EXPERIMENT_SUPPRESSION_MESSAGE =
  'WhatsApp is running an experiment on this number and is dropping marketing templates to it. Ask the contact to message you — their reply clears the block, and a Utility template still reaches them meanwhile.';

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

/** Is this code one that blocks Marketing to a single recipient? */
export function isMarketingBlockCode(code: number | null | undefined): boolean {
  return code != null && MARKETING_BLOCK_ERRORS.includes(code);
}

/** The blocking code inside an error or message, or null. */
export function marketingBlockCode(value: unknown): number | null {
  const code = metaErrorCode(value);
  return isMarketingBlockCode(code) ? code : null;
}

export function isMarketingBlockError(value: unknown): boolean {
  return marketingBlockCode(value) !== null;
}

/** How long Marketing stays paused for a recipient after this code. */
export function marketingSuppressionMs(
  code: number | null | undefined
): number {
  return code === META_MARKETING_EXPERIMENT_ERROR
    ? EXPERIMENT_SUPPRESSION_MS
    : MARKETING_SUPPRESSION_MS;
}

/** What an agent should be told about a Marketing block. */
export function marketingBlockMessage(code: number | null | undefined): string {
  return code === META_MARKETING_EXPERIMENT_ERROR
    ? EXPERIMENT_SUPPRESSION_MESSAGE
    : MARKETING_SUPPRESSION_MESSAGE;
}

export function marketingRetryAfter(
  at: Date = new Date(),
  code: number = META_MARKETING_FREQUENCY_ERROR
): string {
  return new Date(at.getTime() + marketingSuppressionMs(code)).toISOString();
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
  const code = deliveryErrorCode(message);
  if (isMarketingBlockCode(code) && message.created_at) {
    const created = new Date(message.created_at);
    if (!Number.isNaN(created.getTime())) {
      return marketingRetryAfter(created, code as number);
    }
  }
  return null;
}

export function canRetryDeliveryFailure(
  message: FailureLike,
  now: Date = new Date()
): boolean {
  if (message.status !== 'failed') return true;
  if (!isMarketingBlockCode(deliveryErrorCode(message))) return true;
  const retryAt = deliveryRetryAfter(message);
  return Boolean(retryAt && new Date(retryAt).getTime() <= now.getTime());
}

export function deliveryFailurePresentation(
  message: FailureLike,
  now: Date = new Date()
): DeliveryFailurePresentation | null {
  if (message.status !== 'failed') return null;
  const blockCode = deliveryErrorCode(message);
  if (isMarketingBlockCode(blockCode)) {
    const retryAt = deliveryRetryAfter(message);
    const canRetry = canRetryDeliveryFailure(message, now);
    return {
      title:
        blockCode === META_MARKETING_EXPERIMENT_ERROR
          ? 'Not delivered — WhatsApp experiment on this number'
          : 'Not delivered — WhatsApp marketing limit',
      detail: canRetry
        ? 'The pause has ended. You can try once, or wait for the contact to reply.'
        : marketingBlockMessage(blockCode),
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
  if (isMarketingBlockCode(first?.code)) {
    return {
      error_code: first.code,
      error_info: marketingBlockMessage(first.code),
      retry_after: marketingRetryAfter(at, first.code),
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
