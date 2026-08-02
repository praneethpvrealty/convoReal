# Cloudflare WAF Custom Rules for convoreal.com

Two custom rules for the **Free** plan that cut automated background traffic without touching any live integration.

Both live in the Cloudflare dashboard under **Security → WAF → Custom rules**. Nothing here is deployed by the application — this file is the record of what should be configured, so the rules can be rebuilt if the zone is ever reset.

---

## Background

Pre-launch traffic on a public domain is normal and mostly automated. The sources, roughly in order of volume:

1. **Search and AI crawlers.** `src/app/robots.ts` returns `allow: '/'` and publishes a sitemap; `src/app/sitemap.ts` enumerates every property, project, and farmland page. Googlebot, Bingbot, GPTBot, ClaudeBot, and the SEO crawlers all fetch from US-hosted IPs regardless of audience.
2. **Certificate Transparency scanners.** Every issued TLS certificate is published to public CT logs. Scanners subscribe to those logs and begin probing new hostnames within minutes, looking for `/.env`, `/.git/config`, `/wp-login.php`, and similar. Being unlaunched is irrelevant — they find the domain from the certificate.
3. **Vercel crons.** `vercel.json` schedules seven jobs; `/api/appointments/cron` alone runs every 15 minutes. These fire from Vercel's US regions.
4. **Meta.** WhatsApp webhook deliveries and `facebookexternalhit` OG fetches, all from US IPs.

A high uncached ratio is expected rather than suspicious: `next.config.ts` sets `no-store` on `/api/*`, and the showcase pages are dynamic.

---

## Plan notes (Free)

| Capability | Free plan |
|---|---|
| Cloudflare Rules | 70 |
| WAF custom rules | 5 |
| Bot Fight Mode | Available (on/off toggle, not customisable) |
| DDoS protection | Unmetered, all plans |
| Security Events retention | 24 hours, sampled |
| Security Analytics retention | 7 days |

Two of the five WAF rule slots are used below.

The `Log` action is Enterprise-only, so rules cannot be dry-run. Deploy Rule 1 first (zero risk), confirm nothing legitimate breaks, then deploy Rule 2.

---

## Rule 1 — `block-scanner-paths`

**Action: Block**

```
(http.request.uri.path.extension in {"php" "asp" "aspx" "jsp" "cgi" "sh" "bak" "sql" "old" "ini" "yml"})
or (lower(http.request.uri.path) contains "wp-admin")
or (lower(http.request.uri.path) contains "wp-login")
or (lower(http.request.uri.path) contains "wp-content")
or (lower(http.request.uri.path) contains "wp-includes")
or (lower(http.request.uri.path) contains "xmlrpc")
or (lower(http.request.uri.path) contains "phpmyadmin")
or (lower(http.request.uri.path) contains "/.env")
or (lower(http.request.uri.path) contains "/.git")
or (lower(http.request.uri.path) contains "/.aws")
or (lower(http.request.uri.path) contains "/.ssh")
or (lower(http.request.uri.path) contains "/.svn")
or (lower(http.request.uri.path) contains "/cgi-bin/")
or (lower(http.request.uri.path) contains "/vendor/")
```

The extension clause carries most of the load. A Next.js app never serves `.php`, `.asp`, `.jsp`, or `.sql`, so blocking those outright is risk-free and absorbs the majority of scanner probes in a single condition.

The remaining clauses target specific filenames rather than broad substrings, because the app has real routes at `/admin`, `/dev`, and `/docs/` that a blanket `contains "admin"` match would break.

If the dashboard rejects `lower()`, drop it and match `http.request.uri.path` directly. The cost is missing the minority of scanners that use mixed-case paths.

This rule is permanent — keep it after launch.

---

## Rule 2 — `prelaunch-challenge-non-india`

**Action: Managed Challenge**

```
(ip.src.country ne "IN")
and not (cf.client.bot)
and not (http.request.uri.path eq "/api/whatsapp/webhook")
and not (http.request.uri.path eq "/api/leads/email-webhook")
and not (http.request.uri.path eq "/api/appointments/cron")
and not (starts_with(http.request.uri.path, "/api/whatsapp/flows/endpoint/"))
and not (starts_with(http.request.uri.path, "/api/cron/"))
and not (starts_with(http.request.uri.path, "/api/webhooks/"))
and not (starts_with(http.request.uri.path, "/.well-known/"))
```

On older zones `ip.src.country` may appear as `ip.geoip.country`; both refer to the same field.

### The exclusions are load-bearing

Each exempted path is a live integration whose traffic legitimately originates outside India. Removing any of them breaks a feature silently — the request is challenged, the caller is not a browser, and nothing surfaces an error.

| Path | Why it must be exempt |
|---|---|
| `/api/whatsapp/webhook` | Meta posts from US IPs. Challenging it stops inbound messages reaching the shared inbox. Safe to exempt: `verifySignature()` already authenticates every payload with HMAC-SHA256. |
| `/api/whatsapp/flows/endpoint/*` | Meta calls this without a browser session, using its own RSA-OAEP + AES-GCM handshake. `AGENTS.md` already flags the same carve-out for `proxy.ts`. |
| `/api/cron/*`, `/api/appointments/cron` | Vercel crons fire from US regions. Already gated by `CRON_SECRET` / `AUTOMATION_CRON_SECRET`. |
| `/api/webhooks/*` | Stripe posts from the US. |
| `/.well-known/*` | Apple and Google fetch the app-link association files from US infrastructure. |

### The `cf.client.bot` decision

Keeping `not (cf.client.bot)` exempts verified crawlers so Googlebot continues indexing. That matches the intent already encoded in `robots.ts` and `sitemap.ts`, and search engines are slow to re-crawl a site that started refusing them.

Drop that line only if the domain should stay unindexed until launch, accepting the deindexing cost.

### Retire at launch

Rule 2 is a pre-launch measure. Delete it when real users exist — geography is not an access-control policy, and challenging every non-Indian visitor will block legitimate customers.

---

## Reading the results

An hour after deploying, open **Security → Events**. Every challenged request is logged with path, ASN, user agent, and country.

This is the practical workaround for Free-tier sampling: the rule turns traffic you are curious about into fully-detailed log entries, without a plan upgrade.

What to look for:

- Top paths are `/`, `/property/*`, `/sitemap.xml` → search crawlers, expected.
- Top paths are `/wp-admin`, `/.env`, `/.git/config` → scanners, now blocked by Rule 1.
- ASN is a residential ISP with a coherent page sequence → an actual human, the only genuinely notable outcome.

The one result worth investigating rather than assuming: a **200 response to a non-India IP on any `/api/` path outside `/api/public/`**. The 13 public routes under `/api/public/` are intentionally reachable and 11 already rate-limit via `src/lib/rate-limit.ts`. Anything else answering 200 to an unauthenticated foreign request deserves a look.

---

## When to revisit the plan

Free covers everything above. The Pro plan's value is the OWASP and zero-day managed rulesets, which protect an application with real users and real data.

The point to reconsider is when brokerages are live on the platform — at that stage the justification is protecting stored lead data and encrypted WhatsApp tokens, not reducing background noise.
