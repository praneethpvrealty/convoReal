# Seller Page — Design & Architecture

> **For the implementing model:** read `AGENTS.md` first; this repo runs Next.js 16 with breaking changes, so consult `node_modules/next/dist/docs/` before touching routes or `next.config.ts`. Ship this as one PR on an `agent/*` branch with web and mobile together (§2.8). The migration in §5 is purely additive and may be applied as soon as the branch is pushed. After each step: `npm run typecheck && npm run lint && npm test`, plus `cd mobile && npm run typecheck && npm run lint && npm test`.

---

## 1. What this is

A **seller page** is a shareable URL that shows one seller's live listings on the managing brokerage's own branded showcase. The seller shares it on WhatsApp, in a society group, on a signboard; every buyer who opens it enquires with the **brokerage**, never with the seller directly.

Customer-facing name: **Seller page** ("Your public page" inside Portfolio). Code identifiers: `seller_page_*`.

It is not a seller website, not a microsite and not a second showcase. It is the existing public catalogue (`src/app/page.tsx`) rendered under a filter, the same way a `?property_id=` link renders it around one listing.

### 1.1 Why

- Sellers already ask "where can I send people?". Today the only answers are one property link per listing, or nothing.
- The brokerage keeps the lead: the page carries only the agency's contact number and WhatsApp CTA, so a seller who distributes their page is doing the agency's marketing.
- Almost every part exists. The catalogue already knows how to filter by a contact, the owner portal already reports showcase views per property, and the share URL builders already know the account's subdomain.

### 1.2 What already exists, and what is wrong with reusing it as-is

`src/app/page.tsx:369-378` resolves `?ref=<contact id>` through `cachedResolveShowcaseRef` and, at lines 427-431, filters the catalogue to `owner_contact_id === contactId`. Nothing links to that path today. It cannot be reused directly for a seller page, for three reasons:

| Problem | Where | Consequence if reused |
| --- | --- | --- |
| The referrer's phone replaces the agency CTA | `cachedResolveReferrerPhone` (`page.tsx:230-298`), `displayPhone = referrerPhone \|\| settings.contact_phone` (`showcase-view.tsx:924`) | Buyers would WhatsApp the **seller**, bypassing the brokerage |
| `owner_contact_id` is overloaded | migration `191_portfolio_excludes_agent_referred.sql` | On `listing_source = 'agent'` rows the column holds the **referring agent**, so a co-broker's stock would appear on a seller's page |
| The URL carries the contact UUID | `?ref=<uuid>` | Leaks an internal id, cannot be rotated, unreadable in a WhatsApp message |

The `ref` path stays exactly as it is: it serves referral partners and agent profiles, and its CTA-phone behaviour is correct for them. The seller page is a **separate resolution mode** that shares the render.

---

## 2. Product decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Who turns it on | The **agency**, per contact, from the contact record (agent role or higher) | The page carries the agency's brand; a private individual may not want "all my listings" public. Default off. |
| Who shares it | The **seller**, from Portfolio (web `/den`, mobile den tab); the agency can also copy it from the contact record | |
| What it shows | Listings where `owner_contact_id = seller` **and** `listing_source <> 'agent'` **and** published; teaser visibility and location privacy apply as on the main catalogue | Identical to the Den's ownership rule (`resolveOwnerPropertyIds`, `src/lib/den/auth.ts:151-172`), so the seller's page and the seller's portal always agree |
| Who the buyer contacts | The agency (`showcase_settings.contact_phone`), never the seller | Core of the value proposition |
| Seller identity on the page | Not shown. Header reads "A curated collection · <Agency>" | The seller shares it themselves, so recipients already know whose it is; the page never publishes a private person's name or phone |
| URL shape | `https://<agency>.convoreal.com/seller/<slug>` (or `https://convoreal.com/seller/<slug>` without a subdomain) | Slug alone identifies the account, so the link works with or without the tenant label |
| Slug | 10 random characters from `abcdefghjkmnpqrstuvwxyz23456789` (no `0 o 1 l i`), globally unique | ≈ 49 bits, unguessable, readable aloud, no name leakage. Regenerating it is the revoke |
| Empty page | Renders the agency-branded empty state, never the full catalogue | A seller with nothing live must not become an unfiltered mirror of the agency |
| Search engines | `noindex, nofollow` | It is a share surface, not an SEO page; `/property/[slug]` remains the indexable listing page |
| Multi-agency sellers | One page per (agency, contact); Portfolio lists each with its agency name | `den_contact_links` already spans agencies |
| Custom domains, seller-editable copy, microsite templates | Out of scope | Support cost with no lead upside; forking the showcase is forbidden by the constitution |

