import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
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
  const { data: tokenHash, error: hashError } = await admin.rpc(
    'hash_beta_token',
    {
      p_token: invite,
    }
  );
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
    user_metadata: {
      beta_invite: invite,
      full_name: `Inventory Agent ${label}`,
    },
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
    throw (
      profileError ?? new Error(`Agent ${label} account was not bootstrapped.`)
    );
  }
  created.accounts.push(profile.account_id);
  return {
    label,
    email,
    phone,
    password,
    userId,
    accountId: profile.account_id,
  };
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

async function loginAndWaitForSourceCopy(agent, sourcePropertyId) {
  process.env.E2E_EMAIL = agent.email;
  process.env.E2E_PASSWORD = agent.password;
  process.env.E2E_ACCOUNT_ID = agent.accountId;
  const { browser, page } = await launch();
  try {
    await login(page);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { data } = await admin
        .from('properties')
        .select(
          'id, account_id, source_property_id, status, is_published, listing_source'
        )
        .eq('account_id', agent.accountId)
        .eq('source_property_id', sourcePropertyId)
        .maybeSingle();
      if (data) return data;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
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

  const { data: unregisteredContact, error: unregisteredContactError } =
    await admin
      .from('contacts')
      .insert({
        account_id: agentA.accountId,
        user_id: agentA.userId,
        name: 'Inventory Agent C',
        phone: `+9198${String(Date.now()).slice(-8)}`,
        classification: 'Agent',
        status: 'active',
      })
      .select('id')
      .single();
  if (unregisteredContactError) throw unregisteredContactError;

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
        sublocality: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        listing_type: 'Sale',
        type: 'Commercial Office',
        price: 27500000,
        status: 'Available',
        is_published: true,
        listing_source: 'owner',
      },
      {
        account_id: agentA.accountId,
        user_id: agentA.userId,
        title: `Contact inventory share ${stamp}`,
        description: 'E2E contact-level inventory share',
        location: 'Koramangala, Bengaluru',
        sublocality: 'Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        listing_type: 'Sale',
        type: 'Flat/ Apartment',
        price: 18500000,
        status: 'Available',
        is_published: true,
        listing_source: 'owner',
      },
    ])
    .select('id, title');
  if (sourceError) throw sourceError;
  const autoSource = sources.find((row) =>
    row.title.startsWith('Agent B source')
  );
  const directSource = sources.find((row) =>
    row.title.startsWith('Direct agent share')
  );
  const contactShareSource = sources.find((row) =>
    row.title.startsWith('Contact inventory share')
  );
  if (!autoSource || !directSource || !contactShareSource) {
    throw new Error('Source fixtures were not created.');
  }

  const autoCopy = await loginAndWaitForSourceCopy(agentB, autoSource.id);
  must(
    'dashboard login loads source inventory into Agent B account',
    autoCopy?.status === 'Available' &&
      autoCopy?.is_published === false &&
      autoCopy?.listing_source === 'agent',
    JSON.stringify(autoCopy)
  );

  const secondSync = await authenticatedRequest(
    agentB,
    'POST',
    '/api/agents/inventory-sync'
  );
  must(
    'repeat source sync is idempotent',
    secondSync.status === 200 &&
      secondSync.body?.data?.matched === 1 &&
      secondSync.body?.data?.imported === 0,
    JSON.stringify(secondSync)
  );

  const shared = await authenticatedRequest(
    agentA,
    'POST',
    `/api/properties/${directSource.id}/share-to-agent-account`,
    { contact_id: bContact.id }
  );
  must(
    'direct inventory share is accepted',
    shared.status === 201,
    JSON.stringify(shared)
  );
  must(
    'direct share enters review',
    shared.body?.data?.status === 'Pending Review',
    JSON.stringify(shared.body)
  );

  const pendingId = shared.body.data.id;
  const pendingActivity = await authenticatedRequest(
    agentA,
    'GET',
    `/api/properties/${directSource.id}/imports`
  );
  must(
    'source agent sees the recipient awaiting review',
    pendingActivity.status === 200 &&
      pendingActivity.body.data.some(
        (row) =>
          row.id === pendingId &&
          row.status === 'Pending review' &&
          row.agentName === 'Inventory Agent B'
      ),
    JSON.stringify(pendingActivity)
  );
  const { data: pending } = await admin
    .from('properties')
    .select(
      'account_id, source_property_id, status, is_published, owner_contact_id'
    )
    .eq('id', pendingId)
    .single();
  must(
    'pending copy keeps account, lineage and source attribution',
    pending?.account_id === agentB.accountId &&
      pending?.source_property_id === directSource.id &&
      pending?.status === 'Pending Review' &&
      pending?.is_published === false &&
      Boolean(pending?.owner_contact_id),
    JSON.stringify(pending)
  );

  const duplicate = await authenticatedRequest(
    agentA,
    'POST',
    `/api/properties/${directSource.id}/share-to-agent-account`,
    { contact_id: bContact.id }
  );
  must(
    'duplicate direct share is rejected',
    duplicate.status === 409,
    JSON.stringify(duplicate)
  );

  const registeredStatus = await authenticatedRequest(
    agentA,
    'GET',
    `/api/contacts/${bContact.id}/share-inventory`
  );
  must(
    'contact share detects an existing ConvoReal account',
    registeredStatus.status === 200 &&
      registeredStatus.body?.data?.registered === true,
    JSON.stringify(registeredStatus)
  );

  const contactShare = await authenticatedRequest(
    agentA,
    'POST',
    `/api/contacts/${bContact.id}/share-inventory`,
    { property_ids: [contactShareSource.id] }
  );
  must(
    'contact share adds selected properties to the review queue',
    contactShare.status === 200 &&
      contactShare.body?.data?.sharedCount === 1 &&
      contactShare.body?.data?.pending?.[0]?.status === 'Pending Review',
    JSON.stringify(contactShare)
  );

  const unregisteredStatus = await authenticatedRequest(
    agentA,
    'GET',
    `/api/contacts/${unregisteredContact.id}/share-inventory`
  );
  must(
    'contact share offers an invite for an agent without the app',
    unregisteredStatus.status === 200 &&
      unregisteredStatus.body?.data?.registered === false,
    JSON.stringify(unregisteredStatus)
  );

  const appInvite = await authenticatedRequest(
    agentA,
    'POST',
    '/api/beta-invites',
    {
      label: 'Inventory Agent C',
      invitee_phone: `+9198${String(Date.now()).slice(-8)}`,
    }
  );
  must(
    'an account agent can prepare the optional WhatsApp app invite',
    appInvite.status === 200 &&
      typeof appInvite.body?.shareMessage === 'string' &&
      appInvite.body.shareMessage.includes(appInvite.body.url),
    JSON.stringify(appInvite)
  );
  if (appInvite.body?.code) created.invites.push(appInvite.body.code);

  // Avoid sending a real WhatsApp notification from this production-shaped
  // test. Attribution was asserted above; approval only needs the contact id.
  await admin
    .from('contacts')
    .update({ phone: null })
    .eq('id', pending.owner_contact_id);
  const approved = await authenticatedRequest(
    agentB,
    'POST',
    `/api/properties/${pendingId}/approve`
  );
  must(
    'recipient can approve the shared listing',
    approved.status === 200,
    JSON.stringify(approved)
  );

  const { data: liveCopy } = await admin
    .from('properties')
    .select('status, is_published, source_property_id')
    .eq('id', pendingId)
    .single();
  must(
    'approval adds the listing to recipient inventory',
    liveCopy?.status === 'Available' &&
      liveCopy?.is_published === true &&
      liveCopy?.source_property_id === directSource.id,
    JSON.stringify(liveCopy)
  );

  const agentClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  const { data: signedIn, error: signInError } =
    await agentClient.auth.signInWithPassword({
      email: agentA.email,
      password,
    });
  if (signInError) throw signInError;
  const mobileActivityResponse = await fetch(
    `${BASE}/api/properties/${directSource.id}/imports`,
    {
      headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
    }
  );
  const mobileActivity = await mobileActivityResponse.json();
  must(
    'mobile bearer session sees the approved import',
    mobileActivityResponse.ok &&
      mobileActivity.data.some(
        (row) => row.id === pendingId && row.status === 'In inventory'
      )
  );
  const forbiddenResponse = await fetch(
    `${BASE}/api/properties/${pendingId}/imports`,
    {
      headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
    }
  );
  must(
    'source agent cannot inspect a recipient’s private listing activity',
    forbiddenResponse.status === 404
  );
  await agentClient.auth.signOut();

  process.env.E2E_EMAIL = agentA.email;
  process.env.E2E_PASSWORD = agentA.password;
  process.env.E2E_ACCOUNT_ID = agentA.accountId;
  const { browser, page } = await launch();
  try {
    await login(page);
    await page.goto(`${BASE}/inventory`);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page
        .getByRole('button', {
          name: `See who added ${directSource.title} to their inventory`,
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByText('Inventory Agent B', { exact: true })
        .first()
        .waitFor();
      must(
        `inventory import dialog shows accepted agent at ${width}px`,
        await dialog.getByText('In inventory', { exact: true }).isVisible()
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
  } finally {
    await browser.close();
  }

  const showcaseBrowser = await launch();
  try {
    const visitorPage = showcaseBrowser.page;
    const selectedIds = [directSource.id, contactShareSource.id];
    const { error: visibilityError } = await admin
      .from('properties')
      .update({ showcase_visibility: 'open' })
      .eq('account_id', agentA.accountId)
      .in('id', selectedIds);
    if (visibilityError) throw visibilityError;
    const showcaseUrl = `${BASE}/?account_id=${agentA.accountId}&ids=${selectedIds.join(',')}`;
    for (const width of [1280, 320]) {
      await visitorPage.setViewportSize({ width, height: 850 });
      await visitorPage.goto(showcaseUrl, { waitUntil: 'domcontentloaded' });
      const shortlistButtons = visitorPage.getByRole('button', {
        name: /^Shortlist /,
      });
      await shortlistButtons.first().waitFor({ timeout: 60000 });
      await visitorPage.waitForFunction(
        () =>
          document.querySelectorAll('button[aria-label^="Shortlist "]')
            .length === 2
      );
      for (const property of [directSource, contactShareSource]) {
        await visitorPage
          .getByRole('button', {
            name: `Shortlist ${property.title}`,
            exact: true,
          })
          .click();
      }
      await visitorPage.reload({ waitUntil: 'domcontentloaded' });
      const enquire = visitorPage.getByRole('button', {
        name: 'Enquire about selected',
        exact: true,
      });
      await enquire.waitFor({ timeout: 60000 });
      const bounds = await enquire.boundingBox();
      must(
        `shortlist action fits ${width}px screen`,
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= width
      );
      const assistant = visitorPage.locator('[data-floating-lead-bot]');
      if (await assistant.isVisible()) {
        const assistantBounds = await assistant.boundingBox();
        must(
          `assistant stays above shortlist action at ${width}px`,
          assistantBounds &&
            assistantBounds.y + assistantBounds.height <= bounds.y
        );
      }
      await enquire.click();
      const dialog = visitorPage.getByRole('dialog');
      await dialog
        .getByLabel('Your name', { exact: true })
        .fill(`Shortlist visitor ${width} ${stamp}`);
      await dialog
        .getByLabel('Mobile number', { exact: true })
        .fill(
          `+9197${width === 320 ? '32' : '12'}${String(Date.now()).slice(-6)}`
        );
      const responsePromise = visitorPage.waitForResponse(
        (response) =>
          response.url().includes('/api/public/inquiry') &&
          response.request().method() === 'POST'
      );
      await dialog
        .getByRole('button', {
          name: 'Send enquiry for 2 properties',
          exact: true,
        })
        .click();
      const inquiryResponse = await responsePromise;
      const submittedIds = inquiryResponse.request().postDataJSON().propertyIds;
      must(
        `enquiry submits the selected property IDs at ${width}px`,
        submittedIds.length === selectedIds.length &&
          selectedIds.every((id) => submittedIds.includes(id)),
        JSON.stringify({ expected: selectedIds, submitted: submittedIds })
      );
      const inquiry = await inquiryResponse.json();
      must(
        `shortlist enquiry succeeds at ${width}px`,
        inquiryResponse.ok() && inquiry.success === true,
        JSON.stringify(inquiry)
      );
      await dialog.getByText('Enquiry sent', { exact: true }).waitFor();
      const { data: links, error: linksError } = await admin
        .from('contact_property_inquiries')
        .select('property_id')
        .eq('account_id', agentA.accountId)
        .eq('contact_id', inquiry.contactId);
      if (linksError) throw linksError;
      must(
        `both shortlisted properties are linked at ${width}px`,
        selectedIds.every((id) => links.some((row) => row.property_id === id))
      );
      const { data: conversation } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', agentA.accountId)
        .eq('contact_id', inquiry.contactId)
        .single();
      const { data: messages } = await admin
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversation.id);
      must(
        `one inbox enquiry contains both properties at ${width}px`,
        messages.length === 1 &&
          selectedIds.every((id) => messages[0].content_text.includes(id))
      );
      await dialog.getByRole('button', { name: 'Continue browsing' }).click();
      must(
        `successful enquiry clears shortlist at ${width}px`,
        (await enquire.count()) === 0
      );
    }
  } finally {
    await showcaseBrowser.browser.close();
  }

  const designsBrowser = await launch();
  try {
    await login(designsBrowser.page);
    const visitor = await designsBrowser.browser.newPage();
    const { data: otherBefore, error: beforeError } = await admin
      .from('showcase_settings')
      .select('showcase_style')
      .eq('account_id', agentB.accountId)
      .maybeSingle();
    if (beforeError) throw beforeError;
    await mkdir('test-results/showcase-designs', { recursive: true });
    const showcaseUrl = `${BASE}/?account_id=${agentA.accountId}&ids=${directSource.id},${contactShareSource.id}`;
    for (const style of ['warm-editorial', 'map-discovery', 'quiet-luxury']) {
      const saved = await designsBrowser.page.request.patch(
        `${BASE}/api/showcase/public-profile`,
        {
          data: {
            showcaseStyle: style,
            showcase3dEnabled: false,
            accountId: agentB.accountId,
          },
        }
      );
      must(
        `${style} saves for the authenticated agency`,
        saved.ok(),
        await saved.text()
      );
      for (const width of [1280, 320]) {
        await visitor.setViewportSize({ width, height: 900 });
        await visitor.goto(showcaseUrl, { waitUntil: 'domcontentloaded' });
        await visitor
          .locator(`[data-showcase-style="${style}"]`)
          .waitFor({ timeout: 60000 });
        await visitor.waitForFunction(
          () =>
            document.querySelectorAll('button[aria-label^="Shortlist "]')
              .length === 2
        );
        must(
          `${style} fits ${width}px`,
          await visitor.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        );
        for (const property of [directSource, contactShareSource]) {
          must(
            `${style} bookmark has a Shortlist hover label`,
            (await visitor
              .getByRole('button', {
                name: `Shortlist ${property.title}`,
                exact: true,
              })
              .getAttribute('title')) === 'Shortlist'
          );
          await visitor
            .getByRole('button', {
              name: `Shortlist ${property.title}`,
              exact: true,
            })
            .click();
        }
        await visitor
          .getByRole('button', { name: 'Enquire about selected', exact: true })
          .click();
        const dialog = visitor.getByRole('dialog');
        await dialog
          .getByRole('button', {
            name: 'Send enquiry for 2 properties',
            exact: true,
          })
          .waitFor();
        await visitor.screenshot({
          path: `test-results/showcase-designs/${style}-${width}-enquiry.png`,
        });
        await visitor.keyboard.press('Escape');
        if (style === 'map-discovery' && width === 320) {
          await visitor
            .getByRole('button', { name: 'Map', exact: true })
            .click();
          await visitor
            .getByRole('region', { name: 'Property locations' })
            .waitFor();
        }
        if (style === 'map-discovery') {
          const mapPanel = visitor.getByRole('region', {
            name: 'Property locations',
          });
          await mapPanel.getByLabel('Area on map', { exact: true }).waitFor();
          const mapSource = await mapPanel
            .locator('iframe')
            .getAttribute('src');
          must(
            `public locality map renders at ${width}px`,
            mapSource &&
              new URL(mapSource).searchParams.get('q') ===
                'Koramangala, Bengaluru, Karnataka'
          );
          must(
            `latest shortlist focuses the map at ${width}px`,
            await mapPanel
              .getByText('Pinned from shortlist', { exact: true })
              .isVisible()
          );
          must(
            `area map identifies approximate locations at ${width}px`,
            await mapPanel
              .getByText(
                'Area overview only. Exact property locations are shared on request.',
                { exact: true }
              )
              .isVisible()
          );
          if (width === 1280) {
            await mapPanel
              .getByRole('button', { name: 'Close map', exact: true })
              .click();
            await visitor
              .getByRole('button', { name: 'Show map', exact: true })
              .waitFor();
            must(
              'closing the map restores a third desktop property column',
              (await visitor
                .locator('.showcase-listing-grid')
                .evaluate(
                  (grid) =>
                    getComputedStyle(grid).gridTemplateColumns.split(' ').length
                )) === 3
            );
            await visitor
              .getByRole('button', { name: 'Show map', exact: true })
              .click();
            await visitor
              .getByRole('region', { name: 'Property locations' })
              .waitFor();
          }
        }
        await visitor.screenshot({
          path: `test-results/showcase-designs/${style}-${width}.png`,
          fullPage: true,
        });
        for (const property of [directSource, contactShareSource]) {
          await visitor
            .getByRole('button', {
              name: `Shortlist ${property.title}`,
              exact: true,
            })
            .click();
        }
        if (style === 'map-discovery' && width === 1280) {
          await visitor.goto(`${BASE}/?account_id=${agentA.accountId}`);
          await visitor.waitForFunction(
            () =>
              document.querySelectorAll('.showcase-listing-card').length >= 3
          );
          const scrollDistance = await visitor.evaluate(() => {
            const catalog = document
              .querySelector('.showcase-map-layout')
              .getBoundingClientRect();
            const map = document
              .querySelector('.showcase-map-aside')
              .getBoundingClientRect();
            const distance = (catalog.height - map.height) / 3;
            window.scrollTo(0, catalog.top + window.scrollY - 80 + distance);
            return distance;
          });
          must(
            'catalog has enough listings to verify map scrolling',
            scrollDistance > 10
          );
          await visitor.waitForFunction(
            () =>
              Math.abs(
                document
                  .querySelector('.showcase-map-aside')
                  .getBoundingClientRect().top - 80
              ) < 2
          );
          await visitor.evaluate(
            (distance) => window.scrollBy(0, distance),
            scrollDistance
          );
          await visitor.waitForFunction(
            () =>
              Math.abs(
                document
                  .querySelector('.showcase-map-aside')
                  .getBoundingClientRect().top - 80
              ) < 2
          );
          must('map follows desktop scrolling below the header', true);
        }
      }
    }
    await visitor.goto(`${showcaseUrl}&preview_style=warm-editorial`);
    await visitor.locator('[data-showcase-style="warm-editorial"]').waitFor();
    const { data: savedStyle } = await admin
      .from('showcase_settings')
      .select('showcase_style')
      .eq('account_id', agentA.accountId)
      .single();
    must(
      'preview does not replace the saved agency design',
      savedStyle?.showcase_style === 'quiet-luxury'
    );
    const { data: otherAfter, error: afterError } = await admin
      .from('showcase_settings')
      .select('showcase_style')
      .eq('account_id', agentB.accountId)
      .maybeSingle();
    if (afterError) throw afterError;
    must(
      'another agency keeps its own showcase design',
      JSON.stringify(otherBefore) === JSON.stringify(otherAfter)
    );
  } finally {
    await designsBrowser.browser.close();
  }

  console.log('agent inventory sharing E2E passed');
} finally {
  await cleanup();
}
