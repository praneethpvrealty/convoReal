import { launch, login, BASE } from './support/browser.mjs';
import { check } from './support/assert.mjs';

const { browser, page } = await launch();

try {
  await login(page);

  await page.goto(`${BASE}/contacts`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Sandeep Kotecha', { exact: true }).first().click();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  const note = `UI regression ${Date.now()}`;
  await page.getByTestId('contact-note-input').fill(note);
  await page.getByTestId('contact-note-submit').click();
  await page.getByText(note, { exact: true }).waitFor();

  await page.goto(`${BASE}/dev/chatbot-simulator`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('button', { name: 'Buyer matches', exact: true })
    .click();
  await page.getByPlaceholder('e.g. +91 98765 43210').fill('+919000000011');
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await page.getByText(/Palm Grove.*no longer available/s).waitFor();
  const followUpBody = await page.locator('body').innerText();
  check('the requirement is retained for follow-up', /no longer available/i.test(followUpBody) && /(Reply STOP ALERTS|pause these|closest to what you['’]re looking for|one new listing matches|see them all and shortlist what you like)/i.test(followUpBody),
    followUpBody.split('\n').find((line) => line.trim().length > 0)?.trim() || 'no visible body text');

  console.log('contact follow-up UI regressions passed');
} finally {
  await browser.close();
}
