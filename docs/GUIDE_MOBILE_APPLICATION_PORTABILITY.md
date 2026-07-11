# Copilot Helper — Mobile Application Portability Guide

How the in-app AI helper (floating assistant, guided tours, proactive nudges,
self-learning Q&A) carries over to the planned **React Native + Expo** companion
app (see [`mobile-app-implementation-plan.md`](./mobile-app-implementation-plan.md)).

## TL;DR

The helper is deliberately split into a **platform-neutral brain** and a **thin
web renderer**. Everything intelligent — the knowledge base, tour *content*,
intent matching, proactive-nudge rules, and the self-learning answer cache — is
either server-side or pure TypeScript and **ports to mobile with zero or near-zero
change**. Only the tour *spotlight rendering and element targeting* is built on
browser DOM APIs and must be reimplemented natively. That's ~2 files' worth of
logic, and the concepts map one-to-one to React Native primitives.

You have **not** been locked into anything web-only. The expensive, valuable
parts are shared automatically across web and mobile.

## The portability boundary

| Layer | File(s) | Mobile status |
|---|---|---|
| Chat + tour-routing API | `src/app/api/copilot/route.ts` | ✅ Reuse as-is (HTTP JSON) |
| Nudges API | `src/app/api/copilot/nudges/route.ts` | ✅ Reuse as-is |
| Feedback API | `src/app/api/copilot/feedback/route.ts` | ✅ Reuse as-is |
| Self-learning cache + pgvector | `src/lib/copilot/qa-cache.ts`, migration 109 | ✅ Server-side; web + mobile share one learning store |
| Knowledge base | `src/lib/copilot/knowledge.ts` | ✅ Server-side; single source of truth |
| Intent matcher | `src/lib/copilot/intent.ts` | ✅ Runs server-side inside the API |
| Nudge rules | `src/lib/copilot/nudges.ts` | ✅ Server-side |
| Tour **registry** (steps, copy, order) | `src/lib/copilot/tours.ts` | ✅ Reuse as a shared contract (read fields abstractly — see below) |
| Tour **engine** (state machine) | `src/components/copilot/copilot-context.tsx` | ♻️ Reimplement natively |
| Spotlight **overlay** (cutout + tooltip) | `src/components/copilot/tour-overlay.tsx` | ♻️ Reimplement natively |
| `data-tour` attributes on components | sidebar, contacts, inventory, etc. | ♻️ Re-attach as component refs |
| Floating button, chat panel, nudge bubble UI | `copilot-widget.tsx`, `copilot-panel.tsx` | ♻️ Rebuild (standard web→native UI work) |

"Reimplement/rebuild" here is the same work any web→native port requires for UI —
it is **not** rework of business logic.

## Why the tour engine is the only entangled piece

The web tour engine leans on browser-only APIs that have no React Native
equivalent:

- `document.querySelectorAll('[data-tour="…"]')` — DOM element lookup
- `getBoundingClientRect()` — element geometry
- `MutationObserver` — waiting for async page content to render
- capture-phase `document.addEventListener('click', …, true)` — advancing on tap
- CSS `box-shadow: 0 0 0 9999px …` — the spotlight dimming/cutout
- `usePathname()` / `useSearchParams()` from `next/navigation` — route matching

Everything else in the helper avoids the DOM entirely, which is why it travels.

## Native reimplementation blueprint (Expo / React Native)

The concepts map directly. A mobile engineer rebuilds the *mechanism*, not the
*design*:

**1. Target registry instead of `data-tour` attributes.**
Web resolves a step's `target` string (e.g. `"add-contact"`) to a DOM node. Native
keeps a `Map<string, ref>` that screens populate on mount:

```tsx
// native: register the same identifiers the web uses as data-tour values
const { registerTourTarget } = useTourTargets();
<Pressable ref={(r) => registerTourTarget("add-contact", r)} onPress={openAddForm}>
```

Get geometry with `ref.measureInWindow((x, y, w, h) => …)` (or `onLayout`) in
place of `getBoundingClientRect()`.

**2. SVG mask instead of the CSS cutout.**
Render the dim + hole with `react-native-svg` (a full-screen semi-transparent
`Rect` with a `Mask` punching out the target rect), or adopt an existing library
(`rn-tourguide`, `react-native-spotlight-tour`, `react-native-copilot`) and feed
it the step list.

**3. React Navigation screen names instead of pathnames.**
A step's `route` becomes a screen name; `query` params (used by the
`check-property-views` tour's `?tab=pulse`) become route params. Advance when the
active screen matches, exactly as the web engine waits for `usePathname()` to
match.

**4. Direct `onPress` handlers instead of a document click listener.**
For `advanceOn: 'click-target'` steps, wrap the target's press handler to also
call `advance()` — no global listener needed.

**5. Mobile ergonomics are already assumed by the content.**
Tour copy is short and finger-friendly, and the web version already docks tooltips
to the bottom on small screens — the native tooltip should do the same.

## Reading `tours.ts` as a cross-platform contract

The registry is portable **if each field is read as an abstraction**:

- `target` → an **element id** (a `data-tour` value on web; a ref key on native — same string)
- `route` → a **screen id** (a URL pathname on web; a navigator screen name on native)
- `query` → **screen params** (URL search params on web; route params on native)
- `requiresSidebar` → "open the primary nav first" (a drawer on web; whatever the native nav is)
- `title` / `body` / `advanceOn` / `skipIfNextRouteActive` → fully platform-neutral

Keep `tours.ts` as the single definition consumed by both clients. Do **not** fork
it; if a native screen can't host a step, add a platform flag to the step rather
than duplicating the list.

## API auth caveat (one shared workstream)

The copilot endpoints authenticate via `getCurrentAccount()`, which today reads
the Supabase session from **cookies** (web SSR). The mobile app is token-based, so
these routes depend on the **Bearer-token support already flagged as REQUIRED** in
the mobile plan's "Critical Workstreams (Web Repo)" section. Once that lands,
`/api/copilot`, `/api/copilot/nudges`, and `/api/copilot/feedback` work from the
native client unchanged — no copilot-specific auth work.

## What the mobile team should NOT do

- **Don't** reimplement the knowledge base, intent matcher, or nudge rules on the
  device — they run inside the API. The mobile app sends `{ message, pathname,
  history }` and renders `{ reply, tourId?, navigateTo?, cached?, cacheId? }`.
  (`pathname` can be the current screen id.)
- **Don't** stand up a separate answer cache. The self-learning store is global
  and server-side, so mobile questions warm the same cache web users benefit from,
  and vice-versa — it gets cheaper across both platforms together.
- **Don't** hardcode tour steps in native code — consume `tours.ts` (ship it in a
  shared package, or expose it via a tiny read-only endpoint if the codebases are
  separate).

## Mobile port checklist

- [ ] Bearer-token auth on the three copilot API routes (shared workstream)
- [ ] `useTourTargets()` registry + `registerTourTarget(id, ref)` on screens
- [ ] Native tour engine: screen-match + target-measure + advance (port of `copilot-context.tsx`)
- [ ] SVG spotlight + tooltip component (port of `tour-overlay.tsx`)
- [ ] Floating button, chat panel, nudge bubble as native components calling the same APIs
- [ ] Map each `tours.ts` step `route` → navigator screen; verify all 5 tours
- [ ] 👍/👎 feedback wired to `/api/copilot/feedback`
- [ ] Consume `tours.ts` / `knowledge.ts` from a shared location (no fork)
