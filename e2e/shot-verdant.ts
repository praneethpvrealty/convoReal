/**
 * Logs into the throwaway account and photographs key screens in the
 * Verdant theme (dark + light), so the accent can be reviewed on the
 * real app rather than on a mock. Same login/settle patterns as
 * drive.ts; screenshots land in e2e/shots/verdant-*.png.
 */
import { chromium, type Page } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const SHOTS = 'e2e/shots';
const THEME = process.env.SHOT_THEME || 'verdant';

function creds() {
  const env = Object.fromEntries(
    readFileSync('.env.e2e.local', 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  if (!env.E2E_EMAIL) throw new Error('Run `npx tsx e2e/provision.ts` first.');
  return env;
}

async function settle(page: Page) {
  await page
    .waitForFunction(
      () => ((document.querySelector('main') ?? document.body) as HTMLElement).innerText.trim().length > 40,
      undefined,
      { timeout: 60_000, polling: 250 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const env = creds();
  const browser = await chromium.launch({
    executablePath: process.env.E2E_CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-proxy-server'],
  });

  try {
    for (const mode of ['dark', 'light'] as const) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        ignoreHTTPSErrors: true,
      });
      await page.addInitScript(
        ([accountId, theme, m]) => {
          localStorage.setItem(`onboarding_dismissed_${accountId}`, 'true');
          localStorage.setItem('convoreal.theme', theme);
          localStorage.setItem('convoreal.mode', m);
        },
        [env.E2E_ACCOUNT_ID, THEME, mode] as const,
      );

      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      const email = page.locator('input[type="email"]').first();
      const password = page.locator('input[type="password"]').first();
      await email.waitFor({ state: 'visible' });
      for (let attempt = 0; attempt < 3; attempt++) {
        await email.fill(env.E2E_EMAIL);
        await password.fill(env.E2E_PASSWORD);
        if ((await email.inputValue()) === env.E2E_EMAIL) break;
        await page.waitForTimeout(500);
      }
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });

      for (const [name, path] of [
        ['dashboard', '/dashboard'],
        ['inventory', '/inventory'],
        ['contacts', '/contacts'],
        ['inbox', '/inbox'],
      ] as const) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/${THEME}-${mode}-${name}.png`, fullPage: false });
        console.log(`  ▸ ${SHOTS}/${THEME}-${mode}-${name}.png`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
