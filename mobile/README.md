# ConvoReal Mobile (Android / iOS companion app)

React Native + Expo (SDK 57) companion app for the ConvoReal web Engine, per
[`docs/mobile-app-implementation-plan.md`](../docs/mobile-app-implementation-plan.md).
This directory is a self-contained npm project inside the monorepo — see the
plan's "Repository Strategy" section for why the app lives here and not in a
separate repo.

## Current state (Phase 1 complete; Phases 2–4 substantially shipped)

Status re-audited against the codebase on 2 September 2026.

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
- ✅ **Property inventory and editing** — list via the web's `GET /api/properties`
  (inherits its natural-language + geo search), listing-type filters,
  infinite scroll, image cards; detail screen with photo pager, specs
  grid, features, owner link and Google Maps. The native edit flow covers
  listing details, amenities, ownership, photos, videos, floor plans and
  commercial tenancy data while preserving web/API validation.
- ✅ **Location suite (mobile-first)** — "Near me" GPS radius search
  (2/5/10/25 km chips, distance badges + exact/nearby tiers from the
  API), Google locality autocomplete in the search box (same
  `/api/maps/autocomplete` + `place-details` proxies as the web — the
  Google key never leaves the server; degrades to text search if the
  key isn't configured), a native map of the current results with pins
  (tap pin → property), and a mini-map on the property detail.
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
- ✅ **Broadcasts** — campaign list with live delivery/read progress
  (auto-polls while sending), per-recipient status filters, and native
  compose/send for approved templates with all-contacts or tag-based
  audiences. CSV upload and custom-field audience filters remain web-only.
  Note: RLS is user-scoped — you see campaigns you created.
- ✅ **Automations & Flows** — toggle your automations on/off (via the
  validating API route) and see flow statuses; builders stay web-only.
- ✅ **Journeys (read-only)** — every buyer's per-property stage list from
  the same rows the web mind map renders; canvas stays web-only.
- ✅ **Optional biometric app lock** — Face ID/fingerprint enrollment and
  unlock gate, backed by the device's native authentication APIs.
- 🟡 **Push-notification foundation** — permission handling, Expo device-token
  registration, server-side storage/delivery and invalid-token cleanup are
  implemented. Remote push requires an installed EAS build; notification-tap
  routing is still pending, and iOS delivery awaits valid signing/APNs
  credentials.
- ✅ **Full dark-mode support** across every screen (system scheme).
- ✅ **Design language: "aurora glass"** (spec:
  `docs/design/GLASS_UI_IMPLEMENTATION_SPEC.md`, mockups:
  `docs/design/ui-directions.html`). Light = Option 7 "WhatsApp Native
  on Glass" (WhatsApp deep-green `#075E54` + bright green, Inter, frosted
  white glass over a daylight aurora); dark = Option 4 "Liquid Glass"
  (lime `#C6F68D` on deep forest aurora, Plus Jakarta Sans). The aurora
  ships as pre-baked images (`assets/images/aurora-*.png`, regenerate via
  `python3 scratch/gen_aurora.py`); real `BlurView` only on floating bars
  (tab bar, composer, sticky bottom bars) — cards use the translucent
  glass fill so lists stay 60fps. Plus: staggered list entrances + press
  physics (reanimated), haptic vocabulary (`lib/haptics.ts`), shimmer
  skeletons, solid-ring HOT-lead avatars, photo-first property cards,
  animated stat counters + gradient hero on Overview, confetti when a
  deal closes Won, branded app icon/splash
  (`node scripts/generate-icons.js` — still the old forest palette;
  regenerate when rebranding the launcher).
- ⏳ **Remaining roadmap gaps:** pending-message outbox for offline sends;
  media-header template sending; push-notification tap deep links;
  multi-account switching; formal cross-device/store release checks; and
  iOS signing/APNs, TestFlight and App Store release completion.

## Running it

```bash
cd mobile
npm install
cp .env.example .env   # fill in Supabase URL/anon key + web app base URL
npm start              # scan the QR code with Expo Go on Android
```