---

## 3. Architecture

```text
  Seller shares  https://acme.convoreal.com/seller/k7m2xq9dpe
        │
        ▼
  next.config.ts rewrite   /seller/:slug  →  /?sp=:slug      (URL stays /seller/…)
        │
        ▼
  src/app/page.tsx (RootPage)
    1. resolveSellerPage(slug)  → { accountId, contactId }   or notFound()
    2. tenant label present and ≠ accountId                  → notFound()
    3. accountId := seller's account (a subdomain cannot override it)
    4. cachedFetchShowcaseData(accountId)                     (unchanged)
    5. sellerListingIds(accountId, contactId)                 (shared ownership rule)
    6. filteredProperties := published ∩ sellerListingIds     (empty stays empty)
    7. referrerPhone := null  → CTA = settings.contact_phone
    8. render <ShowcaseView … sellerPage={{ contactId }} />
        │
        ▼
  Buyer enquires → /api/public/inquiry   referrerContactId = seller contact
  Buyer browses  → /api/public/showcase-events   via_contact_id = seller contact
        │
        ▼
  Owner dashboard (/api/den/dashboard) and Pulse already count these
```

### 3.1 Why a rewrite instead of a new page

`src/app/page.tsx` owns subdomain and `__tenant` resolution, share grants, Pulse identity, style and Deal Floor presentation, Open Graph tags and the marketing-landing fallthrough. A second page under `src/app/seller/[slug]/` would have to duplicate or extract all of that. A rewrite keeps `/seller/<slug>` in the address bar and hands the root page one more search param, exactly the pattern the Cloudflare Worker already uses with `?__tenant=`.

Client-side navigation in `showcase-view.tsx` rebuilds URLs from `window.location.href`, so the `/seller/<slug>` path survives filter and detail-view changes. Implementation must grep for any hard-coded `'/?…'` pushes and confirm none drop the path.

### 3.2 Resolution order in `RootPage`

The new `sp` param is handled **before** `ref` and takes precedence over it:

1. Marketing-landing check: `!subdomain && !ref && !initialPropertyId && !sp` → `<MarketingLanding/>`.
2. `sp` present → `resolveSellerPage(sp)`. Null → `notFound()`. A revoked or mistyped slug is a 404, never a fallthrough to any catalogue.
3. `accountId = seller.accountId`. If a tenant label resolved to a different account → `notFound()`. Without a label (the Worker only pins `__tenant` on `/`, see `docs/domain-rehosting-guide.md`) the slug is authoritative.
4. `isAgentMode = false`, `filterContactId = null`, `filterUserId = null` — the seller page never enters the referrer branch, so `cachedResolveReferrerPhone` is skipped and `referrerPhone` stays null.
5. `?property_id=` may still be combined with `sp` (a seller sharing one of their listings from the page); the targeted property is merged only if it is in `sellerListingIds`, otherwise ignored.
6. `?g=` share grants and `?v=` visitor attribution keep their current meaning.

### 3.3 Caching

- `resolveSellerPage` uses React `cache` (per request), **not** `unstable_cache`. Rotating or disabling a slug must kill the old link on the next request, the same reasoning as share grants (`page.tsx:459-463`).
- `sellerListingIds` is one indexed query per render (`idx_properties_owner_contact` exists) and also uses React `cache`. The catalogue itself keeps its content-versioned `unstable_cache`.
- The page-level `s-maxage` + SWR from `next.config.ts` applies as to any showcase URL; the URL includes the slug, so tenants and sellers get separate edge entries.

### 3.4 Attribution and analytics

| Signal | Field | Effect |
| --- | --- | --- |
| Enquiry from the page | `contacts.referrer_contact_id = seller` via the existing `referrerContactId` body field on `/api/public/inquiry` | The lead shows "referred by <seller>" in the CRM; the agency sees which seller's page is producing |
| Showcase events | `showcase_events.via_contact_id = seller`, `contact_id` null unless a `?v=` visitor is present | Pulse renders "guest via <seller>'s page" using the PLS-003 guest semantics; the owner dashboard's per-property showcase-view counts include them with no change |
| Page opens | `showcase_events.event_type = 'open'` with `metadata.seller_page = true` | Lets Portfolio show "N opens of your page this week" later without a new table |

`/api/public/showcase-events` must validate `seller_contact_id` the same way it validates `share_id` (`route.ts:150-179`): the contact must exist in the posted account and currently have a slug; otherwise the field is dropped, never rejected.

### 3.5 Security

