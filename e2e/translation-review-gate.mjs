// ============================================================
// The gate between machine-written translated copy and Meta.
//
// Driven through the UI where the UI can do it, and through the API
// where it cannot: the manager only renders "Submit to Meta" once a
// translation is signed off, so the refusal itself is only reachable
// by calling the route directly — which is exactly the door the gate
// exists to hold, since scripts come through it too.
//
// Every row this creates is deleted in the finally block, and the
// account's template count is asserted back to its starting value.
// WHATSAPP_TEMPLATES_DRY_RUN=true must be set: the last case submits
// a reviewed template, and nothing here should reach Meta.
// ============================================================

import { launch, login, openTemplates, SHOTS } from './support/browser.mjs';
import {
  db, deleteTemplates, resetLocale, templateCount, templatesInLanguage,
} from './support/db.mjs';
import { check, summary } from './support/assert.mjs';

const LANGUAGE = 'kn';
const UNDRAFTED = 'location_reveal';

const { browser, page } = await launch();
let drafted = null;

const post = (url, payload) =>
  page.evaluate(async ({ url, payload }) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { url, payload });

const payloadFor = (name) => ({
  name,
  language: LANGUAGE,
  category: 'Utility',
  body_text: 'ಈ ಆಸ್ತಿಯ ಬಗ್ಗೆ ಹೆಚ್ಚಿನ ಮಾಹಿತಿ ಬೇಕೇ ಎಂದು ತಿಳಿಸಿ.',
});

try {
  await resetLocale();
  const startingCount = await templateCount();
  check('starting from no templates in the test language',
    (await templatesInLanguage(LANGUAGE)).length === 0, `account holds ${startingCount}`);

  await login(page);
  await openTemplates(page);
  await page.getByRole('tablist', { name: 'Template language' }).getByRole('tab').nth(2).click();
  await page.waitForTimeout(2000);

  let body = await page.locator('body').innerText();
  const missingMatch = body.match(/(\d+)\s+templates?\s+the Engine sends are missing in/i);
  const missingCount = Number(missingMatch?.[1] ?? 0);
  check('the language names every engine template it is missing',
    missingCount > 0,
    (body.match(/\d+\s+templates?\s+the Engine sends are missing in [^\n]*/) || ['?'])[0]);

  const draftCount = await page.getByRole('button', { name: 'Create draft' }).count();
  const oneTapCount = await page.getByRole('button', { name: 'Create & submit' }).count();
  check('a translation offers "Create draft", never a one-tap submit',
    draftCount === missingCount && oneTapCount === 0,
    `draftCount=${draftCount}, create&submit=${oneTapCount}, missing=${missingCount}`);

  const noDraft = await post('/api/whatsapp/templates/submit', payloadFor(UNDRAFTED));
  check('submitting a translation that was never drafted is refused',
    noDraft.status === 409 && noDraft.body?.code === 'TRANSLATION_DRAFT_REQUIRED',
    `${noDraft.status} ${noDraft.body?.code ?? ''}`);

  await page.getByRole('button', { name: 'Create draft' }).first().click();
  await page.waitForTimeout(3500);
  drafted = (await templatesInLanguage(LANGUAGE))[0];
  check('"Create draft" writes an unreviewed local draft',
    drafted?.status === 'DRAFT' && drafted?.translation_reviewed_at === null,
    drafted ? `${drafted.name} status=${drafted.status}` : 'no row written');
  check('the draft never reached Meta', drafted?.meta_template_id == null,
    String(drafted?.meta_template_id));

  body = await page.locator('body').innerText();
  check('the draft is shown as awaiting review', /Awaiting review/.test(body));
  check('no submit control is offered while it is unreviewed',
    (await page.getByRole('button', { name: 'Submit to Meta' }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/review-awaiting.png`, fullPage: true });

  const unreviewed = await post('/api/whatsapp/templates/submit', payloadFor(drafted.name));
  check('submitting an unreviewed draft is refused',
    unreviewed.status === 409 && unreviewed.body?.code === 'TRANSLATION_REVIEW_REQUIRED',
    `${unreviewed.status} ${unreviewed.body?.code ?? ''}`);

  const untouched = (await templatesInLanguage(LANGUAGE)).find((r) => r.id === drafted.id);
  check('the refused submit left the row exactly as it was',
    untouched?.status === 'DRAFT' && untouched?.meta_template_id == null);

  await page.getByRole('button', { name: 'Mark reviewed' }).first().click();
  await page.waitForTimeout(2500);
  const signedOff = (await templatesInLanguage(LANGUAGE)).find((r) => r.id === drafted.id);
  check('"Mark reviewed" records the sign-off', Boolean(signedOff?.translation_reviewed_at),
    String(signedOff?.translation_reviewed_at));
  check('the submit control appears only after sign-off',
    (await page.getByRole('button', { name: 'Submit to Meta' }).count()) > 0);
  await page.screenshot({ path: `${SHOTS}/review-signed-off.png`, fullPage: true });

  const allowed = await post('/api/whatsapp/templates/submit', payloadFor(drafted.name));
  check('a reviewed translation is let through', allowed.status === 200 && allowed.body?.success === true,
    `${allowed.status}`);
  check('and it was a dry run — nothing was sent to Meta', allowed.body?.dry_run === true,
    'set WHATSAPP_TEMPLATES_DRY_RUN=true');

  // Migration 248: rewording signed-off copy must withdraw the
  // sign-off, or a reviewer's approval would cover text they never read.
  const current = (await templatesInLanguage(LANGUAGE)).find((r) => r.id === drafted.id);
  await db
    .from('message_templates')
    .update({ body_text: `${current.body_text} ಬದಲಾವಣೆ` })
    .eq('id', current.id);
  const reworded = (await templatesInLanguage(LANGUAGE)).find((r) => r.id === drafted.id);
  check('editing the wording withdraws the sign-off automatically',
    reworded?.translation_reviewed_at === null, `reviewed=${reworded?.translation_reviewed_at}`);
} catch (err) {
  check('suite ran without throwing', false, err.message.split('\n')[0]);
  await page.screenshot({ path: `${SHOTS}/error-review-gate.png`, fullPage: true }).catch(() => {});
} finally {
  const leftover = await templatesInLanguage(LANGUAGE);
  await deleteTemplates(leftover.map((r) => r.id));
  check('every row this suite created was removed',
    (await templatesInLanguage(LANGUAGE)).length === 0);
  await resetLocale();
  await browser.close();
}

process.exit(summary() ? 0 : 1);
