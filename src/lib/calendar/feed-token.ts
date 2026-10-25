import { createHash, randomBytes } from 'node:crypto';

import { FEED_TOKEN_PREFIX } from '@/lib/calendar/ics-feed';

export function generateFeedToken(): { token: string; hash: string } {
  const token = `${FEED_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashFeedToken(token) };
}

export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function feedUrls(
  siteUrl: string,
  token: string
): { url: string; webcalUrl: string; googleUrl: string } {
  const url = `${siteUrl.replace(/\/+$/, '')}/api/public/calendar-feed/${token}.ics`;
  const webcalUrl = url.replace(/^https?:\/\//, 'webcal://');
  return {
    url,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
  };
}
