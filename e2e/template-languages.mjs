// ============================================================
// Template manager language tabs, and the language-usage card.
//
// The tab counts and the card are the two places an account learns
// that a language it selected has nothing approved behind it, so both
// are checked against numbers recomputed from base tables rather than
// against the aggregate that produced them.
// ============================================================

import { launch, login, openSettings, openTemplates, SHOTS } from './support/browser.mjs';
import { expectedLanguageUsage, resetLocale } from './support/db.mjs';
import { check, summary } from './support/assert.mjs';

const NATIVE = {
  en: 'English', hi: 'हिन्दी', kn: 'ಕನ್ನಡ', ta: 'தமிழ்',
  te: 'తెలుగు', ml: 'മലയാളം', mr: 'मराठी',
};
const ENGINE_TEMPLATE_COUNT = 7;

const { browser, page } = await launch();

try {
  await resetLocale();
  await login(page);
  const expected = await expectedLanguageUsage();

  // ---------- language tabs over the template list ----------
  await openTemplates(page);
  await page.screenshot({ path: `${SHOTS}/template-tabs.png`, fullPage: true });

  const tablist = page.getByRole('tablist', { name: 'Template language' });
  check('template list is split by language', await tablist.isVisible().catch(() => false));

  const tabs = tablist.getByRole('tab');
  const count = await tabs.count();
  check('one tab per supported language', count === 7, `found ${count}`);

  const label = {};
  for (let i = 0; i < count; i++) {
    const text = (await tabs.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    const code = Object.keys(NATIVE).find((c) => text.startsWith(NATIVE[c]));
    label[code ?? text] = text;
  }
  console.log('  tabs:', JSON.stringify(label));

  const wrong = [];
  for (const [code, expectedRow] of Object.entries(expected)) {
    // The tab counts ENGINE templates only, so it is bounded by the
    // approved total for that language.
    const approvedEngine = Math.min(expectedRow.approvedTemplates, ENGINE_TEMPLATE_COUNT);
    const want = `${approvedEngine}/${ENGINE_TEMPLATE_COUNT}`;
    if (!label[code]?.includes(want)) wrong.push(`${code}: want ${want}, got "${label[code]}"`);
  }
  check('every tab count matches the approved templates actually held', wrong.length === 0,
    wrong.length ? wrong.join('; ') : 'all tabs agree with the database');

  // an empty language explains itself rather than looking broken
  await tabs.nth(2).click();
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  check('an empty language tab says so, and says why it matters',
    /No templates in/.test(body) && /missing in/.test(body),
    (body.match(/No templates in [^\n.]*/) || ['(not found)'])[0]);
  await page.screenshot({ path: `${SHOTS}/template-tab-empty.png`, fullPage: true });

  // ---------- language usage card ----------
  await openSettings(page, 'Profile');
  await page.waitForTimeout(3500);

  const api = await page.evaluate(async () => {
    const res = await fetch('/api/analytics/language-usage');
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  check('language-usage endpoint answers', api.status === 200, String(api.status));

  const rows = api.body?.data?.rows ?? api.body?.rows ?? [];
  const byCode = Object.fromEntries(rows.map((r) => [r.language, r]));

  for (const field of ['agents', 'contacts', 'contactsExplicit', 'approvedTemplates']) {
    const bad = Object.entries(expected).filter(([code, want]) => byCode[code]?.[field] !== want[field]);
    check(`reported ${field} matches the database for all seven languages`, bad.length === 0,
      bad.map(([c, w]) => `${c}: want ${w[field]}, got ${byCode[c]?.[field]}`).join('; ') || 'exact match');
  }

  const badAwaiting = Object.entries(expected)
    .filter(([code, want]) => byCode[code]?.awaitingReview !== want.awaitingReview);
  check('reported awaitingReview matches the database for all seven languages',
    badAwaiting.length === 0,
    badAwaiting.map(([c, w]) => `${c}: want ${w.awaitingReview}, got ${byCode[c]?.awaitingReview}`).join('; ') || 'exact match');

  const shown = await page.locator('body').innerText();
  const en = expected.en;
  check('the card renders the contact figure on screen', shown.includes(String(en.contacts)),
    `looking for ${en.contacts}`);
  await page.screenshot({ path: `${SHOTS}/language-usage-card.png`, fullPage: true });
} catch (err) {
  check('suite ran without throwing', false, err.message.split('\n')[0]);
  await page.screenshot({ path: `${SHOTS}/error-template-languages.png`, fullPage: true }).catch(() => {});
} finally {
  await resetLocale();
  await browser.close();
}

process.exit(summary() ? 0 : 1);
