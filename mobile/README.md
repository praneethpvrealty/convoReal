# ConvoReal Mobile (Android / iOS companion app)

React Native + Expo (SDK 57) companion app for the ConvoReal web CRM, per
[`docs/mobile-app-implementation-plan.md`](../docs/mobile-app-implementation-plan.md).
This directory is a self-contained npm project inside the monorepo — see the
plan's "Repository Strategy" section for why the app lives here and not in a
separate repo.

## Current state (Phase 1 complete + rich UI pass)

- ✅ **WhatsApp OTP sign-in** (primary) — `signInWithOtp({ phone,
  shouldCreateUser: false })` delivered over WhatsApp by the existing
  Send-SMS hook, with a 6-digit code UI and resend timer; email/password
  as fallback. Mobile-first: the web has no OTP login.
- ✅ **Native phone-verification gate** (`phone_confirmed_at`, migration
  137) — full in-app OTP flow (`updateUser` → `verifyOtp('phone_change')`),
  mirroring the web's `WhatsappPhoneVerify` semantics.
- ✅ Session in secure storage (AES key in Keychain/Keystore, ciphertext in
  AsyncStorage — `lib/secure-store.ts`).
- ✅ **Rich inbox** — search, status/unread filter chips, live AI-credits
  chip (realtime `credit_wallets`), skeleton loaders, deterministic-hue
  avatars, Name Tags, unread badges; Supabase Realtime + TanStack Query
  persisted to AsyncStorage for offline reads.
- ✅ **WhatsApp-style thread** — day separators, delivery ticks
  (✓/✓✓/blue read), failed-send surfacing with the API's error message
  (24-hour-window aware), bot-message marker, image rendering through the
  auth-gated media proxy with expired-media placeholder, mark-as-read on
  open.
- ✅ Contacts with classification colors, call + WhatsApp deep links, and a
  detail card with edit mode; search covers names, phones, tags, notes,
  company and requirements (web parity).
- ✅ **Property inventory** — list via the web's `GET /api/properties`
  (inherits its natural-language + geo search), listing-type filters,
  infinite scroll, image cards; detail screen with photo pager, specs
  grid, features, owner link and Google Maps.
- ✅ **Deals** — mobile take on the kanban: pipeline switcher, stage strip
  with counts, per-stage value totals, move-stage sheet with the same
  status + property-status side effects as the web board.
- ✅ **Calendar** — upcoming appointments grouped by day, complete/cancel
  actions, and a create form (type, date/time, location, contact picker)
  inserting the same row shape as the web's schedule dialog (WhatsApp
  reminders are cron-driven off the row).
- ✅ **Template sending** in the thread — approved-template picker with
  {{n}} variable form and live preview; the answer to WhatsApp's
  24-hour service window. Text-header templates only in v1.
- ✅ **Overview dashboard** — today's unread/messages/appointments, pipeline
  value, hot leads, available listings (RLS-scoped count queries).
- ✅ **Broadcasts (view)** — campaign list with live delivery/read progress
  (auto-polls while sending) and a per-recipient detail with status
  filters. Note: RLS is user-scoped — you see campaigns you created.
- ✅ **Automations & Flows** — toggle your automations on/off (via the
  validating API route) and see flow statuses; builders stay web-only.
- ✅ **Journeys (read-only)** — every buyer's per-property stage list from
  the same rows the web mind map renders; canvas stays web-only.
- ✅ **Full dark-mode support** across every screen (system scheme).
- ✅ **Design language pass** — brand gradient (violet → fuchsia) identity,
  floating blur pill tab bar, staggered list entrances + press physics
  (reanimated), haptic vocabulary (`lib/haptics.ts`), shimmer skeletons,
  Instagram-style HOT-lead story rings in the inbox, full-bleed photo
  property cards with gradient scrims, animated stat counters + gradient
  hero on Overview, confetti when a deal closes Won, and a branded app
  icon/splash (regenerate via `node scripts/generate-icons.js`).
- ⏳ Next: pending outbox (offline queue), push notifications (needs
  `device_push_tokens` + worker dispatch — not yet in the web repo),
  media-header templates, property editing, broadcast composing, biometrics.

## Running it

```bash
cd mobile
npm install
cp .env.example .env   # fill in Supabase URL/anon key + web app base URL
npm start              # scan the QR code with Expo Go on Android
```

Expo Go is enough for everything in Phase 1–2. The project tracks the
**latest stable SDK (57)** — the same one the current Expo Go supports.
Caveat learned the hard way: the Play Store sometimes serves a stale
Expo Go build; if the app under Settings shows a "Supported SDK" older
than 57, install the latest Expo Go APK directly from
[expo.dev/go](https://expo.dev/go). Remote push notifications (Phase 3)
will require an EAS development build — Expo Go dropped remote push
support on Android in SDK 53+.

- `npm run typecheck` — TypeScript
- `npm run lint` — expo lint

## Layout

```
app/                    # expo-router file-based routes
  (auth)/login.tsx      # signed-out stack
  (app)/                # signed-in stack (guards: session + verified phone)
    (tabs)/             # Inbox / Contacts / Settings
    conversation/[id]   # message thread + composer
    verify-phone.tsx    # migration-137 gate
lib/
  supabase.ts           # shared Supabase client (RLS-scoped, auto-refresh)
  api.ts                # bearer-authenticated /api/* fetcher + typed wrappers
  auth-store.ts         # zustand session/profile store + auth listener
  query.ts              # TanStack Query client + AsyncStorage persister
  secure-store.ts       # LargeSecureStore (SecureStore 2KB limit workaround)
  types.ts              # trimmed mirrors of src/types (same column names)
```

## `npm audit` noise

`npm install` reports ~11 moderate vulnerabilities. All of them root at
`uuid` inside Expo's **local dev toolchain** (`@expo/cli` logging), which
runs on a developer's machine during `expo start`/builds. None of that
code is bundled into the app users install — the other flagged packages
are only npm chaining "depends on a vulnerable version of" back to that
root.

**Do not run `npm audit fix --force`** — npm's only offered fix is a
major Expo SDK jump, a breaking upgrade that must be done deliberately
(new RN version, new Expo Go), not as an audit side effect. Revisit on
the next planned SDK bump.

## Conventions

- Direct table **reads** use the Supabase client (RLS scopes them);
  anything that touches WhatsApp or business logic goes through the
  Next.js API with a bearer token (`lib/api.ts`).
- Realtime channel names are account/user/conversation-scoped
  (`conversations:{accountId}:{userId}`, `messages:{conversationId}`) per
  the implementation plan.
- `messages.media_url` is a RELATIVE path — always resolve with
  `absoluteMediaUrl()` and fetch with `authHeaders()`.
