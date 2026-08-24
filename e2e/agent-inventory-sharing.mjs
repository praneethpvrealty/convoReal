import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { launch, login, BASE } from './support/browser.mjs';
import { check } from './support/assert.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('Supabase URL, anon key and service role key are required.');
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const password = `E2E-${randomBytes(18).toString('base64url')}`;
const created = { users: [], accounts: [], invites: [] };

function must(name, pass, detail = '') {
  if (!check(name, pass, detail)) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function createAgent(label, phoneSuffix) {
  const email = `inventory-${label.toLowerCase()}-${stamp}@convoreal-test.invalid`;
  const phone = `+9199${phoneSuffix}${String(Date.now()).slice(-6)}`;
  const invite = `e2e-inventory-${label.toLowerCase()}-${randomBytes(8).toString('base64url')}`;
  const { data: tokenHash, error: hashError } = await admin.rpc('hash_beta_token', {
    p_token: invite,
  });
  if (hashError) throw hashError;
  const { error: inviteError } = await admin.from('beta_invites').insert({
    code: invite,
    token_hash: tokenHash,
    label: `Inventory sharing E2E ${label}`,
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  });
  if (inviteError) throw inviteError;
  created.invites.push(invite);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone,
    phone_confirm: true,
    user_metadata: { beta_invite: invite, full_name: `Inventory Agent ${label}` },
  });
  if (error) throw error;
  const userId = data.user.id;
  created.users.push(userId);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .single();
  if (profileError || !profile?.account_id) {
    throw profileError ?? new Error(`Agent ${label} account was not bootstrapped.`);
  }
  created.accounts.push(profile.account_id);
  return { label, email, phone, password, userId, accountId: profile.account_id };
}

async function authenticatedRequest(agent, method, path, data) {
  process.env.E2E_EMAIL = agent.email;
  process.env.E2E_PASSWORD = agent.password;
  process.env.E2E_ACCOUNT_ID = agent.accountId;
  const { browser, page } = await launch();
  try {
    await login(page);
    const response = await page.request.fetch(`${BASE}${path}`, {
      method,
      data,
      failOnStatusCode: false,
    });
    return { status: response.status(), body: await response.json() };
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  if (created.accounts.length) {
    await admin.from('properties').delete().in('account_id', created.accounts);
    await admin.from('contacts').delete().in('account_id', created.accounts);
  }
  for (const userId of created.users) {
    await admin.auth.admin.deleteUser(userId);
  }
  if (created.accounts.length) {
    await admin.from('accounts').delete().in('id', created.accounts);
  }
  if (created.invites.length) {
    await admin.from('beta_invites').delete().in('code', created.invites);
  }
}

try {
  const [agentA, agentB] = await Promise.all([
    createAgent('A', '10'),
    createAgent('B', '20'),
  ]);

  const { data: bContact, error: bContactError } = await admin
    .from('contacts')
    .insert({
      account_id: agentA.accountId,
      user_id: agentA.userId,
      name: 'Inventory Agent B',
      phone: agentB.phone,
      classification: 'Agent',
      status: 'active',
    })
    .select('id')
    .single();
  if (bContactError) throw bContactError;

  const { data: sources, error: sourceError } = await admin
    .from('properties')
    .insert([
      {
        account_id: agentA.accountId,
        user_id: agentA.userId,
        title: `Agent B source inventory ${stamp}`,
        description: 'E2E source-agent inventory',
        location: 'HSR Layout, Bengaluru',
        city: 'Bengaluru',
        state: 'Karnataka',
        listing_type: 'Sale',
        type: 'Flat/ Apartment',
        price: 12500000,
        status: 'Available',
        is_published: true,
        listing_source: 'agent',
        owner_contact_id: bContact.id,
      },
      {
        account_id: agentA.accountId,
        user_id: agentA.userId,
        title: `Direct agent share ${stamp}`,
        description: 'E2E direct inventory share',
        location: 'Indiranagar, Bengaluru',
        city: 'Bengaluru',
        state: 'Karnataka',
        listing_type: 'Sale',
        type: 'Commercial Office',
        price: 27500000,
        status: 'Available',
        is_published: true,
        listing_source: 'owner',
      },
    ])
    .select('id, title');
  if (sourceError) throw sourceError;
  const autoSource = sources.find((row) => row.title.startsWith('Agent B source'));
  const directSource = sources.find((row) => row.title.startsWith('Direct agent share'));
  if (!autoSource || !directSource) throw new Error('Source fixtures were not created.');

  const firstSync = await authenticatedRequest(
    agentB,
    'POST',
    '/api/agents/inventory-sync',
  );
  must('source inventory sync succeeds', firstSync.status === 200, JSON.stringify(firstSync));
  must('source inventory imports once', firstSync.body?.data?.imported === 1, JSON.stringify(firstSync.body));

  const { data: autoCopy } = await admin
    .from('properties')
    .select('id, account_id, source_property_id, status, is_published, listing_source')
    .eq('account_id', agentB.accountId)
    .eq('source_property_id', autoSource.id)
    .single();
  must(
    'source inventory is loaded into Agent B account',
    autoCopy?.status === 'Available' && autoCopy?.is_published === false && autoCopy?.listing_source === 'agent',
    JSON.stringify(autoCopy),
  );

  const secondSync = await authenticatedRequest(
    agentB,
    'POST',
    '/api/agents/inventory-sync',
  );
  must('repeat source sync is idempotent', secondSync.body?.data?.imported === 0, JSON.stringify(secondSync.body));

  const shared = await authenticatedRequest(
    agentA,
    'POST',
    `/api/properties/${directSource.id}/share-to-agent-account`,
    { contact_id: bContact.id },
  );
  must('direct inventory share is accepted', shared.status === 201, JSON.stringify(shared));
  must('direct share enters review', shared.body?.data?.status === 'Pending Review', JSON.stringify(shared.body));

  const pendingId = shared.body.data.id;
  const { data: pending } = await admin
    .from('properties')
    .select('account_id, source_property_id, status, is_published, owner_contact_id')
    .eq('id', pendingId)
    .single();
  must(
    'pending copy keeps account, lineage and source attribution',
    pending?.account_id === agentB.accountId &&
      pending?.source_property_id === directSource.id &&
      pending?.status === 'Pending Review' &&
      pending?.is_published === false &&
      Boolean(pending?.owner_contact_id),
    JSON.stringify(pending),
  );

  const duplicate = await authenticatedRequest(
    agentA,
    'POST',
    `/api/properties/${directSource.id}/share-to-agent-account`,
    { contact_id: bContact.id },
  );
  must('duplicate direct share is rejected', duplicate.status === 409, JSON.stringify(duplicate));

  // Avoid sending a real WhatsApp notification from this production-shaped
  // test. Attribution was asserted above; approval only needs the contact id.
  await admin.from('contacts').update({ phone: null }).eq('id', pending.owner_contact_id);
  const approved = await authenticatedRequest(
    agentB,
    'POST',
    `/api/properties/${pendingId}/approve`,
  );
  must('recipient can approve the shared listing', approved.status === 200, JSON.stringify(approved));

  const { data: liveCopy } = await admin
    .from('properties')
    .select('status, is_published, source_property_id')
    .eq('id', pendingId)
    .single();
  must(
    'approval adds the listing to recipient inventory',
    liveCopy?.status === 'Available' && liveCopy?.is_published === true && liveCopy?.source_property_id === directSource.id,
    JSON.stringify(liveCopy),
  );

  console.log('agent inventory sharing E2E passed');
} finally {
  await cleanup();
}
