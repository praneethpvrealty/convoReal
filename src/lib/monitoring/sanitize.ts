import type { ErrorEvent } from '@sentry/nextjs';

const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|phone|email|message|body|payload|content|address|contact)/i;

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\bBearer\s+[^\s,;]+/gi, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]'],
  [/(?:\+?\d[\s().-]*){8,}/g, '[phone]'],
  [/\b(?:[A-F0-9]{32,}|[A-Za-z0-9_-]{40,})\b/gi, '[token]'],
];

export function redactSensitiveText(value: string): string {
  return REDACTIONS.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    value
  );
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value))
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, 50)
      .map(([key, child]) => [key, sanitizeValue(child, depth + 1)])
  );
}

function stripUrlSecrets(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split(/[?#]/, 1)[0];
  }
}

/**
 * ConvoReal handles messages and contact data. Keep Sentry useful for
 * diagnostics while ensuring those customer payloads never leave the app.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.url = stripUrlSecrets(event.request.url);
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.env;
    delete event.request.headers;
  }

  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }

  event.message = event.message
    ? redactSensitiveText(event.message)
    : event.message;
  if (event.logentry?.message) {
    event.logentry.message = redactSensitiveText(event.logentry.message);
  }
  event.exception?.values?.forEach((exception) => {
    if (exception.value) exception.value = redactSensitiveText(exception.value);
  });
  event.breadcrumbs?.forEach((breadcrumb) => {
    if (breadcrumb.message)
      breadcrumb.message = redactSensitiveText(breadcrumb.message);
    breadcrumb.data = sanitizeValue(breadcrumb.data) as
      | Record<string, unknown>
      | undefined;
  });
  event.contexts = sanitizeValue(event.contexts) as ErrorEvent['contexts'];
  event.extra = sanitizeValue(event.extra) as ErrorEvent['extra'];

  return event;
}
