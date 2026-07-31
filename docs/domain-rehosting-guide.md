# Domain Rehosting Guide: Pointing `convoreal.com` to Your New App

This guide explains how to point your custom domain `convoreal.com` (currently registered/managed on Wix.com) to your new Next.js property showcase application (hosted on Hostinger, Vercel, or another provider).

---

## Step 1: Connect the Domain inside your Host

Before modifying DNS records, you must register the domain inside your web hosting control panel so it knows to accept traffic for `convoreal.com`.

### Option A: If using Hostinger (Recommended)
1. Log in to your **Hostinger Control Panel** (hPanel).
2. Go to **Websites** and click **Create or Migrate a Website**.
3. Choose **Create a new website** -> Select **Node.js** (or use your existing Node.js application hosting).
4. When prompted for the domain, select **Use an Existing Domain** and enter `convoreal.com`.
5. Hostinger will display the **IP Address** and **CNAME target** you need for your DNS records. Note down the IP Address (e.g., `185.185.185.185`).

### Option B: If using Vercel
1. Log in to your **Vercel Dashboard** and open your CRM project.
2. Go to **Settings** -> **Domains**.
3. Type `convoreal.com` (and `www.convoreal.com`) and click **Add**.
4. Vercel will show red status errors indicating "Invalid Configuration" and display the required A record IP (`76.76.21.21`) and CNAME target (`cname.vercel-dns.com`).

## Step 2: Update DNS Records in GoDaddy (or Wix)

Since your domain is registered on GoDaddy, you will manage your DNS records in GoDaddy (unless you previously pointed your nameservers to Wix, in which case you will update them in Wix).

### Option A: If managing DNS in GoDaddy (Recommended)
1. Log in to your **GoDaddy Control Center / Domain Portfolio**.
2. Click **DNS** or **DNS Management** next to your domain `convoreal.com`.
3. Locate the **A** record:
   - Name: `@` (represents the root domain `convoreal.com`)
   - Value / Points to: Change this to your host's IP address (e.g. Vercel's `76.76.21.21` or your Hostinger server IP).
4. Locate the **CNAME** record:
   - Name: `www`
   - Value / Points to: Change this to your host's CNAME target (e.g. `cname.vercel-dns.com` or your Hostinger CNAME).
5. Click **Save** or **Save Changes**.

### Option B: If managing DNS in Wix
*(Only applicable if you connected your GoDaddy domain to Wix via Nameservers)*:
1. Log in to **Wix.com** and go to the **Domains** page.
2. Click **Manage DNS Records** next to `convoreal.com`.
3. Update the A record with Host `@` to point to your new hosting IP.
4. Update the CNAME record with Host `www` to point to your new CNAME target.
5. Click **Save** changes.

---

## Step 3: Add the Wildcard Record for Showcase Subdomains

Steps 1 and 2 cover `convoreal.com` and `www.convoreal.com` only. They do **not** make per-account showcase links work.

Settings → Showcase lets each account claim a subdomain, and the app then promises the tenant a link like `https://aryavartaventures.convoreal.com`. The application side of that is already built: `resolveSubdomainFromHost()` pulls the label out of the `Host` header and `cachedResolveAccountFromSubdomain()` maps it to an account (both in `src/lib/showcase/public-data.ts`). Nothing needs deploying. But the browser has to reach the app first, and a hostname nobody created does not resolve — the link fails before any of that code runs, with a DNS error rather than a page from the app.

### Why the obvious routes don't work here

- **A wildcard domain on Vercel requires Vercel's nameservers.** For `*.convoreal.com` Vercel must issue a wildcard certificate, which needs DNS-01 validation — it has to write `_acme-challenge` records itself, so it offers no CNAME target, only `ns1/ns2.vercel-dns.com`. Handing it the zone would kill Cloudflare Email Routing on `leads.convoreal.com` (the `route*.mx.cloudflare.net` MX records only work while Cloudflare hosts the DNS) and drop the Cloudflare proxy/WAF.
- **A plain proxied CNAME to the apex doesn't work either.** Cloudflare would accept the browser's TLS (Universal SSL covers `*.convoreal.com`), but then forward to Vercel with the tenant hostname — which Vercel has no domain entry or certificate for, so it 404s.
- **Never point the wildcard at a name the wildcard itself covers** (e.g. `*` → `aryavartaventures.convoreal.com`): the lookup matches the wildcard, is told to resolve the same name, and chases its own tail into SERVFAIL.

