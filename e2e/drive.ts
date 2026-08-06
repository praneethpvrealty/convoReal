/**
 * Logs into the throwaway account and walks the screens, capturing a
 * screenshot of each. Exists because reasoning about a component is not
 * the same as looking at the page: the engine-template banner shipped
 * only after a round trip where the button a user was told to press did
 * not exist on the screen they were told to press it on.
 */
import { chromium, type Page } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const SHOTS = 'e2e/shots';

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

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  ▸ ${SHOTS}/${name}.png`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const env = creds();
  // Chromium picks up HTTPS_PROXY from the environment and gets
  // ERR_CONNECTION_RESET on Supabase, so send it straight out instead.
  // Direct egress is transparently TLS-intercepted and Chromium does not
  // carry that CA, which is what ignoreHTTPSErrors below is for.
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-proxy-server'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  // A fresh owner account opens the setup wizard over every screen, so
  // without this every screenshot is a picture of the wizard. Dismiss it
  // the same way the UI does rather than clicking through it each run.
  await page.addInitScript((accountId) => {
    localStorage.setItem(`onboarding_dismissed_${accountId}`, 'true');
  }, env.E2E_ACCOUNT_ID);
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (/google|vercel-scripts|gstatic/.test(url)) return; // browser telemetry
    console.log(`  [failed] ${r.failure()?.errorText} ${url.slice(0, 110)}`);
  });
  const problems: string[] = [];

  try {
    console.log('login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

    // Fill after hydration and assert the value stuck: a fill that lands
    // before React attaches is silently discarded, which shows up much
    // later as an empty field and a "please fill out this field" bubble.
    const email = page.locator('input[type="email"]').first();
    const password = page.locator('input[type="password"]').first();
    await email.waitFor({ state: 'visible' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await email.fill(env.E2E_EMAIL);
      await password.fill(env.E2E_PASSWORD);
      if ((await email.inputValue()) === env.E2E_EMAIL) break;
      await page.waitForTimeout(500);
    }
    if ((await email.inputValue()) !== env.E2E_EMAIL) {
      throw new Error('email field would not accept input');
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Capture whatever the page says before giving up — a silent
    // timeout here tells you nothing about why the login stalled.
    try {
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
    } catch {
      await shot(page, '01-login-stuck');
      const err = await page.locator('[role="alert"], .text-red-400, .text-destructive').allInnerTexts();
      throw new Error(`login did not navigate. on-page messages: ${JSON.stringify(err)}`);
    }
    console.log(`  landed on ${new URL(page.url()).pathname}`);
    // waitForURL fires the moment the route changes, which is before the
    // profile and the stat tiles resolve — shooting now photographs
    // skeletons and a placeholder user name.
    await page.waitForTimeout(3000);
    await shot(page, '01-after-login');

    console.log('settings → whatsapp templates');
    await page.goto(`${BASE}/settings?tab=whatsapp&sub=templates`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await shot(page, '02-templates');

    // The banner this harness was built to verify.
    const banner = page.getByText(/the Engine sends (is|are) missing/i);
    if (await banner.count()) {
      console.log('  ✓ engine-template banner present');
      const cta = page.getByRole('button', { name: /create & submit/i });
      console.log(`  ✓ ${await cta.count()} create-and-submit button(s)`);
    } else {
      problems.push('engine-template banner not rendered on the templates tab');
    }

    for (const [name, path] of [
      ['03-inventory', '/inventory'],
      ['04-contacts', '/contacts'],
      ['05-radar', '/radar'],
    ] as const) {
      console.log(`visiting ${path}`);
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await shot(page, name);
    }
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.error('\nPROBLEMS:');
    for (const p of problems) console.error(` ✗ ${p}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
