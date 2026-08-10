# Copilot module

The in-app AI helper: floating assistant, deterministic guided tours,
rule-based proactive nudges, and a self-learning Q&A cache. Free for all
subscribers — no credit burn. See
[`docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md`](../../../docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md)
for the web/native split.

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

## Knowledge: chunks + retrieval

App knowledge lives as retrievable chunks in `chunks.ts` — four kinds:
`page` (one per dashboard area; these routes are the `navigateTo` allowlist),
`concept` (cross-cutting ideas like credits or the 24-hour window), `howto`
(task recipes not covered by a tour), and `limit` ("we can't do X, here's the
nearest thing we can" — grounds refusals and keeps `unsupported` phrasing
consistent; source new ones from `copilot_unmet_requests`).

Per question, `retrieval.ts` puts the current page's chunk plus the top-6
scoring chunks into the prompt — nothing else. Scoring is semantic (cosine
against `knowledge-index.gen.ts`, reusing the question embedding the cache
already paid for) with automatic lexical fallback per chunk when the index is
missing or stale, so the helper works before the index is ever generated.

### How to add / edit knowledge

1. Edit `chunks.ts` (2–4 plain sentences per chunk, ≤400 chars).
2. Run `npm run copilot:index` (needs `GEMINI_API_KEY`) and commit the
   regenerated `knowledge-index.gen.ts`.

Guard rails in `chunks.test.ts`: every dashboard area with a `page.tsx` must
have a `page` chunk (new pages fail CI until covered — or are consciously
listed in `UNCOVERED_ROUTES`), and a populated index must match the corpus
exactly (editing a chunk without re-running the script fails CI).

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
`unmet.ts` records it in `copilot_unmet_requests` (migration `236`, **applied
manually in the Supabase SQL Editor**). One row per (account, capability):
repeat asks bump `request_count`, so the table grows with distinct capabilities
rather than with traffic. Cached "we don't do that" answers are re-logged on
every hit, otherwise only the first user to ask would ever be counted.

Grouping relies on the model reusing its own phrasing, so `sanitizeCapability()`
drops anything long, sentence-shaped, or carrying PII rather than storing a key
nothing will match. Ranked backlog:

```sql
SELECT capability_key,
       min(capability)            AS capability,
       count(DISTINCT account_id) AS accounts,
       sum(request_count)         AS asks,
       max(last_requested_at)     AS last_asked
FROM copilot_unmet_requests
GROUP BY capability_key
ORDER BY accounts DESC, asks DESC;
```

## Self-learning cache

`copilot_qa_cache` (migrations `109` and `236`, **applied manually in the
Supabase SQL Editor**) stores validated answers keyed by a 768-dim question
embedding. Similar questions from any user are served after deterministic
validation (similarity ≥ 0.90, matching `KB_VERSION`, live tour/route, current
source chunks, < 90 days, not community-downvoted). Everything is best-effort:
if the table isn't migrated or the service key is missing, lookups/stores fail
silently and the helper falls back to Gemini.
