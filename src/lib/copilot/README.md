# Copilot module

The in-app AI helper: floating assistant, deterministic guided tours,
rule-based proactive nudges, and a self-learning Q&A cache. Free for all
subscribers — no credit burn. See
[`docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md`](../../../docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md)
for the web/native split.

## Platform awareness (mobile)

The Expo app calls the same `/api/copilot` route with `platform:
'mobile'`. The scaffold then appends the app's page directory
(`platform.ts`) and the contract adds a required `coverage` verdict:

- `full` — doable in the app; if a tour has `mobileSteps` the app offers
  to run it natively.
- `web_only` — the answer names the desktop page and the app renders an
  "open on desktop" link (`webUrl`).
- `partial` / `none` — the app offers the help desk: a `support_tickets`
  row (migration 242) filed via `/api/copilot/support-ticket`, triaged
  at Admin → Support, answered back over WhatsApp (platform sender) or
  email.

The web scaffold is byte-identical to before, so the agent KB version —
and every cached web answer — survives. Mobile answers hash to their own
KB version and cache in their own partition, carrying `coverage` on the
row. Tours declare mobile support via `mobileSteps` in `tours.ts`; the
app's hand-ported copy (`mobile/lib/copilot-tours.ts`) is drift-guarded
by `src/lib/mobile-parity.test.ts`.

## Cost model

AI is used only for genuinely novel free-form questions. Tours, nudges, and
common "how do I…" questions never call Gemini, and repeat questions are served
from the semantic cache. Ceilings live in `RATE_LIMITS.copilot*`
(`src/lib/rate-limit.ts`). Global kill switch: `NEXT_PUBLIC_COPILOT_ENABLED=false`.

## How to add a guided tour

1. **Add a step target** — put `data-tour="my-target"` on the element the step
   should spotlight (a nav link, a button, a section). Prefer a stable element
   that's present whenever the step's route is active.
2. **Add the tour** to `TOURS` in `tours.ts`: an `id`, `title`, `description`,
   `triggers` (EN/Hindi/Hinglish regexes the intent matcher uses to launch it
   without AI), and ordered `steps`. The first step must be reachable from
   anywhere (`route: '/'`, `routeMatch: 'prefix'`, usually `requiresSidebar: true`).
   Step fields: `route`, optional `query`, `target`, `title`, `body`, `advanceOn`
   (`'click-target' | 'next' | 'route-change'`), and optional
   `skipIfNextRouteActive` for nav steps.
3. **Nothing else** — the tour appears in the helper's Guides list and the AI tour
   catalog automatically, and `tours.test.ts` enforces the registry invariants.

## Three audiences, one engine

The helper answers three different products from one codebase:

| Audience | Surface | Route | Mounted by |
|---|---|---|---|
| `agent` | staff dashboard | `/api/copilot` | `CopilotWidget` (tours + nudges) |
| `owner` | Portfolio (owners) | `/api/den/copilot` | `PortalHelper` |
| `buyer` | Portfolio (buyers) | `/api/buyer/copilot` | `PortalHelper` |

Each route does its own auth — staff resolve an account, portals resolve a
Den/Buyer context — then calls the shared engine (`engine.ts`). Portals get no
tours (they spotlight dashboard elements) and no nudges (they query staff data),
so `PortalHelper` is a deliberately lean widget rather than a fork of
`CopilotWidget`.

