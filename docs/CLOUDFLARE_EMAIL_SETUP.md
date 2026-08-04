# Cloudflare Email Routing and Worker Setup Guide for convoreal.com

This guide outlines the concrete steps to connect your domain **convoreal.com** to Cloudflare, configure Cloudflare Email Routing on a safe subdomain (**leads.convoreal.com**) to protect existing business email accounts, and deploy a serverless Worker to forward leads directly to your Engine webhook endpoint.

---

## Step 0: Add convoreal.com to Cloudflare

Your screenshot shows that **convoreal.com** is not yet managed by Cloudflare in this account. Follow these steps to add it:

1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), click the blue **Add domain** button on the right.
2. Enter `convoreal.com` and click **Continue**.
3. Choose the **Free Plan** ($0) and click **Continue**.
4. Cloudflare will scan your existing DNS records (at GoDaddy, Hostinger, or your current provider). Verify them and click **Continue**.
5. Cloudflare will provide you with **two custom Cloudflare Nameservers** (e.g., `alan.ns.cloudflare.com` and `heather.ns.cloudflare.com`).
6. **Update Nameservers at your Domain Registrar (GoDaddy, Namecheap, etc.)**:
   * Log into the account where you purchased `convoreal.com`.
   * Find the DNS management page for `convoreal.com`.
   * Select **Change Nameservers** or **Use Custom Nameservers**.
   * Replace the existing nameservers with the two provided by Cloudflare.
   * Save changes. (Note: DNS propagation can take from 10 minutes to a few hours).
7. Go back to Cloudflare and click **Check Nameservers**. Once active, your domain status will change to **Active** with a green checkmark.

---

## Step 1: Enable Cloudflare Email Routing on leads.convoreal.com

To ensure your existing business emails (e.g., `name@convoreal.com` hosted on Google Workspace or Outlook) continue to work without conflict, we configure Email Routing on the **subdomain** `leads.convoreal.com`.

