import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const baseUrl = required('E2E_BASE_URL').replace(/\/$/, '');
const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const smokeEmail = process.env.AI_SMOKE_EMAIL ?? 'daily-ai-smoke@convoreal.test';
const smokePhone = process.env.AI_SMOKE_PHONE ?? '+919000000099';
const evidenceDir = process.env.AI_SMOKE_ARTIFACT_DIR ?? 'test-results/ai-billing-smoke';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function randomPassword() {
  return `Smoke-${randomBytes(24).toString('base64url')}`;
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list smoke users: ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Smoke user was not found after paging through Auth users');
}

async function createSmokeUser(password) {
  const invite = `daily-ai-smoke-${randomBytes(18).toString('base64url')}`;
  const { data: hash, error: hashError } = await admin.rpc('hash_beta_token', { p_token: invite });
  if (hashError || !hash) throw new Error(`Could not create smoke invite: ${hashError?.message ?? 'empty hash'}`);

  const { error: inviteError } = await admin.from('beta_invites').insert({
    code: invite,
    token_hash: hash,
    label: 'Daily production AI billing smoke',
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (inviteError) throw new Error(`Could not insert smoke invite: ${inviteError.message}`);

  const { data, error } = await admin.auth.admin.createUser({
    email: smokeEmail,
    password,
    email_confirm: true,
    phone: smokePhone,
    phone_confirm: true,
    user_metadata: {
      beta_invite: invite,
      full_name: 'Daily AI Billing Smoke',
    },
  });
  if (error || !data.user) throw new Error(`Could not create smoke user: ${error?.message ?? 'no user returned'}`);
  return data.user;
}

async function ensureSmokeContext() {
  const password = randomPassword();
  let user = await findUserByEmail(smokeEmail);
  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      password,
    });
    if (error || !data.user) throw new Error(`Could not rotate smoke password: ${error?.message ?? 'no user returned'}`);
    user = data.user;
  } else {
    user = await createSmokeUser(password);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError || !profile?.account_id) {
    throw new Error(`Smoke user has no account profile: ${profileError?.message ?? 'missing account_id'}`);
  }

  const accountId = profile.account_id;
  const now = new Date();
  const { error: subscriptionError } = await admin.from('subscriptions').upsert({
    account_id: accountId,
    plan: 'solo_pro',
    status: 'active',
    billing_cycle: 'monthly',
    current_period_start: now.toISOString(),
    current_period_end: new Date(now.getTime() + 32 * 86_400_000).toISOString(),
    billing_currency: 'INR',
    billing_gateway: 'razorpay',
  }, { onConflict: 'account_id' });
  if (subscriptionError) throw new Error(`Could not configure smoke subscription: ${subscriptionError.message}`);

  return { accountId, password };
}

async function resetWallet(accountId, credits) {
  const { error: clearLedgerError } = await admin
    .from('credit_transactions')
    .delete()
    .eq('account_id', accountId);
  if (clearLedgerError) throw new Error(`Could not clear smoke ledger: ${clearLedgerError.message}`);

  const { error: walletError } = await admin
    .from('credit_wallets')
    .update({
      monthly_credits: credits,
      bonus_credits: 0,
      referral_credits: 0,
      purchased_credits: 0,
      promo_credits: 0,
      pending_referral_credits: 0,
      total_credits: credits,
    })
    .eq('account_id', accountId);
  if (walletError) throw new Error(`Could not reset smoke wallet: ${walletError.message}`);
}

async function wallet(accountId) {
  const { data, error } = await admin
    .from('credit_wallets')
    .select('total_credits')
    .eq('account_id', accountId)
    .single();
  if (error || !data) throw new Error(`Could not read smoke wallet: ${error?.message ?? 'no wallet'}`);
  return data.total_credits;
}

