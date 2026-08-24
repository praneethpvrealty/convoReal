// ============================================================
// Browser harness for the multi-language pass.
//
// Shares drive.ts's launch accommodations (see e2e/README.md):
// --no-proxy-server, because an inherited HTTPS_PROXY fails Supabase
// with ERR_CONNECTION_RESET, and ignoreHTTPSErrors for the CA that
// direct egress is intercepted with.
//
// One addition of its own: no wait here keys off `load` or
// `networkidle`. The dashboard holds a long-poll on /api/notifications
// and retries a realtime socket, so neither ever settles — every wait
// below keys off DOM state, which is what the user actually sees.
// ============================================================

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const SHOTS = 'e2e/shots';

const bundledChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromePath =
  process.env.E2E_CHROMIUM?.trim() ||
  (existsSync(bundledChrome) ? bundledChrome : undefined);

export async function launch() {
  const accountId = process.env.E2E_ACCOUNT_ID?.trim();
  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ['--no-proxy-server'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  if (accountId) {
    await ctx.addInitScript((storedAccountId) => {
      try {
        localStorage.setItem(`onboarding_dismissed_${storedAccountId}`, 'true');
      } catch {
        // localStorage might be unavailable in some startup contexts; ignore.
      }
    }, accountId);
  }
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

export async function login(page) {
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD must be set.');
  }
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // The form is interactive only after hydration; filling before that
  // types into an input whose handler is not attached yet.
  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByLabel(/email/i).first().fill(process.env.E2E_EMAIL);
  await page.locator('input[type="password"]').first().fill(process.env.E2E_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, {
    timeout: 60000,
  });
  await page.waitForSelector('nav a, aside a', { timeout: 60000 });
  return page.url();
}

/** Settings tab, then the sub-tab where a panel lives. */
export async function openSettings(page, tab) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav a, aside a', { timeout: 30000 });
  await page.getByRole('button', { name: tab, exact: true }).first().click();
  await page.waitForTimeout(1500);
}

export async function openTemplates(page) {
  await openSettings(page, 'WhatsApp');
  await page.getByRole('button', { name: /Templates/i }).first().click();
  await page.waitForTimeout(3500);
}
