// ============================================================
// The agent's own UI language: picking it, the two-language cap, the
// header toggle, and that the choice survives a reload.
//
// Every case asserts twice — what the screen renders, and what landed
// in profiles.ui_languages / .active_ui_language. The profile is the
// truth the mobile app reads, so a switch that repaints the sidebar
// but never persists would look correct here and be broken on a phone.
// ============================================================

import { readFileSync } from 'node:fs';

import { launch, login, openSettings, SHOTS } from './support/browser.mjs';
import { readLocale, resetLocale } from './support/db.mjs';
import { check, summary } from './support/assert.mjs';

const CATALOG = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'));

const DISPLAY = {
  en: 'English', hi: 'हिन्दी (Hindi)', kn: 'ಕನ್ನಡ (Kannada)', ta: 'தமிழ் (Tamil)',
  te: 'తెలుగు (Telugu)', ml: 'മലയാളം (Malayalam)', mr: 'मराठी (Marathi)',
};
const NATIVE = {
  en: 'English', hi: 'हिन्दी', kn: 'ಕನ್ನಡ', ta: 'தமிழ்',
  te: 'తెలుగు', ml: 'മലയാളം', mr: 'मराठी',
};
const TRANSLATED = ['hi', 'kn', 'ta', 'te', 'ml', 'mr'];

const { browser, page } = await launch();

// The card's accessible name picks up the "active" chip, so it is
// matched on the label span instead of the whole button.
const card = (code) =>
  page.locator('button', { has: page.locator(`span:text-is(${JSON.stringify(DISPLAY[code])})`) }).first();
const toggle = () => page.getByRole('group', { name: 'Display language' });
const sidebar = () => page.locator('nav, aside').first();

async function appearance() {
  await openSettings(page, 'Appearance');
}

try {
  await resetLocale();
  await login(page);

  check('header toggle stays hidden for a single-language agent',
    !(await toggle().isVisible().catch(() => false)));

  await appearance();
  await page.screenshot({ path: `${SHOTS}/appearance-panel.png`, fullPage: true });

  const missing = [];
  for (const code of Object.keys(DISPLAY)) {
    if (!(await card(code).isVisible().catch(() => false))) missing.push(code);
  }
  check('all seven languages offered, endonym first', missing.length === 0,
    missing.length ? `missing ${missing}` : Object.values(DISPLAY).join(', '));

  await card('en').click();
  await page.waitForTimeout(800);
  let state = await readLocale();
  check('the last remaining language cannot be deselected',
    state.ui_languages?.length === 1 && state.ui_languages[0] === 'en', JSON.stringify(state));

  for (const code of TRANSLATED) {
    await resetLocale();
    await appearance();

    await card(code).click();
    await page.waitForTimeout(1000);
    state = await readLocale();
    check(`${code}: picking it adds it to the declared set`,
      state.ui_languages?.includes(code) && state.ui_languages.length === 2,
      JSON.stringify(state.ui_languages));

    check(`${code}: header toggle appears at two languages`,
      await toggle().isVisible().catch(() => false));

    await toggle().getByText(NATIVE[code], { exact: true }).first().click();
    await page.waitForTimeout(1200);
    state = await readLocale();
    check(`${code}: the active choice persists to the profile`,
      state.active_ui_language === code, `active=${state.active_ui_language}`);

    const expected = CATALOG[code]['nav.dashboard'];
    check(`${code}: chrome renders in ${code}`,
      (await sidebar().innerText()).includes(expected), `expected "${expected}"`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav a, aside a', { timeout: 30000 });
    await page.waitForTimeout(1500);
    check(`${code}: survives a reload`,
      (await sidebar().innerText()).includes(expected), `expected "${expected}"`);
    await page.screenshot({ path: `${SHOTS}/language-${code}.png` });
  }

  // The cap: a third pick swaps out the language you are NOT reading.
  await resetLocale();
  await appearance();
  await card('hi').click();
  await page.waitForTimeout(900);
  await toggle().getByText(NATIVE.hi, { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await card('ta').click();
  await page.waitForTimeout(1200);

  const capped = await readLocale();
  check('the cap holds at two when a third language is picked',
    capped.ui_languages?.length === 2, JSON.stringify(capped.ui_languages));
  check('the third pick replaces the inactive language and keeps the one being read',
    capped.ui_languages?.[0] === 'hi' && capped.ui_languages?.[1] === 'ta' &&
    capped.active_ui_language === 'hi', JSON.stringify(capped));
  await page.screenshot({ path: `${SHOTS}/language-cap.png`, fullPage: true });
} catch (err) {
  check('suite ran without throwing', false, err.message.split('\n')[0]);
  await page.screenshot({ path: `${SHOTS}/error-language-switcher.png`, fullPage: true }).catch(() => {});
} finally {
  await resetLocale();
  await browser.close();
}

process.exit(summary() ? 0 : 1);