async function ledger(accountId) {
  const { data, error } = await admin
    .from('credit_transactions')
    .select('type, amount, ai_feature, description, balance_after')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read smoke ledger: ${error.message}`);
  return data ?? [];
}

async function login(password) {
  const chromiumBrowser = await chromium.launch({ headless: true });
  const context = await chromiumBrowser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill(smokeEmail);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });
  return { chromiumBrowser, page };
}

async function post(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, body });
}

async function verifyRefundRpc(accountId) {
  const before = await wallet(accountId);
  const { data: burned, error: burnError } = await admin.rpc('burn_credits_tx', {
    p_account_id: accountId,
    p_feature: 'event_parse',
    p_cost: 3,
    p_hard_block: true,
  });
  if (burnError || !(Array.isArray(burned) ? burned[0] : burned)?.success) {
    throw new Error(`Refund probe burn failed: ${burnError?.message ?? 'not successful'}`);
  }
  const { data: refunded, error: refundError } = await admin.rpc('refund_credits_tx', {
    p_account_id: accountId,
    p_feature: 'event_parse',
    p_cost: 3,
    p_description: 'daily production AI billing smoke refund probe',
  });
  if (refundError || !(Array.isArray(refunded) ? refunded[0] : refunded)) {
    throw new Error(`Refund probe failed: ${refundError?.message ?? 'no response'}`);
  }
  expect(await wallet(accountId) === before, 'Refund probe did not restore the starting balance');
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  const checks = [];
  const record = (name, detail) => {
    checks.push({ name, pass: true, detail });
    console.log(`PASS  ${name} — ${detail}`);
  };

  let browser;
  try {
    const { accountId, password } = await ensureSmokeContext();
    await resetWallet(accountId, 16);
    browser = await login(password);

    const description = await post(browser.page, '/api/ai/generate-description', {
      title: 'Daily smoke-test apartment in Koramangala',
      type: 'Apartment',
      location: 'Koramangala, Bengaluru',
      bedrooms: 2,
      area: 1200,
      areaUnit: 'Sq.Ft.',
      features: ['Test-only request'],
    });
    expect(description.status === 200 && typeof description.body?.description === 'string', `Description failed: ${JSON.stringify(description)}`);
    expect(await wallet(accountId) === 6, `Description should burn 10 credits; balance is ${await wallet(accountId)}`);
    record('description burn', '200 response and exactly 10 credits burned');

    const event = await post(browser.page, '/api/ai/parse-event', {
      text: 'Schedule a smoke-test site visit tomorrow at 11 AM.',
    });
    expect(event.status === 200 && event.body?.data?.draft, `Event parsing failed: ${JSON.stringify(event)}`);
    expect(await wallet(accountId) === 3, `Event parsing should burn 3 credits; balance is ${await wallet(accountId)}`);
    record('event-parse burn', '200 response and exactly 3 credits burned');

    await verifyRefundRpc(accountId);
    record('refund RPC', 'burn/refund pair returned wallet to the starting balance');

    await resetWallet(accountId, 0);
    const insufficient = await post(browser.page, '/api/ai/generate-description', {
      title: 'Insufficient-credit smoke-test apartment',
      type: 'Apartment',
    });
    expect(
      insufficient.status === 402 && /Insufficient credits/i.test(insufficient.body?.error ?? ''),
      `Insufficient-credit response was not user-facing: ${JSON.stringify(insufficient)}`,
    );
    expect(await wallet(accountId) === 0, 'Insufficient-credit request changed the wallet');
    record('insufficient-credit error', '402 response exposes a retry-safe user error and burns nothing');

    const tx = await ledger(accountId);
    expect(tx.length === 0, 'The zero-credit test should not write a ledger row after reset');
    await browser.page.screenshot({ path: `${evidenceDir}/logged-in.png`, fullPage: true });
  } catch (error) {
    checks.push({ name: 'smoke run', pass: false, detail: error instanceof Error ? error.message : String(error) });
    console.error(error);
  } finally {
    if (browser) await browser.chromiumBrowser.close();
    writeFileSync(`${evidenceDir}/summary.json`, `${JSON.stringify({ checks, at: new Date().toISOString() }, null, 2)}\n`);
  }

  if (checks.some((check) => !check.pass)) process.exit(1);
}

main();