**Audience separation is enforced three ways**, because an owner must never be
answered out of the agent corpus: retrieval filters chunks by audience, the
route allowlist is per-audience (`navigateTo` can't cross surfaces), and the
shared answer cache is partitioned by KB version — the three scaffolds differ,
so their hashes differ, and `match_copilot_qa` can't return the wrong one. That
last one is a property of the data rather than a filter someone has to remember.

## Knowledge: chunks + retrieval

App knowledge lives as retrievable chunks in `chunks.ts` — four kinds:
`page` (one per area of a surface; these routes are the `navigateTo` allowlist),
`concept` (cross-cutting ideas like credits or the 24-hour window), `howto`
(task recipes not covered by a tour), and `limit` ("we can't do X, here's the
nearest thing we can" — grounds refusals and keeps `unsupported` phrasing
consistent; source new ones from `copilot_unmet_requests`).

Every chunk carries an `audience` (defaulting to `agent`). A chunk belongs to
exactly one — say a shared idea twice, in each audience's own words, rather
than writing one paragraph that hedges for all three.

Per question, `retrieval.ts` puts the current page's chunk plus the top-6
scoring chunks into the prompt — nothing else. Scoring is semantic (cosine
against `knowledge-index.gen.ts`, reusing the question embedding the cache
already paid for) with automatic lexical fallback per chunk when the index is
missing or stale, so the helper works before the index is ever generated.

### How to add / edit knowledge

1. Edit `chunks.ts` (2–4 plain sentences per chunk, ≤400 chars).
2. Run `npm run copilot:index` (needs `GEMINI_API_KEY`) and commit the
   regenerated `knowledge-index.gen.ts`.

Guard rails in `chunks.test.ts`: every area with a `page.tsx` on **any** mounted
surface — dashboard, owner portal, buyer portal (the `SURFACES` table) — must
have a `page` chunk for that audience, so a new page anywhere fails CI until
covered or consciously listed in `UNCOVERED_ROUTES`. Every audience must also
own at least one `limit` chunk, or it cannot refuse anything honestly. And a
populated index must match the corpus exactly (editing a chunk without
re-running the script fails CI).

### Cache invalidation is two-tier

Each cached answer records the chunk versions it was built from
(`source_chunks`); editing a chunk retires only the answers that used it.
Changing the prompt scaffold — rules, page directory, tours, output contract —
rotates `KB_VERSION` and retires everything. No manual cleanup either way.

## How to add a proactive nudge

Add a rule to the `rules` array in `nudges.ts`: a priority, a threshold check
against an existing query loader (`src/lib/today|radar|pulse/queries.ts`) or a
cheap head-count, and template copy with a CTA (`href` or `tourId`). Rules run
under `Promise.allSettled`, so one failing rule never blanks the others.

## Unmet requests (demand signal)

When a user asks for something ConvoReal cannot do, the model names the missing
capability in a short canonical phrase (`unsupported` in the JSON contract) and
`unmet.ts` records it in `copilot_unmet_requests` (migrations `236` and `238`,
**applied manually in the Supabase SQL Editor**). One row per
(account, audience, capability) — an owner asking for something is a different
product signal from an agent asking for it. Repeat asks bump `request_count`,
so the table grows with distinct capabilities rather than with traffic. Cached "we don't do that" answers are re-logged on
every hit, otherwise only the first user to ask would ever be counted.

Grouping relies on the model reusing its own phrasing, so `sanitizeCapability()`
drops anything long, sentence-shaped, or carrying PII rather than storing a key
nothing will match.

The ranked backlog is rendered at **Admin → Demand** (super-admin only,
`/api/admin/copilot-demand`), or straight from Studio:

```sql
SELECT audience,
       capability_key,
       min(capability)            AS capability,
       count(DISTINCT account_id) AS accounts,
       sum(request_count)         AS asks,
       max(last_requested_at)     AS last_asked
FROM copilot_unmet_requests
GROUP BY audience, capability_key
ORDER BY accounts DESC, asks DESC;
```

## Self-learning cache

`copilot_qa_cache` (migrations `109` and `236`, **applied manually in the
Supabase SQL Editor**) stores validated answers keyed by a 768-dim question
embedding. Similar questions from any user of the same audience are served
after deterministic validation (similarity ≥ 0.90, matching KB version, live
tour/route, current source chunks, < 90 days, not community-downvoted). Everything is best-effort:
if the table isn't migrated or the service key is missing, lookups/stores fail
silently and the helper falls back to Gemini.
