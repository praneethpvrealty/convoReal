import { createHmac, timingSafeEqual } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
export const AGENDA_PDF_LINK_TTL_MS = 7 * DAY_MS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AgendaPdfClaim {
  accountId: string;
  userId: string;
  date: string;
  exp: number;
}

function serverKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  return Buffer.from(hex, 'hex');
}

function sign(payload: string): string {
  return createHmac('sha256', serverKey())
    .update(`agenda-pdf:${payload}`)
    .digest('base64url');
}

export function isAgendaDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function istDateOf(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function mintAgendaPdfToken(
  claim: Omit<AgendaPdfClaim, 'exp'>,
  now: Date = new Date()
): string {
  const exp = now.getTime() + AGENDA_PDF_LINK_TTL_MS;
  const payload = Buffer.from(
    `${claim.accountId}.${claim.userId}.${claim.date}.${exp}`
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyAgendaPdfToken(
  token: string,
  now: Date = new Date()
): AgendaPdfClaim | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(sign(payload), 'base64url');
  } catch {
    return null;
  }
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  const fields = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  if (fields.length !== 4) return null;
  const [accountId, userId, date, expRaw] = fields;
  const exp = Number(expRaw);
  if (!UUID.test(accountId) || !UUID.test(userId) || !isAgendaDate(date)) {
    return null;
  }
  if (!Number.isFinite(exp) || exp < now.getTime()) return null;
  return { accountId, userId, date, exp };
}

export function agendaPdfUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/public/agenda-pdf/${token}`;
}

export function agendaPdfLinkFor(
  claim: Omit<AgendaPdfClaim, 'exp'>,
  now: Date = new Date()
): string | null {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!site) return null;
  try {
    return agendaPdfUrl(site, mintAgendaPdfToken(claim, now));
  } catch (err) {
    console.error('[agenda-pdf] could not sign link:', err);
    return null;
  }
}
