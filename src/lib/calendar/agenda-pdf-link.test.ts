import { describe, expect, it } from 'vitest';

import {
  AGENDA_PDF_LINK_TTL_MS,
  agendaPdfLinkFor,
  isAgendaDate,
  istDateOf,
  mintAgendaPdfToken,
  verifyAgendaPdfToken,
} from './agenda-pdf-link';

const claim = {
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  date: '2026-11-04',
};
const NOW = new Date('2026-11-04T01:30:00.000Z');

describe('[CAL-017] agenda PDF link', () => {
  it('round-trips a signed claim', () => {
    const token = mintAgendaPdfToken(claim, NOW);
    expect(verifyAgendaPdfToken(token, NOW)).toMatchObject(claim);
  });

  it('refuses a token whose payload was changed', () => {
    const token = mintAgendaPdfToken(claim, NOW);
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      `${claim.accountId}.33333333-3333-4333-8333-333333333333.${claim.date}.${NOW.getTime() + 1000}`
    ).toString('base64url');
    expect(verifyAgendaPdfToken(`${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyAgendaPdfToken(`${token}x`, NOW)).toBeNull();
    expect(verifyAgendaPdfToken('garbage', NOW)).toBeNull();
  });

  it('expires after its TTL', () => {
    const token = mintAgendaPdfToken(claim, NOW);
    const later = new Date(NOW.getTime() + AGENDA_PDF_LINK_TTL_MS + 1);
    expect(verifyAgendaPdfToken(token, later)).toBeNull();
  });

  it('dates the link by the IST day, not the UTC one', () => {
    expect(istDateOf(new Date('2026-11-03T19:00:00.000Z'))).toBe('2026-11-04');
  });

  it('validates calendar dates', () => {
    expect(isAgendaDate('2026-11-04')).toBe(true);
    expect(isAgendaDate('2026-02-30')).toBe(false);
    expect(isAgendaDate('04-11-2026')).toBe(false);
  });

  it('builds a public URL under the site', () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com/';
    try {
      expect(agendaPdfLinkFor(claim, NOW)).toMatch(
        /^https:\/\/app\.example\.com\/api\/public\/agenda-pdf\/[\w-]+\.[\w-]+$/
      );
    } finally {
      process.env.NEXT_PUBLIC_SITE_URL = prev;
    }
  });
});