- The slug resolves `account_id`; every subsequent query is scoped to that account exactly as the catalogue is today. No new service-role read is unscoped.
- Drafts never appear (PRP-017 holds because filtering happens after `cachedFetchShowcaseData` returns only published rows).
- Nothing about the seller is rendered: no name, phone, email or contact id reaches the client. The `sellerPage` prop passed to `ShowcaseView` carries only what the trackers post.
- Enabling, rotating and disabling require `requireRole('agent')` and go through `checkRateLimit` with `RATE_LIMITS.adminAction`, as `portal-link` does.
- The Den read path only ever returns slugs for the caller's own `ctx.links` contacts.

---

## 4. Surfaces

### 4.1 Agency (web + mobile)

**Contact record → "Seller page" card**, shown for any contact that owns at least one non-agent listing (the count is already needed for the Portfolio invite; reuse it).

- Off: "Give this seller a shareable page of their listings" + **Enable**.
- On: the URL, **Copy**, **Share on WhatsApp** (opens `wa.me` with a short message built by `share-message-builder`), **Regenerate link**, **Turn off**.

Web: `src/components/contacts/seller-page-card.tsx`, mounted next to the Portfolio invite in the contact detail. Mobile: same card in `mobile/app/(app)/contact/[id].tsx`, calling the same route through `apiFetch`.

### 4.2 Seller (web + mobile)

**Portfolio overview → "Your public page"** card, one per agency link:

- Enabled: agency name, URL, **Copy**, **Share on WhatsApp**, and "Buyers who open it reach <Agency>".
- Not enabled: "Ask <Agency> to switch on your public page." No self-service enable in this phase.

Web: `src/components/den/dashboard-content.tsx`. Mobile: `mobile/app/(den)/den/index.tsx`. Both read the new `seller_pages` array from `GET /api/den/me`.

### 4.3 What the buyer sees

The agency's showcase in the agency's style, header "A curated collection · <Agency>", the seller's live listings, and the agency's WhatsApp/call CTAs. No seller identity. `noindex`.

---

## 5. Data model

One nullable column on `contacts`; a page is 1:1 with a contact and its only lifecycle is on/off/rotate, so a separate table would add RLS and joins for nothing.

```sql
-- supabase/migrations/<timestamp>_contact_seller_page_slug.sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seller_page_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_seller_page_slug
  ON contacts (seller_page_slug)
  WHERE seller_page_slug IS NOT NULL;
```

- `NULL` = off. Non-null = on, and the value is the public slug.
- Global uniqueness (not per account) is what lets the slug alone name the account.
- Purely additive: apply on push. Existing RLS on `contacts` already governs who can read and write it. Add the column to `DATABASE_SCHEMA.md`.

---

## 6. API

### 6.1 Agency

`src/app/api/contacts/[id]/seller-page/route.ts` (new route; CI Build will run on the PR, which is expected).

| Method | Body | Behaviour | Response |
| --- | --- | --- | --- |
| `GET` | — | Status | `{ data: { enabled, url, listing_count } }` |
| `POST` | `{ rotate?: boolean }` | Enable (mint slug) or, with `rotate`, replace it | `{ data: { enabled: true, url } }` |
| `DELETE` | — | Set slug to `NULL` | `{ data: { enabled: false } }` |

Rules: `requireRole('agent')`, contact must belong to `ctx.accountId`, rate-limited. The URL is built with `accountShowcaseOrigin(db, accountId)` from `src/lib/showcase/account-showcase-url.ts` plus `/seller/<slug>`, so a subdomain account gets its branded host. Minting retries once on a unique-index collision.

### 6.2 Seller

`GET /api/den/me` gains:

```json
"seller_pages": [
  { "account_id": "…", "agency_name": "Acme Realty", "url": "https://acme.convoreal.com/seller/k7m2xq9dpe" }
]
```

Built from `ctx.links` joined to `contacts.seller_page_slug`; links without a slug are omitted, and the client renders the "ask your agency" state for them.

### 6.3 Public

No new public route. `RootPage` reads `sp`; `/api/public/showcase-events` accepts `seller_contact_id`.

---

## 7. Shared logic (`src/lib/`)

| File | Exports | Used by |
| --- | --- | --- |
| `src/lib/showcase/seller-page.ts` | `generateSellerPageSlug()`, `SELLER_PAGE_SLUG_RE`, `sellerPageUrl(origin, slug)`, `filterSellerListings(properties, ids)` | route, den `me`, `page.tsx`, tests |
| `src/lib/showcase/public-data.ts` | `resolveSellerPage(slug)` (React `cache`), `sellerListingIds(accountId, contactId)` (React `cache`) | `page.tsx` |
| `src/lib/den/auth.ts` | `ownerListingFilter(query)` — the `owner_contact_id IN … AND listing_source <> 'agent'` rule, extracted so `resolveOwnerPropertyIds` and `sellerListingIds` share one definition | den routes, showcase |

