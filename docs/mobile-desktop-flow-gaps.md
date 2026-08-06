# Mobile vs Desktop Web — Flow Gap Analysis

Audit of the Expo app (`mobile/`, 27 route files) against the Next.js dashboard (`src/app/(dashboard)/` plus portals), taken 2026-08-05. Re-verify against the code before acting on a specific row; both surfaces move fast.

## Missing entirely on mobile

| Web feature                    | Web surface                                       | Notes                                                                |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| Liaisons                       | `/liaisons`                                       | Directory, jobs & payments, workflows. Zero references in `mobile/`. |
| Requirements screen            | `/contacts?tab=requirements`, `/api/requirements` | Mobile only has requirement fields inside contact detail.            |
| Buyer portal                   | `src/app/(buyer)/buyer/*`                         | Mobile has no `(buyer)` group; only Owners Den.                      |
| Copilot                        | dashboard shell, `/api/copilot`                   | Tours, nudges, Q&A.                                                  |
| Market stats                   | `/dashboard?tab=market`, `/api/market`            | Cross-account market view.                                           |
| Contacts bulk import & merge   | `/contacts` import modals, `/api/contacts/merge`  | Mobile has device-contacts import only.                              |
| Call logs / AI call analysis   | contact detail Calls tab                          | Mobile only fires `tel:` links.                                      |
| Credit top-up / checkout       | settings Credits tab, `/api/create-order`         | Mobile wallet is read-only ("Top up on the web").                    |
| Team & workspace settings      | settings Members/Teams/Routing/WhatsApp setup     | Listed as web-only in `more.tsx`.                                    |
| Team invitations               | `/api/invitations`, `/api/beta-invites`           | —                                                                    |
| Portal import                  | `/api/portal-import`                              | —                                                                    |
| Listing video / YouTube upload | `/api/youtube`                                    | —                                                                    |
| Meta Ads                       | `/inventory?tab=ads`                              | Deliberately excluded ("Post Ad stays web-only").                    |
| Marketplace / match unlocks    | `/api/marketplace`, `/api/match-unlocks`          | —                                                                    |
| Admin panel                    | `/admin`                                          | Super-admin only.                                                    |
| Bug reports                    | `/api/bug-reports`                                | Mobile has only an error boundary.                                   |

## Partial on mobile

| Feature           | Mobile has                                                                      | Missing vs web                                               |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Deals / pipelines | Full deal CRUD (create, edit, delete), stages, counts, value totals, move stage | Assignment, brokerage, non-INR currencies; pipeline creation |
| Property editing  | Full common-field editor (`property-edit.tsx`, requires `?id=`)                 | Property creation; documents; deal terms                     |
| Automations       | On/off toggle                                                                   | Builder, logs, create                                        |
| Flows             | Status list                                                                     | Builder, runs, detail                                        |
| Journey           | Read-only stage list per contact                                                | Mind-map canvas; advance/drop actions                        |
| Owners Den        | Dashboard, bids, settings                                                       | Owner property list/new/detail; deal rooms                   |
| Broadcasts        | List, detail, compose                                                           | Template submission                                          |
| Settings          | Profile, appearance, biometrics, notification prefs                             | Everything workspace-level                                   |

## At parity (or better) on mobile

Inbox + WhatsApp threads (templates incl. media headers, AI suggested replies), contacts CRUD with approve flow, inventory browsing with geo search and native map, property detail + flyers + showcase sharing, Pulse analytics, calendar with voice scheduling, broadcasts, dashboard + pinnable widgets, notifications + per-event channel prefs, biometric lock, OTA updates.

Mobile-only extras: device-contact import, "near me" GPS search, Android/iOS home-screen widgets, voice scheduler.

## Stale docs found during the audit

- `mobile/README.md` "Next" list still names push notifications, media-header templates, property editing, broadcast composing and biometrics as pending — all shipped. Genuinely open from it: offline outbox / pending queue.
- `mobile/RELEASE.md` still lists push as unwired (shipped); crash reporting (Sentry) is genuinely absent.
- `docs/mobile-app-implementation-plan.md` marks Owners Den as out of scope and Journey as deferred; both shipped in reduced form.

## Closed since the audit

- **Match Radar** — `mobile/app/(app)/radar.tsx` (More → Match Radar): event feed, target selection, one-tap send via `/api/radar/send`, dismiss, masked direct-owner cards. Template setup and the deal-mode unlock stay on the web.
- **Todos** — `mobile/lib/todos.ts` + a To-dos section on the Calendar tab: quick-add with priority and due date/time, complete/delete, linked contact/property display. Contact/property mentions stay a web smart-add feature.
- **Today** — `mobile/app/(app)/today.tsx` (More → Today): daily numbers, WhatsApp windows about to close, hot leads going quiet, today's appointments and due to-dos with inline complete. Streak flame and custom date ranges stay web-only.
- **Deal create / edit / delete** — `mobile/app/(app)/deal-edit.tsx`: the + button on Deals opens it empty, tapping a deal card opens it pre-filled. Saves via `POST /api/deals` or `PUT /api/deals/[id]`, deletes via `DELETE /api/deals/[id]` behind a confirm dialog — all three sync the linked property's status server-side. Assignment, brokerage and non-INR currencies stay on the web form.

## Suggested closing order

1. Requirements screen, property creation, Den deal rooms.
2. Larger items (liaisons, buyer portal, call logs, top-up) as separate projects.