### The setup: terminate the wildcard at Cloudflare, bridge with a Worker

Cloudflare proxies wildcard records on every plan (since September 2022), and its Universal SSL certificate already covers one label under the apex. So the wildcard never reaches Vercel as a hostname at all — a Worker re-issues the request against `www` and pins the tenant label into the URL, where `src/app/page.tsx` picks it up as `?__tenant=`. In the URL, not a header, deliberately: the edge cache keys by URL, so tenants get separate cache entries instead of bleeding into each other under the `s-maxage` set by `next.config.ts`.

1. **DNS record** — `*.convoreal.com`:
   - Type: **CNAME**, Name: `*`, Content: `convoreal.com` (a placeholder — the Worker decides the real destination), Proxy status: **Proxied** (orange cloud). The proxy is required; a grey-cloud record would send browsers to Vercel directly, which cannot serve these hostnames.
2. **Worker** — Cloudflare dashboard → Workers & Pages → Create → paste → Deploy:

   ```js
   const BASE = 'convoreal.com';
   const CANONICAL = `https://www.${BASE}`;
   // Superset of the app's reserved labels (resolveSubdomainFromHost in
   // src/lib/showcase/public-data.ts) plus the mail-bearing subdomains.
   const RESERVED = ['www', 'app', 'admin', 'api', 'leads', 'send', 'email'];

   export default {
     async fetch(request) {
       const url = new URL(request.url);
       const host = url.hostname;
       const label = host.endsWith(`.${BASE}`)
         ? host.slice(0, host.length - BASE.length - 1)
         : '';
       if (!label || label.includes('.') || RESERVED.includes(label)) {
         return fetch(request);
       }
       const target = new URL(url.pathname + url.search, CANONICAL);
       if (url.pathname === '/') target.searchParams.set('__tenant', label);
       return fetch(new Request(target, request));
     },
   };
   ```

   Only `/` gets the `__tenant` param — it is the only route that resolves a tenant from it, and keeping it off `/_next/*` and `/api/*` keeps their cache keys clean. Everything else is proxied as-is, so assets and API calls made from a tenant page work unchanged.
3. **Routes** — on the `convoreal.com` zone, Workers Routes:
   - `*.convoreal.com/*` → the Worker above.
   - `www.convoreal.com/*` → **None** (an exclusion route, so main-site traffic never spends Worker quota — the free tier is 100k requests/day).
4. **Vercel** — nothing to add; delete any `*.convoreal.com` entry sitting at "Invalid Configuration" there, it can never validate without the nameserver move.

Verify: `curl -sI https://<any-label>.convoreal.com/` should return the app (a wildcard answers for made-up labels too — unclaimed ones fall back to the default account). If DNS resolves but the response is a Cloudflare 1000-series error page, the Worker route is missing or the record is grey-clouded.

Some labels never reach a tenant showcase no matter what DNS says: `www`, `app`, `admin` and `api` are reserved in `resolveSubdomainFromHost()` and fall through to the normal site.

**Alternative for a handful of tenants:** skip the Worker and add each subdomain individually in Vercel (Settings → Domains → `tenant.convoreal.com`), plus a grey-cloud CNAME in Cloudflare to the target Vercel shows. Single subdomains validate over HTTP — no nameserver move — at the cost of one manual step per brokerage.

---

## Step 4: Wait for DNS Propagation

DNS changes are not instantaneous and can take anywhere from **5 minutes to 24 hours** to propagate across the internet. 

- You can track the status using a public DNS lookup tool like [DNSChecker.org](https://dnschecker.org/#A/convoreal.com).
- Once DNS propagates, your hosting provider (Vercel or Hostinger) will automatically issue a free **SSL Certificate (HTTPS)** for `convoreal.com`.
- Now, when anyone goes to `https://www.convoreal.com`, they will see your breathtaking Next.js property listings showcase. 
- You and your team can log in and manage properties by going to `https://www.convoreal.com/login` or `https://www.convoreal.com/dashboard`.