1. Click on **convoreal.com** in the Cloudflare Dashboard.
2. Click on **Email** &gt; **Email Routing** in the left sidebar.
3. Click **Get Started**.
4. When asked to configure the domain, select **Subdomain** instead of Root Domain.
5. Enter **`leads`** as the subdomain (resulting in `leads.convoreal.com`).
6. Under the **DNS Records** tab, Cloudflare will display a warning that MX and TXT records are missing for the subdomain. Click **Add records automatically** (this adds separate MX records specifically for the `leads` subdomain, leaving your main domain's email completely untouched and working).
7. Verify that your email routing status shows **Active** for `leads.convoreal.com`.

---

## Step 2: Create the Forwarding Worker

Instead of routing incoming emails to a static inbox, we will route them to a serverless Cloudflare Worker that dynamically parses the destination and pushes it to the Engine.

The worker does two jobs:

1. **Push** every lead email to the Engine webhook in real time.
2. **Ledger** every lead email in Workers KV *before* pushing, so the Engine's hourly reconcile cron (`/api/cron/lead-sync-reconcile`) can detect and re-ingest anything the push path dropped. Without the ledger, a bad `ENGINE_BASE_URL` silently discards every lead — that failure mode has happened.

### 2a. Create the KV namespace

1. In the Cloudflare Dashboard, go to **Storage & Databases** &gt; **KV**.
2. Click **Create a namespace**, name it `LEADS_LEDGER`, and create it.

### 2b. Create the Worker

1. In the Cloudflare Dashboard left sidebar (under "Observe" / "Build"), go to **Workers & Pages** &gt; **Overview**.
2. Click **Create Application** &gt; **Create Worker**.
3. Name your worker: `convoreal-leads-webhook-forwarder`.
4. Click **Deploy**.
5. Go to **Settings** &gt; **Bindings** &gt; **Add** &gt; **KV namespace**: variable name `LEADS_LEDGER`, namespace `LEADS_LEDGER`.
6. Click **Edit code** and replace the default code with this exact JavaScript snippet:

```javascript
// Ledger entries live 14 days — long enough for many reconcile cycles,
// short enough that KV never accumulates unbounded mail.
const LEDGER_TTL_SECONDS = 14 * 24 * 60 * 60;

async function putLedger(env, id, raw, meta) {
  await env.LEADS_LEDGER.put(`lead:${id}`, raw, {
    expirationTtl: LEDGER_TTL_SECONDS,
    metadata: meta,
  });
}

export default {
  async email(message, env, ctx) {
    const toAddress = message.to.toLowerCase();

    // Check if recipient matches: lead-sync-[ACCOUNT_ID]@leads.convoreal.com
    if (!toAddress.startsWith('lead-sync-')) {
      console.warn(`Ignored email sent to non-lead address: ${toAddress}`);
      message.forward('admin@convoreal.com'); // Forward normal/administrative emails to a fallback address
      return;
    }

    // Extract the UUID / Account ID from the address
    const mailboxPart = toAddress.split('@')[0];
    const accountId = mailboxPart.replace('lead-sync-', '');

    // Read the raw email MIME body
    const rawEmail = await new Response(message.raw).text();

    // Ledger FIRST — if the push below fails for any reason, the raw
    // email survives here and the Engine's reconcile cron replays it.
    const id = crypto.randomUUID();
    const meta = {
      accountId,
      from: message.from,
      subject: message.headers.get('subject') || '',
      receivedAt: new Date().toISOString(),
      status: 'received',
    };
    await putLedger(env, id, rawEmail, meta);

    // Load config from environment variables
    const engineBaseUrl = env.ENGINE_BASE_URL || 'https://www.convoreal.com';
    const webhookToken = env.LEADS_WEBHOOK_TOKEN || '';

    // Call the Engine webhook endpoint
    const webhookUrl = `${engineBaseUrl}/api/leads/email-webhook?account_id=${accountId}&token=${webhookToken}`;

    console.log(`Forwarding lead email ${id} for account ${accountId} to ${engineBaseUrl}`);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Email-Worker'
        },
        body: JSON.stringify({
          subject: meta.subject,
          html: rawEmail,
          text: message.text || rawEmail,
          ledger_id: id
        })
      });

      if (response.ok) {
        console.log(`Delivered email ${id} to the Engine (status ${response.status})`);
        await putLedger(env, id, rawEmail, { ...meta, status: 'delivered' });
      } else {
        // Anything non-2xx stays in the ledger. A 401 here (token
        // mismatch) means the Engine never logged the email — only
        // the reconcile cron, which authenticates with the Engine's
        // own env token, can decide what is final and what is lost.
        const text = await response.text();
        console.error(`Engine Webhook rejected with status ${response.status}: ${text}`);
        await putLedger(env, id, rawEmail, { ...meta, status: 'push-failed' });
      }
    } catch (err) {
      console.error('Network error posting email webhook to the Engine:', err);
      await putLedger(env, id, rawEmail, { ...meta, status: 'push-failed' });
    }
  },

  // Ledger API for the Engine's reconcile cron. Auth: the same
  // LEADS_WEBHOOK_TOKEN, as a bearer token.
  async fetch(request, env) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.LEADS_WEBHOOK_TOKEN || token !== env.LEADS_WEBHOOK_TOKEN) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['ledger', '<id>', 'delivered']

    if (parts[0] !== 'ledger') {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    // GET /ledger — undelivered entries (metadata only, no raw bodies)
    if (parts.length === 1 && request.method === 'GET') {
      const entries = [];
      let cursor;
      do {
        const page = await env.LEADS_LEDGER.list({ prefix: 'lead:', cursor });
        for (const key of page.keys) {
          const meta = key.metadata;
          if (meta && meta.status !== 'delivered') {
            entries.push({ id: key.name.slice('lead:'.length), ...meta });
          }
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return new Response(JSON.stringify({ entries }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // GET /ledger/:id — raw MIME body
    if (parts.length === 2 && request.method === 'GET') {
      const raw = await env.LEADS_LEDGER.get(`lead:${parts[1]}`);
      if (raw === null) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(raw, { headers: { 'content-type': 'text/plain' } });
    }

    // POST /ledger/:id/delivered — mark reconciled
    if (parts.length === 3 && parts[2] === 'delivered' && request.method === 'POST') {
      const key = `lead:${parts[1]}`;
      const { value, metadata } = await env.LEADS_LEDGER.getWithMetadata(key);
      if (value === null) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      await env.LEADS_LEDGER.put(key, value, {
        expirationTtl: LEDGER_TTL_SECONDS,
        metadata: { ...(metadata || {}), status: 'delivered' },
      });
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }
}
```

7. Click **Save and Deploy**.

---

## Step 3: Configure Worker Environment Variables

1. Go back to your Worker configuration page (click the back arrow to exit the editor).
2. Go to the **Settings** tab &gt; **Variables**.
3. Under **Environment Variables**, click **Add variable**:
   * Name: `ENGINE_BASE_URL`
     * Value: your actual Engine dashboard URL — the Vercel deployment or your own domain. The Worker only falls back to its hardcoded default (`https://www.convoreal.com`) if this is unset, so set it explicitly. The variable must be named exactly `ENGINE_BASE_URL` — a stale `CRM_BASE_URL` from before the rename is ignored and causes the fallback to be used.
   * Name: `LEADS_WEBHOOK_TOKEN`
     * Value: Your secure webhook token matching `LEADS_WEBHOOK_TOKEN` in your Engine server's `.env.local` file. The Engine's reconcile cron also authenticates to the worker's ledger API with this same token.
4. Click **Save and Deploy**.

---

## Step 4: Route leads.convoreal.com Emails to the Worker

Now we map incoming catch-all routing patterns directly to your newly created worker:

1. Return to your home Cloudflare Dashboard.
2. Select **Websites** &gt; **convoreal.com**.
3. In the left sidebar, click **Email** &gt; **Email Routing** &gt; **Routes**.
4. Scroll down to the **Catch-all address** section.
5. Under **Catch-all address**:
   * Toggle to **Active**.
   * Click **Edit**.
   * Under **Action**, select **Send to Worker**.
   * Select your worker name: `convoreal-leads-webhook-forwarder`.
   * Click **Save**.

### Verify the Routing
Now, any email sent to `lead-sync-[account-id]@leads.convoreal.com` (such as `lead-sync-a3b0d-c3cb-4a28-84d3-67e3efa8c250@leads.convoreal.com`) will automatically trigger the worker, extract the target account ID, and push the parsed portal lead data straight into the waEngine database in real-time!

---

## Step 5: Enable the Engine's self-healing reconcile cron

The push path alone fails silently: if `ENGINE_BASE_URL` points at a dead host, the worker logs an error nobody reads and the lead is gone. The Engine closes that hole with an hourly cron (`/api/cron/lead-sync-reconcile`, registered in `vercel.json`) that:

1. Lists undelivered ledger entries from the worker (`GET /ledger`).
2. Skips anything already recorded in `email_sync_logs` (matched on `ledger_id`) — it is only marked delivered on the worker, never reprocessed, so leads never receive a duplicate auto-reply.
3. **Pulls** the raw email for the rest (`GET /ledger/:id`) and runs it through the webhook handler in-process — recovery does not depend on the push URL that just failed.
4. Notifies the account owner on WhatsApp when leads had to be healed, since healing working means the real-time path is broken.

To enable it, set in the Engine's Vercel environment:

| Variable | Value |
|---|---|
| `LEADS_WORKER_URL` | The worker's own URL, e.g. `https://convoreal-leads-webhook-forwarder.<your-subdomain>.workers.dev` |
| `LEADS_WEBHOOK_TOKEN` | Already set — the cron reuses it as the bearer token for the ledger API |

If `LEADS_WORKER_URL` is unset the cron reports `disabled` and does nothing. If the worker itself is unreachable, the cron returns `worker_unreachable` (HTTP 502, visible in Vercel cron logs) — that failure class has no ledger to replay from, so it cannot self-heal; only detection is possible.

To find the worker URL: **Workers & Pages → your worker → Settings → Domains & Routes** (enable the `workers.dev` route if it's off).