`mobile/lib/den-api.ts` and `mobile/lib/types.ts` gain the `seller_pages` shape and a `fetchContactSellerPage` / `setContactSellerPage` pair; no rule lives on mobile.

---

## 8. Files touched

| Area | Files |
| --- | --- |
| Migration | `supabase/migrations/<ts>_contact_seller_page_slug.sql`, `DATABASE_SCHEMA.md` |
| Routing | `next.config.ts` (`rewrites()`), `src/app/page.tsx` (`sp` param, resolution branch, metadata `robots: noindex`) |
| Showcase | `src/lib/showcase/seller-page.ts`, `src/lib/showcase/public-data.ts`, `src/components/showcase/showcase-view.tsx` (header label, tracker field) |
| Tracking | `src/app/api/public/showcase-events/route.ts`, `src/lib/pulse/*` (guest-via label), `src/lib/pulse/tracker.ts` |
| Agency web | `src/app/api/contacts/[id]/seller-page/route.ts`, `src/components/contacts/seller-page-card.tsx`, contact detail mount point |
| Agency mobile | `mobile/lib/den-api.ts` or `mobile/lib/contacts-api.ts`, `mobile/app/(app)/contact/[id].tsx` |
| Seller web | `src/app/api/den/me/route.ts`, `src/lib/den/auth.ts`, `src/components/den/dashboard-content.tsx` |
| Seller mobile | `mobile/lib/den-api.ts`, `mobile/app/(den)/den/index.tsx` |
| Records | `FEATURE_MANIFEST.json` (new `seller-page` feature), `CHANGELOG.md`, `README.md` feature list, `docs/property-intake-consolidation.md` cross-reference |

Optional, outside this PR: the Cloudflare Worker may also pin `__tenant` for `/seller/*` so a mismatched host can be 404'd on the wildcard path too. Not required for correctness, because the slug is authoritative.

---

## 9. Feature manifest entry

```text
seller-page — Seller page: a seller's live listings on the agency's showcase
surfaces: web, mobile

SLP-001  A seller page lists only published listings whose owner_contact_id is the
         seller and whose listing_source is not 'agent'; with none live it renders the
         empty state and never the agency's full catalogue.
SLP-002  Every call and WhatsApp CTA on a seller page uses the agency's contact number;
         the seller's phone, name and contact id never reach the client.
SLP-003  Regenerating or turning off a seller page makes the previous URL return 404 on
         the next request.
SLP-004  A seller slug opened under a tenant label that resolves to a different account
         returns 404 rather than that account's catalogue.
SLP-005  Enquiries from a seller page carry the seller as referrer, and showcase events
         carry the seller in via_contact_id, so the owner dashboard and Pulse count them
         without new aggregation.
SLP-006  Only agent-role members can enable, rotate or disable a page; Portfolio shows
         the URL on web and mobile only for links whose contact has a slug.
```

Regression cases: `src/lib/showcase/seller-page.test.ts` (SLP-001, 002 via `filterSellerListings` and the URL/slug helpers), `src/app/api/contacts/[id]/seller-page/route.test.ts` (SLP-003, 006), `src/app/page.seller.test.tsx` or the existing page test file (SLP-001, 004), `src/app/api/public/showcase-events/route.test.ts` (SLP-005), `src/lib/mobile-parity.test.ts` (SLP-006 mobile shape), `mobile/lib/den-api.test.ts` (SLP-006).

---

## 10. Implementation order

1. Migration + `seller-page.ts` helpers + `ownerListingFilter` extraction, with unit tests.
2. `next.config.ts` rewrite + `page.tsx` resolution branch + `noindex` metadata; confirm the client never drops the path.
3. Tracker field and `showcase-events` validation; Pulse guest-via label.
4. Agency route + web card + mobile card.
5. `den/me` extension + web Portfolio card + mobile Portfolio card.
6. Manifest, changelog, schema doc. Full web and mobile validation. PR, apply migration on push, merge on green, verify production by opening a real seller page on a subdomain account and on the bare domain.

---

## 11. Deferred (record in `FEATURE_ROADMAP.md` if not built here)

- Seller-initiated "request my page" that notifies the agency.
- "Opens of your page" tile in Portfolio, from the `metadata.seller_page` open events.
- Optional first-name header ("Rahul's collection") as an agency-controlled toggle.
- Worker change to pin `__tenant` on `/seller/*`.
