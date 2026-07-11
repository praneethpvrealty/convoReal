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

## How to add / edit page knowledge

Edit `PAGE_KNOWLEDGE` in `knowledge.ts` (2–4 plain sentences per route). Keep the
whole system prompt under the budget enforced by `knowledge.test.ts`.

> ⚠️ Editing `knowledge.ts` or `tours.ts` rotates `KB_VERSION` (`qa-cache.ts`),
> which intentionally invalidates the entire self-learning cache — old cached
> answers stop being served so stale help content can't be reused. This is by
> design; no manual cleanup is needed.

## How to add a proactive nudge

Add a rule to the `rules` array in `nudges.ts`: a priority, a threshold check
against an existing query loader (`src/lib/today|radar|pulse/queries.ts`) or a
cheap head-count, and template copy with a CTA (`href` or `tourId`). Rules run
under `Promise.allSettled`, so one failing rule never blanks the others.

## Self-learning cache

`copilot_qa_cache` (migration `109_copilot_qa_cache.sql`, **applied manually in the
Supabase SQL Editor**) stores validated answers keyed by a 768-dim question
embedding. Similar questions from any user are served after deterministic
validation (similarity ≥ 0.90, matching `KB_VERSION`, live tour/route, < 90 days,
not community-downvoted). Everything is best-effort: if the table isn't migrated
or the service key is missing, lookups/stores fail silently and the helper falls
back to Gemini.
