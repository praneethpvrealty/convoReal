const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
};

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAuditDate(
  value: string | null | undefined,
  locale = 'en-IN'
): string {
  const date = validDate(value);
  return date ? date.toLocaleDateString(locale, DATE_OPTIONS) : '—';
}

export function formatAuditDateTime(
  value: string | null | undefined,
  locale = 'en-IN'
): string {
  const date = validDate(value);
  return date ? date.toLocaleString(locale, DATE_TIME_OPTIONS) : '—';
}
