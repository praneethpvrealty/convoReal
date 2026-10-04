import { formatInrCompact } from '@shared/lib/format/currency';

/** Formatting helpers shared across screens. */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** WhatsApp-style list timestamp: time today, "Yesterday", weekday within 6 days, else date. */
export function chatListTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (today - day === DAY_MS) return 'Yesterday';
  if (today - day < 7 * DAY_MS) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export function bubbleTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const AUDIT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

export function auditDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-IN', AUDIT_DATE_OPTIONS);
}

export function auditDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', {
        ...AUDIT_DATE_OPTIONS,
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** Day-separator label inside a thread. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return 'Today';
  if (today - day === DAY_MS) return 'Yesterday';
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic avatar hue per name/phone so lists feel alive but stable. */
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

export { priceInWords } from '@shared/lib/format/currency';

/** Indian price notation: ₹85 L, ₹1.2 Cr; an em dash when there is no amount. */
export function formatInr(n: number | null | undefined): string {
  return n ? formatInrCompact(n) : '—';
}

/** A budget as people say it: "Up to ₹4.4 Cr", "₹2 Cr+", or a range —
 *  never "— – ₹4.4 Cr" when only one bound is set. */
export function formatBudgetRange(
  min: number | null | undefined,
  max: number | null | undefined,
  noBudget?: boolean | null
): string | null {
  if (noBudget) return 'No budget constraint';
  if (min && max) return `${formatInr(min)} – ${formatInr(max)}`;
  if (max) return `Up to ${formatInr(max)}`;
  if (min) return `${formatInr(min)}+`;
  return null;
}

/**
 * Same normalization as the web's WhatsappPhoneVerify: bare 10-digit
 * numbers get +91 (the product's home market); anything else must
 * already be E.164.
 */
export function cleanPhoneInput(raw: string): string | null {
  let phone = raw.trim().replace(/\s+/g, '');
  if (!phone.startsWith('+')) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) phone = `+91${digits}`;
    else return null;
  }
  return phone;
}

/** Parse a `YYYY-MM-DD` column value as a LOCAL calendar day.
 *
 *  `new Date('2026-09-14')` is UTC midnight, which west of UTC renders
 *  as the 13th — and saving the form would then write that earlier day
 *  back. Splitting the parts keeps the day the database holds. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
