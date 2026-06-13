# Domain Rehosting Guide: Pointing `aryavartaventures.com` to Your New App

This guide explains how to point your custom domain `aryavartaventures.com` (currently registered/managed on Wix.com) to your new Next.js property showcase application (hosted on Hostinger, Vercel, or another provider).

---

## Step 1: Connect the Domain inside your Host

Before modifying DNS records, you must register the domain inside your web hosting control panel so it knows to accept traffic for `aryavartaventures.com`.

### Option A: If using Hostinger (Recommended)
1. Log in to your **Hostinger Control Panel** (hPanel).
2. Go to **Websites** and click **Create or Migrate a Website**.
3. Choose **Create a new website** -> Select **Node.js** (or use your existing Node.js application hosting).
4. When prompted for the domain, select **Use an Existing Domain** and enter `aryavartaventures.com`.
5. Hostinger will display the **IP Address** and **CNAME target** you need for your DNS records. Note down the IP Address (e.g., `185.185.185.185`).

### Option B: If using Vercel
1. Log in to your **Vercel Dashboard** and open your CRM project.
2. Go to **Settings** -> **Domains**.
3. Type `aryavartaventures.com` (and `www.aryavartaventures.com`) and click **Add**.
4. Vercel will show red status errors indicating "Invalid Configuration" and display the required A record IP (`76.76.21.21`) and CNAME target (`cname.vercel-dns.com`).

## Step 2: Update DNS Records in GoDaddy (or Wix)

Since your domain is registered on GoDaddy, you will manage your DNS records in GoDaddy (unless you previously pointed your nameservers to Wix, in which case you will update them in Wix).

### Option A: If managing DNS in GoDaddy (Recommended)
1. Log in to your **GoDaddy Control Center / Domain Portfolio**.
2. Click **DNS** or **DNS Management** next to your domain `aryavartaventures.com`.
3. Locate the **A** record:
   - Name: `@` (represents the root domain `aryavartaventures.com`)
   - Value / Points to: Change this to your host's IP address (e.g. Vercel's `76.76.21.21` or your Hostinger server IP).
4. Locate the **CNAME** record:
   - Name: `www`
   - Value / Points to: Change this to your host's CNAME target (e.g. `cname.vercel-dns.com` or your Hostinger CNAME).
5. Click **Save** or **Save Changes**.

### Option B: If managing DNS in Wix
*(Only applicable if you connected your GoDaddy domain to Wix via Nameservers)*:
1. Log in to **Wix.com** and go to the **Domains** page.
2. Click **Manage DNS Records** next to `aryavartaventures.com`.
3. Update the A record with Host `@` to point to your new hosting IP.
4. Update the CNAME record with Host `www` to point to your new CNAME target.
5. Click **Save** changes.

---

## Step 3: Wait for DNS Propagation

DNS changes are not instantaneous and can take anywhere from **5 minutes to 24 hours** to propagate across the internet. 

- You can track the status using a public DNS lookup tool like [DNSChecker.org](https://dnschecker.org/#A/aryavartaventures.com).
- Once DNS propagates, your hosting provider (Vercel or Hostinger) will automatically issue a free **SSL Certificate (HTTPS)** for `aryavartaventures.com`.
- Now, when anyone goes to `https://www.aryavartaventures.com`, they will see your breathtaking Next.js property listings showcase. 
- You and your team can log in and manage properties by going to `https://www.aryavartaventures.com/login` or `https://www.aryavartaventures.com/dashboard`.
