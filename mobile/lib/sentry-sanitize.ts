import type { ErrorEvent } from '@sentry/react-native';

const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|phone|email|message|body|payload|content|address|contact)/i;

export function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]')
    .replace(/(?:\+?\d[\s().-]*){8,}/g, '[phone]')
    .replace(/\b(?:[A-F0-9]{32,}|[A-Za-z0-9_-]{40,})\b/gi, '[token]');
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

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;
  event.message = event.message
    ? redactSensitiveText(event.message)
    : event.message;
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
