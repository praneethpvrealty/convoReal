/* eslint-disable @typescript-eslint/no-require-imports */
// Admin credit top-up — grants credits to an account's bonus bucket
// via the admin_grant_credits_tx RPC (migration 096), with a proper
// admin_grant ledger row.
//
// Usage:
//   node scripts/grant-credits.js <email-or-account-uuid> <amount> [description]
//   node scripts/grant-credits.js praneethpvrealty@gmail.com 100 "testing top-up"
//
// If the email belongs to profiles on several accounts, the script
// lists them — rerun with the account UUID instead of the email.
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const [target, amountArg, ...descParts] = process.argv.slice(2);
const amount = Number(amountArg);

if (!target || !Number.isInteger(amount) || amount <= 0) {
  console.error('Usage: node scripts/grant-credits.js <email-or-account-uuid> <positive-integer-amount> [description]');
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function generateReferralCode(seed) {
  const clean = seed.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return (clean + 'XXXX').slice(0, 4) + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// Mirrors src/lib/credits/wallet.ts getOrCreateWallet — the RPC
// requires the wallet row to exist.
async function ensureWallet(accountId) {
  const { data: existing, error: fetchErr } = await supabase
    .from('credit_wallets')
    .select('total_credits, bonus_credits')
    .eq('account_id', accountId)
    .maybeSingle();
  if (fetchErr) throw new Error(`wallet fetch failed: ${fetchErr.message}`);
  if (existing) return existing;

  const { error: insertErr } = await supabase
    .from('credit_wallets')
    .upsert(
      { account_id: accountId, referral_code: generateReferralCode(accountId) },
      { onConflict: 'account_id', ignoreDuplicates: true },
    );
  if (insertErr) throw new Error(`wallet create failed: ${insertErr.message}`);

  const { data: created, error: reselectErr } = await supabase
    .from('credit_wallets')
    .select('total_credits, bonus_credits')
    .eq('account_id', accountId)
    .single();
  if (reselectErr || !created) throw new Error(`wallet reselect failed: ${reselectErr?.message ?? 'no row'}`);
  return created;
}

// Fallback for environments where migration 096 hasn't been applied
// yet: same grant done in two PostgREST calls (not atomic — the RPC
// is preferred). Guards against concurrent burns with an
// updated_at precondition and retries.
async function grantWithoutRpc(accountId, description) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: w, error: wErr } = await supabase
      .from('credit_wallets')
      .select('bonus_credits, total_credits, updated_at')
      .eq('account_id', accountId)
      .single();
    if (wErr) throw new Error(`wallet fetch failed: ${wErr.message}`);

    const newTotal = w.total_credits + amount;
    const { data: updated, error: updErr } = await supabase
      .from('credit_wallets')
      .update({
        bonus_credits: w.bonus_credits + amount,
        total_credits: newTotal,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('updated_at', w.updated_at)
      .select();
    if (updErr) throw new Error(`wallet update failed: ${updErr.message}`);
    if (!updated || updated.length === 0) continue; // concurrent write — retry

    const { error: txErr } = await supabase.from('credit_transactions').insert({
      account_id: accountId,
      type: 'admin_grant',
      bucket: 'bonus',
      amount,
      balance_after: newTotal,
      description,
    });
    if (txErr) throw new Error(`ledger insert failed (wallet WAS updated): ${txErr.message}`);
    return newTotal;
  }
  throw new Error('wallet kept changing concurrently — rerun the script');
}

async function resolveProfile() {
  const query = supabase
    .from('profiles')
    .select('account_id, full_name, email, account_role');

  const { data: profiles, error: profErr } = UUID_RE.test(target)
    ? await query.eq('account_id', target)
    : await query.eq('email', target);
  if (profErr) throw new Error(`profile lookup failed: ${profErr.message}`);
  if (!profiles || profiles.length === 0) throw new Error(`no profile found for ${target}`);

  // Same email can sit on several accounts (owner of one, invited
  // member of another) — a grant must target exactly one account.
  const accountIds = [...new Set(profiles.map((p) => p.account_id))];
  if (accountIds.length > 1) {
    console.error(`${target} belongs to ${accountIds.length} accounts — rerun with the account UUID:`);
    for (const p of profiles) {
      console.error(`  ${p.account_id}  (${p.account_role}: ${p.full_name})`);
    }
    process.exit(1);
  }
  return profiles[0];
}

(async () => {
  const profile = await resolveProfile();

  const wallet = await ensureWallet(profile.account_id);
  console.log(`Account: ${profile.full_name} <${profile.email}> (${profile.account_role}) — ${profile.account_id}`);
  console.log(`Balance before: ${wallet.total_credits} cr (bonus: ${wallet.bonus_credits})`);

  const description = descParts.join(' ') || `Admin grant of ${amount} cr via scripts/grant-credits.js`;
  const { data, error } = await supabase.rpc('admin_grant_credits_tx', {
    p_account_id: profile.account_id,
    p_amount: amount,
    p_description: description,
  });

  let balanceAfter;
  if (error) {
    // PGRST202 = function not found — migration 096 not applied yet.
    if (error.code === 'PGRST202' || /admin_grant_credits_tx/.test(error.message)) {
      console.warn('admin_grant_credits_tx RPC not deployed — falling back to direct update.');
      console.warn('Apply supabase/migrations/096_admin_grant_credits.sql for atomic grants.');
      balanceAfter = await grantWithoutRpc(profile.account_id, description);
    } else {
      throw new Error(`admin_grant_credits_tx failed: ${error.message}`);
    }
  } else {
    const row = Array.isArray(data) ? data[0] : data;
    balanceAfter = row?.balance_after;
  }

  console.log(`Granted ${amount} cr. Balance after: ${balanceAfter} cr`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
