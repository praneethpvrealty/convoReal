# Mobile vs Desktop Web — Flow Gap Analysis

Audit of the Expo app (`mobile/`, 27 route files) against the Next.js dashboard (`src/app/(dashboard)/` plus portals), taken 2026-08-05. Re-verify against the code before acting on a specific row; both surfaces move fast.

## Missing entirely on mobile

| Web feature                    | Web surface                                       | Notes                                                                |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| Today (daily agenda)           | `/dashboard?tab=today`                            | Due follow-ups, appointments, streak, unread jumps.                  |
| Todos                          | Calendar page, `/api/todos`                       | Mobile calendar is appointments-only.                                |
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

| Feature           | Mobile has                                                      | Missing vs web                             |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Deals / pipelines | View stages, counts, value totals; move stage                   | Deal create/edit/delete; pipeline creation |
| Property editing  | Full common-field editor (`property-edit.tsx`, requires `?id=`) | Property creation; documents; deal terms   |
| Automations       | On/off toggle                                                   | Builder, logs, create                      |
| Flows             | Status list                                                     | Builder, runs, detail                      |
| Journey           | Read-only stage list per contact                                | Mind-map canvas; advance/drop actions      |
| Owners Den        | Dashboard, bids, settings                                       | Owner property list/new/detail; deal rooms |
| Broadcasts        | List, detail, compose                                           | Template submission                        |
| Settings          | Profile, appearance, biometrics, notification prefs             | Everything workspace-level                 |

## At parity (or better) on mobile

Inbox + WhatsApp threads (templates incl. media headers, AI suggested replies), contacts CRUD with approve flow, inventory browsing with geo search and native map, property detail + flyers + showcase sharing, Pulse analytics, calendar with voice scheduling, broadcasts, dashboard + pinnable widgets, notifications + per-event channel prefs, biometric lock, OTA updates.

Mobile-only extras: device-contact import, "near me" GPS search, Android/iOS home-screen widgets, voice scheduler.

## Stale docs found during the audit

- `mobile/README.md` "Next" list still names push notifications, media-header templates, property editing, broadcast composing and biometrics as pending — all shipped. Genuinely open from it: offline outbox / pending queue.
- `mobile/RELEASE.md` still lists push as unwired (shipped); crash reporting (Sentry) is genuinely absent.
- `docs/mobile-app-implementation-plan.md` marks Owners Den as out of scope and Journey as deferred; both shipped in reduced form.

## Closed since the audit

- **Match Radar** — `mobile/app/(app)/radar.tsx` (More → Match Radar): event feed, target selection, one-tap send via `/api/radar/send`, dismiss, masked direct-owner cards. Template setup and the deal-mode unlock stay on the web.

## Suggested closing order

1. **Todos** — `/api/todos` already exists; fold into the mobile calendar.
2. **Today** — aggregate screen over data mobile already fetches.
3. Requirements screen, deal create/edit, property creation, Den deal rooms.
4. Larger items (liaisons, buyer portal, call logs, top-up) as separate projects.
