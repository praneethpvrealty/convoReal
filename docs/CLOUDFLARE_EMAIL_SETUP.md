# Cloudflare Email Routing and Worker Setup Guide for convoreal.com

This guide outlines the concrete steps to connect your domain **convoreal.com** to Cloudflare, configure Cloudflare Email Routing on a safe subdomain (**leads.convoreal.com**) to protect existing business email accounts, and deploy a serverless Worker to forward leads directly to your CRM webhook endpoint.

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

Instead of routing incoming emails to a static inbox, we will route them to a serverless Cloudflare Worker that dynamically parses the destination and pushes it to the CRM.

1. In the Cloudflare Dashboard left sidebar (under "Observe" / "Build"), go to **Workers & Pages** &gt; **Overview**.
2. Click **Create Application** &gt; **Create Worker**.
3. Name your worker: `convoreal-leads-webhook-forwarder`.
4. Click **Deploy**.
5. Once deployed, click **Edit code** and replace the default code with this exact JavaScript snippet:

```javascript
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
    
    // Load config from environment variables
    const crmBaseUrl = env.CRM_BASE_URL || 'https://wacrm.convoreal.com';
    const webhookToken = env.LEADS_WEBHOOK_TOKEN || '';
    
    // Call the CRM webhook endpoint
    const webhookUrl = `${crmBaseUrl}/api/leads/email-webhook?account_id=${accountId}&token=${webhookToken}`;
    
    console.log(`Forwarding lead email for account ${accountId} to ${crmBaseUrl}`);
    
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Email-Worker'
        },
        body: JSON.stringify({
          subject: message.headers.get('subject'),
          html: rawEmail,
          text: message.text || rawEmail
        })
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.error(`CRM Webhook rejected with status ${response.status}: ${text}`);
      } else {
        console.log(`Successfully delivered email to CRM for account ${accountId}`);
      }
    } catch (err) {
      console.error('Network error posting email webhook to CRM:', err);
    }
  }
}
```

6. Click **Save and Deploy**.

---

## Step 3: Configure Worker Environment Variables

1. Go back to your Worker configuration page (click the back arrow to exit the editor).
2. Go to the **Settings** tab &gt; **Variables**.
3. Under **Environment Variables**, click **Add variable**:
   * Name: `CRM_BASE_URL`
     * Value: `https://wacrm.convoreal.com` (Replace with your actual CRM dashboard URL if different, e.g. Vercel deployment URL).
   * Name: `LEADS_WEBHOOK_TOKEN`
     * Value: Your secure webhook token matching `LEADS_WEBHOOK_TOKEN` in your CRM server's `.env.local` file.
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
Now, any email sent to `lead-sync-[account-id]@leads.convoreal.com` (such as `lead-sync-a3b0d-c3cb-4a28-84d3-67e3efa8c250@leads.convoreal.com`) will automatically trigger the worker, extract the target account ID, and push the parsed portal lead data straight into the waCRM database in real-time!