Expo Go is enough for non-push development in Phases 1–2. The project tracks the
**latest stable SDK (57)** — the same one the current Expo Go supports.
Caveat learned the hard way: the Play Store sometimes serves a stale
Expo Go build; if the app under Settings shows a "Supported SDK" older
than 57, install the latest Expo Go APK directly from
[expo.dev/go](https://expo.dev/go). Remote push notifications require an
installed EAS development, preview or production build — Expo Go dropped
remote push support on Android in SDK 53+. Android preview builds are
available; iOS builds remain blocked until signing/APNs credentials are
configured in EAS.

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

## Deep links

`app/+native-intent.ts` rewrites incoming links to app screens, covering
the web's URL shapes: `?property_id=` / `?propertyId=` → property,
`?contactId=` → contact, `?c=` → conversation, plus `/inventory`,
`/pipelines`, `/calendar`, `/journey`, `/broadcasts`, `/settings` and
SEO listing URLs (`/property/<slug>-<uuid>` → property).

- **Scheme links work now**: `convoreal://property/<id>` (test in dev:
  `npx uri-scheme open "exp://<lan-ip>:8081/--/property/<id>" --android`).
- **https links** are Android App Links / iOS Universal Links: the
  intent filters and associated domains are declared in `app.json`, and
  the web serves `/.well-known/assetlinks.json` +
  `apple-app-site-association` — env-gated on
  `ANDROID_APP_CERT_SHA256` / `APPLE_TEAM_ID`. They activate with the
  first EAS build (OS verification needs the real signing cert; Expo Go
  can never claim your domain).
- **Only Engine-staff paths are claimed** (`/inventory`, `/pipelines`,
  `/contacts`, `/calendar`, `/journey`, `/broadcasts`, `/settings`,
  `/dashboard` — the same list in the Android intent filter and the
  AASA route). Public showcase URLs — `/`, `/?property_id=…`,
  `/property/<slug>`, `/projects/*`, `/farmland/*`, `/list` — are
  deliberately unclaimed: the app shell is auth-gated, so a buyer with
  the app installed would hit a login screen instead of the listing.
  OS link matching cannot see query strings, so the split is by path —
  `/` stays with the browser, and links that must open the app
  regardless (notifications, in-app shares to staff) use the
  `convoreal://` scheme. Adding a new app screen that should catch its
  web URL means adding its path prefix to BOTH lists.

### Activating Android App Links in production

The code above is inert until every step here is done — an empty
`assetlinks.json` (`[]`) means Android silently keeps opening links in
the browser.

1. Get the SHA-256 signing-cert fingerprint(s). For Play Store installs
   use the **App signing key certificate** from Play Console → Test and
   release → Setup → App signing (NOT the upload key — Google re-signs
   the app). For direct-APK installs use the fingerprint from
   `eas credentials` (Android → production → Keystore). If both install
   paths exist, include both.
2. Set `ANDROID_APP_CERT_SHA256` in the web host's production env to the
   colon-separated hex fingerprint(s), comma-separated if several, and
   redeploy the web app.
3. Verify: `curl https://www.convoreal.com/.well-known/assetlinks.json`
   must return a non-empty statement list with a 200 — no redirect. The
   apex `convoreal.com` currently 308-redirects to `www` at the hosting
   layer, which verifiers refuse to follow; that is why only
   `www.convoreal.com` is declared in the Android intent filter.
4. Rebuild the app with EAS and reinstall it — intent filters bake into
   the native manifest, and Android runs domain verification at
   install/update time, not via OTA updates.
5. Check on-device:
   `adb shell pm get-app-links com.convoreal.app` should show
   `www.convoreal.com: verified`. Force a re-check with
   `adb shell pm verify-app-links --re-verify com.convoreal.app`, then
   test with a claimed Engine path:
   `adb shell am start -a android.intent.action.VIEW -d "https://www.convoreal.com/inventory"`
   (must open the app) and an unclaimed showcase link:
   `adb shell am start -a android.intent.action.VIEW -d "https://www.convoreal.com/?property_id=<id>"`
   (must open the browser).

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
