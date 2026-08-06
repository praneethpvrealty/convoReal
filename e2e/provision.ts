import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const EMAIL = 'claude-e2e-harness@convoreal.com';
const PHONE = '+919000000001';
const PASSWORD = `Test-${randomBytes(12).toString('base64url')}`;
const INVITE = `e2e-${randomBytes(9).toString('base64url')}`;

async function main() {
  // Clean any prior run so this is repeatable.
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const prior = existing?.users.find((u) => u.email === EMAIL);
  if (prior) {
    console.log('removing prior test user', prior.id);
    await admin.auth.admin.deleteUser(prior.id);
  }
  await admin.from('beta_invites').delete().like('code', 'e2e-%');

  // Mint a real invite rather than bypassing the gate — the signup
  // trigger is what builds profile + account, and we want its output.
  const { error: invErr } = await admin.rpc('hash_beta_token', { p_token: INVITE });
  if (invErr) throw invErr;
  const { data: hashed } = await admin.rpc('hash_beta_token', { p_token: INVITE });
  const { error: insErr } = await admin.from('beta_invites').insert({
    code: INVITE,
    token_hash: hashed,
    label: 'Claude E2E harness',
    expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
  });
  if (insErr) throw insErr;
  console.log('invite minted');

  // createUser fires the same handle_new_user trigger an ordinary signup
  // does, so the invite gate is genuinely exercised — but it sends no
  // confirmation mail to a mailbox that does not exist.
  // The dashboard shell bounces anyone without a confirmed phone to
  // /verify-phone, which is a WhatsApp OTP round trip no test can make.
  // Confirming it here is what puts the harness inside the app at all.
  const { data: created, error: suErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    phone: PHONE,
    phone_confirm: true,
    user_metadata: { beta_invite: INVITE, full_name: 'Claude E2E' },
  });
  if (suErr) throw suErr;
  const userId = created.user!.id;
  if (!created.user!.phone_confirmed_at) {
    throw new Error('phone did not confirm; the shell will redirect to /verify-phone');
  }
  console.log('created', userId);

  // profiles.id is its own key; the auth user is in profiles.user_id.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, user_id, account_id, full_name, account_role, org_role')
    .eq('user_id', userId)
    .maybeSingle();
  console.log('profile:', JSON.stringify(profile));
  if (!profile?.account_id) throw new Error('trigger did not bootstrap an account');

  const { data: account } = await admin
    .from('accounts').select('id, name').eq('id', profile.account_id).maybeSingle();
  console.log('account:', JSON.stringify(account));

  // Prove the credentials actually log in, rather than assuming.
  const { error: loginErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (loginErr) throw new Error(`login check failed: ${loginErr.message}`);
  console.log('login verified');

  await seedInventory(profile.account_id);

  writeFileSync(
    '.env.e2e.local',
    `# Throwaway account for the Playwright harness. Gitignored.\nE2E_EMAIL=${EMAIL}\nE2E_PASSWORD=${PASSWORD}\nE2E_ACCOUNT_ID=${profile.account_id}\nE2E_USER_ID=${userId}\n`,
  );
  console.log('\ncredentials written to .env.e2e.local');
}
async function seedInventory(accountId: string) {
  const rows = [
    { title: '3 BHK Apartment in Koramangala 5th Block', type: 'Flat/ Apartment', price: 18_000_000, sublocality: 'Koramangala', bedrooms: 3, area_sqft: 1650 },
    { title: '2400 Sq.Ft. Residential Plot in HSR Layout', type: 'Residential Land/ Plot', price: 19_500_000, sublocality: 'HSR Layout', land_area: 2400 },
    { title: 'Commercial Shop on BTM 100ft Road', type: 'Commercial Shop', price: 32_000_000, sublocality: 'BTM Layout', area_sqft: 900 },
    { title: 'Farm Land near Devanahalli', type: 'Agricultural Land', price: 16_500_000, sublocality: 'Devanahalli', land_area: 43560 },
  ];
  const { error } = await admin.from('properties').insert(
    rows.map((r) => ({
      account_id: accountId,
      city: 'Bangalore',
      state: 'Karnataka',
      location: `${r.sublocality}, Bangalore, Karnataka`,
      status: 'Available',
      listing_type: 'Sale',
      is_published: true,
      description: 'Seeded by the Claude E2E harness.',
      ...r,
    })),
  );
  if (error) throw error;
  console.log(`seeded ${rows.length} listings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
