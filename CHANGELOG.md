# Changelog

User-visible changes in `wacrm`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0, `MINOR` bumps cover new modules; `PATCH` bumps cover bug fixes
and polish.

## [Unreleased]

### Changed

- **Settings navigation: "More" menu + edge fades on phones.** The
  Billing and Workspace tab clusters (Billing, Credits, Showcase, AI
  Config, Other, Members/Teams/Routing) collapse into a single
  "More" dropdown on phones, halving the tab bar's width; when the
  active tab lives inside it, the trigger adopts that tab's icon,
  label, and highlight so your location stays visible. Both tab bars
  also gained gradient edge fades that appear only while more tabs
  continue past that edge. Desktop shows every tab inline, unchanged.
  Also hardened the Credits tab's Referral card, which crashed the
  whole Settings page ("Something went wrong") whenever its API call
  failed — it now shape-checks the response and degrades to a toast.

- **Settings tab bars scroll instead of wrapping on phones.** The
  main Settings navigation (Profile … Other) and the WhatsApp
  sub-tabs (Connection / Templates / Flows / Owner Digest) wrapped
  into ragged multi-line rows on narrow screens, with orphaned group
  dividers stranded at row starts. Both are now single-row,
  horizontally scrollable bars with hidden scrollbars; the active
  pill auto-scrolls into view on load and on tab change, so deep
  links like `?tab=showcase` never land with the selection
  off-screen. Desktop layout is unchanged.

### Fixed

- **Table loaders center on screen, not off it.** The Contacts table's
  loading and empty states (and the admin page's empty states) lived
  inside a `colSpan` cell of a horizontally-scrolling table, so on
  mobile they centered against the full multi-viewport-wide table and
  rendered mostly off the right edge of the screen. They now render
  outside the scroll surface (the pattern the Broadcasts and Ads
  pages already used) and center within the visible viewport at any
  width.

### Changed

- **Flows recover when customers go off-script.** Three fixes to the
  conversation-flow engine, found watching a real seller lead derail:
  (1) tapping a button on an *earlier* message (e.g. "List My
  Property" on the welcome bubble after already tapping "Buy
  Property") now switches to that button's branch instead of
  re-sending the current branch's prompt; (2) free text the flow
  can't parse ("80000 rented house three floor building near
  devanahalli") is saved onto the contact's Requirements note so the
  agent who picks up the handoff sees it instead of losing it; (3)
  reprompts now say "Sorry, I didn't quite catch that — please tap
  one of the options below 👇" instead of repeating the branch intro
  verbatim, which read like the bot ignoring the customer.

- **Dashboard "Active Users" no longer shows the owner or yourself.**
  The widget is titled "Live agent & client statuses" but listed
  every profile in the account — including the account owner (with a
  synthetic "Reviewing Analytics" activity label) and the viewer's
  own row, sometimes duplicated when the phone-match signup path had
  created two profile rows. It now skips the current viewer and any
  owner-role profile, and collapses duplicate rows for the same auth
  user. Agents and recently-active clients are unaffected.

- **Default reminder templates for every account + manager-only
  template management.** Every account — including ones created in
  the future — now starts with the four appointment/property-visit
  reminder templates as ready-to-submit DRAFTs (an `AFTER INSERT`
  trigger on `accounts` seeds them; existing accounts are
  backfilled idempotently). Managing templates (New Template, Sync
  from Meta, Submit, Edit, Resubmit, Delete) is now restricted to
  the **Organization Manager**: enforced in the API routes
  (`requireOrgRole('org_manager')`), at the database (RLS write
  policies on `message_templates` tightened from leader-rank to
  manager-rank), and in the Settings UI, where non-managers see a
  read-only template catalog. **Migration required:**
  `146_default_templates_and_manager_gate.sql`. Note: the one-click
  "enable template" buttons in Radar / Showcase / Owner Digest also
  submit templates, so they now require the manager as well — other
  roles get a clear "Only the Organization Manager can perform this
  action" error.

### Fixed

- **Reminder templates no longer end with a variable — Meta submits
  succeed.** All four appointment-reminder templates ended with
  "Regards, `{{5}}`." / "Kind regards, `{{6}}`.", which Meta rejects
  with "Variables can't be at the start or end of the template" —
  trailing punctuation after a variable doesn't satisfy the rule.
  The bodies now name the sender mid-sentence ("a friendly reminder
  from `{{n}}` …") and close on a static call-to-action that points
  at the Confirm / Reschedule quick-reply buttons. **Migration
  required:** `145_reminder_template_trailing_variable_fix.sql`
  (rewrites the four DRAFT bodies, seeds the missing
  `property_visit_reminder` sample values, clears the stale
  submission error). The template validator now catches
  punctuation-wrapped leading/trailing variables at save time with a
  field-level error instead of letting the submit fail at the Meta
  API.

### Added

- **Theme re-grade: premium neutral dark + airy light.** Dark mode
  moves off Tailwind's blue-tinted slate onto a near-black neutral
  palette (graphite cards on `#0b0b0e`, desaturated greys — the
  accent theme's `--primary` stays the only strong color), and light
  mode gets an airier off-white grade with pure-white cards and
  softer borders. Global corner radius bumped to 0.75rem for the
  rounder card look. Both applied through the same
  `html[data-mode="…"]` variable blocks, so every page restyles at
  once; the Journey canvas's JS-side colors follow suit.

- **Light mode, app-wide.** A sun/moon toggle in the header switches
  the whole CRM between the original dark look and a new light theme
  (persisted per device, synced across tabs, no flash on load — the
  existing accent-theme boot script now applies `data-mode` too).
  Light mode is an orthogonal axis on top of the 5 accent themes:
  the accent keeps supplying `--primary`, while
  `html[data-mode="light"]` in `globals.css` flips every neutral —
  the shadcn tokens AND the slate utility ramp (Tailwind v4 color
  variables, so the thousands of hardcoded `bg-slate-900`-style
  classes invert without touching components). Accent text tuned for
  dark backgrounds (`text-emerald-300` etc.) is remapped to darker
  steps for contrast on white. The Journey canvas's JS-side colors
  (edges, background dots, minimap mask, edge labels) follow the mode
  via `useTheme`, and the toast stack restyles to match.

- **Journey: planned next steps with expected timelines**
  (**migration required**: `142_journey_planned_steps.sql`) — an
  active property/contact on the journey can now carry its expected
  next move: pick the stage and the date in the item's detail sheet
  ("Plan next step…"), and the mind map grows a **ghost card** at that
  stage's column — dashed outline, muted, visibly not-reached-yet —
  connected to the current card by a **grey dotted line labelled with
  the timing** ("In 25 days", "Tomorrow", "Today", or an amber
  "3 days overdue" once it slips). The ghost's column appears even if
  no item has reached that stage yet. Advancing or moving the item
  clears the plan automatically (it was for that move); plans can also
  be edited or cleared from the sheet, and 'planned'/'plan_cleared'
  events land in the item timeline. New columns:
  `journey_items.planned_stage_id`, `journey_items.planned_at`.

- **Journey canvas: corner cleanup.** The minimap now renders only on
  maps with 10+ nodes, hides on phones, sits top-right, and tints
  nodes by status/stage color (it used to be a large near-empty box
  fighting the floating AI widget for the bottom corner). The
  Active/Dropped legend shrank, moved next to the zoom controls, and
  only appears once something has been dropped.

### Fixed

- **Mobile: iOS date/time picker no longer collapses mid-scroll.** The
  appointment form and calendar reschedule closed the picker on the
  first `onChange` — correct for Android's one-shot dialog, but iOS's
  spinner fires per scroll tick, so the picker vanished under the
  user's first flick. A shared `InlineDateTimePicker` now keeps the
  iOS spinner mounted behind a Done button and auto-closes only on
  Android.
- **Mobile: screen-reader and touch-target pass.** Icon-only controls
  (send, template, search-clear, map toggle, calendar navigation,
  stage moves, sheet close buttons) now carry `accessibilityRole` and
  labels for VoiceOver/TalkBack; unread badges announce their count;
  the OTP input reads as "One-time code" with entry progress; bottom
  sheets set `accessibilityViewIsModal`. Small targets (radius
  selectors, filter chips, type chips, move-stage, text links) were
  raised to comfortable sizes with hitSlop. The deals stage-picker
  modal now closes with the Android back button and has a visible
  close control.

### Added

- **Mobile: add contacts from the field.** The Contacts tab gains a
  "+" button opening a quick-add sheet (name, phone, classification)
  that calls the same `POST /api/contacts` route as the web form —
  plan limits, rate limits and RLS all apply — then opens the new
  contact card. An agent taking a walk-in's number no longer needs
  the web app.

### Changed

- **Mobile: navigation, forms and polish pass.** Screens inherit the
  shared header style from the layout instead of re-specifying it in
  12 files; the conversation composer keyboard offset uses the real
  header height; list rows and property cards now give springy press
  feedback on both platforms (scale-down physics, not Android-only
  ripple); raw Postgres errors ("violates row-level security…") are
  translated to human copy; email addresses are validated before
  saving a contact; login and appointment forms support
  keyboard-next/go submit flow; all searches share one 250ms
  debounce (the appointment contact picker queried per keystroke);
  billing top-up opens an in-app browser tab instead of dumping into
  the system browser (new dependency: `expo-web-browser` — run
  `npm install` in `mobile/`); safe-area-derived padding replaces
  guessed bottom offsets on the property bar and map footer; photo
  strips show a "+N" chip when a listing has more than 8 images.

- **Mobile: one set of primitives, one set of tokens.** The five
  hand-rolled text-field styles, five primary-CTA implementations,
  three search bars, three bottom sheets, and five uppercase section
  labels that had drifted across screens are now single shared
  components (`TextField`, `PrimaryButton` — gradient is the brand
  rule now, `SearchBar`, `BottomSheet`, `SectionLabel`,
  `GradientHero`, `IconButton`, plus a `listCard` row chrome and a
  property-shaped skeleton). New theme tokens replace scattered
  literals: `surfaceSunken` (spec pills/previews no longer borrow the
  chat-bubble color), `backdrop`, `tabBarGlass`, `onGradient` ink,
  a shared hero shadow, and a documented `mapPin` palette; the map
  screen, property-detail marker and confetti drop their leftover
  Tailwind violet/blue for brand hues.

- **Mobile: richer panels and bolder type.** Inbox and Contacts rows
  are now elevated white cards floating on the cream canvas (rounded,
  warm-tinted shadow) instead of flat hairline-divided rows, with
  extrabold names and medium-weight previews; loading skeletons match
  the card shape. Search bars became pill-shaped raised fields, filter
  chips and tags got bolder, and Contacts' call/WhatsApp buttons sit
  on tinted green backgrounds. Every section panel across More,
  Deals, Dashboard, Calendar, Credits, Journeys, Broadcasts,
  Automations and the contact card picked up the shared card shadow,
  and the Dashboard/Credits hero glow switched from the retired
  violet to brand forest-green.

- **Journey: all journeys in one place.** `/journey` no longer opens a
  bare picker — it now lists **every** journey as a collapsible
  section (buyers by default; a dropdown at the top switches to
  property journeys). Each section header shows the subject, its
  furthest stage, and active / dropped / captured counts; expanding it
  mounts the full interactive mind map inline — advance, drop, tray,
  and imports all work without leaving the page. Sections can be
  hidden from the overview (and restored from a "Hidden journeys"
  strip at the bottom); expansion and hidden state persist per device.
  A "New journey" dialog replaces the old picker, and the focused
  single-journey view (deep links from the contact panel, inbox, and
  inventory) gains an "All journeys" back button. Internally the whole
  per-journey experience moved into a reusable `JourneySection`
  component shared by both views.

### Fixed

- **The reminder templates' quick-reply buttons failed Meta's
  submission check — "Buttons can't have any variables, newlines,
  emojis or formatting characters."** (**migration required**:
  `144_reminder_button_no_emoji.sql`) — the "Fine 👍" button
  (migration 141) had an emoji, which Meta's Quick Reply buttons
  don't allow (only plain text). Changed to plain "Fine"; the
  "Requesting reschedule" button was already unaffected. Only
  rewrites templates that haven't reached Meta yet, same as prior
  migrations, and clears the stale `submission_error` left by the
  earlier failed attempt.

- **Three of the four reminder templates couldn't actually be
  submitted to Meta — "too many variables for its length."**
  (**migration required**: `143_reminder_template_wording_fix.sql`)
  — discovered right after the Draft-submit button fix below made
  submitting them possible at all. Meta (and our own client-side
  check in `src/lib/whatsapp/template-validators.ts`, which mirrors
  it) requires at least 3 static words per `{{n}}` variable on a
  Utility template. `appointment_reminder` (5 vars, 13 static words)
  and `appointment_reminder_agenda` (6 vars, 14 static words) came up
  short from this session's own wording; `property_visit_reminder_agenda`
  (6 vars, 16 static words, migration 129) turned out to have been
  short since before this session — it was never actually submittable
  either, just never noticed since nothing offered a way to submit a
  Draft template until now. Reworded all three with a few added
  static words each (e.g. "...this is a friendly reminder **that you
  have** a scheduled meeting..."); `property_visit_reminder` already
  had exactly enough and is unchanged. `src/lib/appointments/
  reminder.ts`'s local Inbox-preview copy updated to match each
  variant word-for-word.

- **A message template stuck in "Draft" (e.g. a migration-seeded one
  like `appointment_reminder`) had no way to actually be submitted to
  Meta.** Settings → WhatsApp → Templates only showed an "Edit"/
  "Resubmit" button for `APPROVED`/`REJECTED`/`PAUSED` templates —
  `DRAFT` rows had nothing but a delete icon, a dead end even though
  the backend (`PATCH /api/whatsapp/templates/[id]`) already told you
  to "use New Template to submit it instead" if you somehow got in.
  Discovered while trying to submit the new meeting-reminder templates
  below. `src/components/settings/template-manager.tsx` now shows a
  **Submit** button on `DRAFT` templates that opens the same pre-filled
  form, routed through `POST /submit` (which upserts onto the existing
  row) rather than the edit endpoint, with dialog copy that says
  "submit" instead of incorrectly claiming the template already exists
  on Meta.

- **Every appointment reminder said "your scheduled property visit,"
  even for a plain meeting, call, follow-up, or document appointment.**
  (**migration required**: `140_meeting_reminder_template.sql`) —
  `src/lib/appointments/reminder.ts` always used the
  `property_visit_reminder` template regardless of the appointment's
  `event_type`. Now `event_type === 'site_visit'` keeps that wording;
  every other type (meeting, call, follow_up, document, other) uses a
  new neutral pair, `appointment_reminder` /
  `appointment_reminder_agenda` ("...this is a friendly reminder for
  your scheduled meeting: ...") — seeded DRAFT for every account, same
  as the existing agenda variant: submit it from Settings → Templates
  and wait for Meta's approval before it starts sending for your
  account.

- **Appointment reminders (morning-of brief, 1-hour-before) never
  actually fired — the cron that sends them had no automatic
  trigger.** `checkAndSendAppointmentReminders()`
  (`src/lib/appointments/reminder.ts`) only ran when something called
  `GET /api/appointments/cron`, but that route was never registered in
  `vercel.json`'s `crons` list (checked its entire git history — it
  never has been), unlike the 5 other scheduled jobs. Nothing in the
  repo was ever calling it. Registered it in `vercel.json` on a 15-
  minute schedule, and brought its auth check in line with the other
  Vercel-scheduled cron routes — it only recognized a custom
  `x-cron-secret` header before, but Vercel's own cron invocations send
  `Authorization: Bearer $CRON_SECRET`, which it would have rejected
  even once scheduled.
  Also fixed a related gap while in this code: rescheduling an
  appointment to a new time never reset `reminder_morning_sent` /
  `reminder_1h_sent`, so an appointment whose reminder had already
  fired for its old time would silently never remind again after being
  moved (`src/app/(dashboard)/calendar/page.tsx`'s edit-appointment
  save path — the one the Calendar UI actually uses — and the
  `PUT /api/appointments/[id]` route, for any other caller).

- **Every tab switcher and URL-synced filter no-oped in production.**
  The same-pathname router bug fixed for Journey below turned out to
  affect the whole app: the Contacts / Inventory / Dashboard /
  Automations tab bars, the Settings tab + WhatsApp sub-tab switches,
  contacts/inventory filter + pagination URL sync, closing detail
  panels (clearing `?contactId=` / `?propertyId=`), the Meta-Ads
  callback param cleanup, and global-search results that land on the
  page you're already on. All now route through shared helpers
  (`src/lib/navigation.ts`: `pushUrl` / `replaceUrl`) that detect a
  same-pathname target and drive the native History API (which Next
  syncs into `useSearchParams`), falling back to the router for real
  page changes. The inbox already used this exact History-API pattern
  for its `?c=` updates — the rest of the app now matches it.

- **Journey: "All journeys" and every view switch silently did nothing
  in production.** All journey view changes are same-pathname
  navigations (`/journey` ⇄ `/journey?contact=…` ⇄ `?view=properties`),
  and the app router swallows same-pathname client transitions in
  production builds — `router.push`, `router.replace`, and `<Link>`
  all no-op (verified against a production server with a browser
  harness; dev mode works, which is how it shipped). Journey-internal
  navigation now goes through the native History API
  (`window.history.pushState`), which Next syncs into
  `useSearchParams` — every transition plus browser back/forward
  verified working in production mode. Cross-page entries (inbox /
  contact panel / inventory → journey) were never affected.

- **Journey focused view: consolidated header.** The focused journey
  now shows a subject bar — whose journey it is (name + phone, or
  property + price), live active/dropped counts, and ALL actions
  (Captured tray, Import from chat, Import inquiries, Add) in one row
  attached to the map — replacing buttons scattered across three
  disconnected right-aligned rows. The floating "Add" button inside
  the canvas is gone (it duplicated the toolbar action).

- **Journey: every add/import failed with "Nothing was added."**
  (**migration required**: `139_journey_created_by_fix.sql`) — the
  `created_by` columns on `journey_items` / `journey_events`
  (migration 131) referenced `profiles(id)`, but `profiles.id` is a
  standalone UUID — the app passes the auth uid (`profiles.user_id`),
  so every insert violated the FK. Both FKs now point at
  `auth.users(id)` like the rest of the schema (e.g. migration 077);
  131 is corrected for fresh installs. Capture/add errors also now
  surface the real database message in the toast instead of the
  misleading "Nothing was added." (which is now reserved for genuine
  "already on the journey" cases).

### Added

- **Appointment reminders now have "Fine 👍" / "Requesting reschedule"
  quick-reply buttons, and a reschedule request notifies the agent.**
  (**migration required**: `141_reminder_reschedule_buttons.sql`) — all
  four client-facing reminder templates (`property_visit_reminder`,
  `property_visit_reminder_agenda`, `appointment_reminder`,
  `appointment_reminder_agenda`) gain two quick-reply buttons. Tapping
  "Fine 👍" logs as a normal inbound reply, same as any text message.
  Tapping "Requesting reschedule" additionally stamps the appointment's
  new `reschedule_requested_at` — shown as an amber reschedule icon on
  the Calendar month view and a banner in the edit dialog — and pings
  the assigned agent directly on WhatsApp (`src/lib/whatsapp/
  webhook-handler.ts`, matching the button tap back to its appointment
  via the outbound reminder's Meta message id, now recorded on
  `appointment_reminder_log.wa_message_id`). Actually moving the
  appointment to a new time clears the flag automatically. Since this
  changes the templates' structure, `property_visit_reminder` and
  `property_visit_reminder_agenda` reset to `DRAFT` for any account
  that hadn't genuinely gotten them approved by Meta yet (see the
  phantom-`APPROVED` fix above) — (re)submit all four from Settings →
  Templates.

- **Journey auto-capture of WhatsApp shares + Captured tray**
  (**migration required**: `138_journey_capture.sql`) — sharing a
  property to contacts over WhatsApp from the app (template, catalog
  card, or greeting sends in the Share dialog; also the native
  WhatsApp button when the dialog was opened for a specific client)
  now records each contact×property pair on the Journey automatically.
  Because agents share properties every day, auto-captured pairs do
  NOT crowd the mind map: they arrive **hidden** and queue in a new
  **"Captured (N)"** tray on `/journey`, where the agent promotes the
  ones worth tracking ("Show on map" / "Show all") or removes the
  noise. Any item already on the map can likewise be tucked away later
  via **"Hide from map"** in its detail sheet — record and timeline
  are kept, the card just moves to the tray. Buyer journeys also gain
  **"Import from chat"**: a retroactive scan of the contact's WhatsApp
  history (matching showcase links, property codes, and titles — the
  same logic as the contact panel's "Shared Properties" tab, now
  extracted to `src/lib/journey/chat-scan.ts`) that puts previously
  shared properties straight onto the map. Capture is idempotent:
  re-sharing never duplicates a pair, resurrects a dropped branch, or
  un-hides a tucked-away one. New columns: `journey_items.source`
  ('manual' | 'whatsapp_share' | 'chat_import' | 'inquiry_import') and
  `journey_items.hidden`; `journey_events` gains 'hidden'/'unhidden'
  event types.

- **Deep links: web URLs open the mobile app** — the app now maps the
  web's URL shapes to native screens (`mobile/app/+native-intent.ts`):
  `https://convoreal.com/?property_id=…` → property detail, `?contactId=`
  → contact, `?c=` → conversation, plus `/inventory`, `/pipelines`,
  `/calendar`, `/journey`, `/broadcasts`, `/settings`. `convoreal://`
  scheme links work immediately; https App/Universal Links are fully
  declared (Android intent filters + iOS associated domains, app ids
  `com.convoreal.app`) and the web now serves the verification files —
  `/.well-known/assetlinks.json` and `/.well-known/
  apple-app-site-association`, env-gated on `ANDROID_APP_CERT_SHA256` /
  `APPLE_TEAM_ID` — so they activate with the first EAS build's signing
  cert (OS-level verification can't point at Expo Go).

- **Mobile app: "warm estate" redesign from user-supplied reference
  (`mobile/`)** — full visual system swap to match the chosen design
  direction: cream canvas + deep forest-green primary + mint-lime
  accents (replacing violet), label-less floating glass tab bar with a
  filled circle on the active tab, property cards restructured to the
  reference (photo framed inside a white card, floating mint status /
  distance chip, title–price row, bordered spec pills), property
  detail gains a thumbnail strip over the hero pager and a sticky
  price + CTA bar (WhatsApp Owner / Open Maps), inbox header becomes a
  greeting ("Hi, {name}") with avatar and a mint credits chip, map
  markers become mint price pills, and the app icon/splash regenerate
  in the green identity. All screens shift via the shared token theme;
  dark mode gets a green-tinted variant.

- **Mobile app: location suite — GPS near-me, locality autocomplete,
  native maps (`mobile/`)** — the phone now does everything the web's
  geo stack does, plus what only a phone can. Properties gains a
  **"Near me"** chip (device GPS → the same tiered `near_*` search the
  web inventory uses, with 2/5/10/25 km radius picker and distance /
  "In area" badges on cards), the search box doubles as the web's
  **Google locality autocomplete** (via the existing `/api/maps/
  autocomplete` + `place-details` proxies — key stays server-side;
  degrades to plain text search when unconfigured), a **native map
  screen** renders the current search as pins (tap through to the
  property), and property details embed a mini-map when coordinates
  exist. Coordinates keep self-healing via the API's geocode tier. New
  deps: expo-location, react-native-maps (SDK 57 bundled versions).

- **Mobile app: design language pass — motion, gradients, signature
  moments (`mobile/`)** — the companion app graduates from clean-
  utilitarian to premium-playful: violet→fuchsia brand gradient
  (buttons, login hero, Overview hero card), a floating frosted-glass
  pill tab bar with haptic tab switches, staggered spring entrances
  and press-scale physics on lists, a shared haptic vocabulary (send /
  success / warn), shimmer skeletons, Instagram-style gradient story
  rings for HOT leads atop the inbox, full-bleed photo property cards
  with gradient scrims, count-up animated stats, a confetti burst when
  a deal moves to Closed Won, and a branded app icon + splash
  (chat-bubble-house mark, generated by
  `mobile/scripts/generate-icons.js`) replacing the default Expo
  assets. New deps: expo-linear-gradient, expo-haptics, expo-blur.

- **Mobile app: Overview, Broadcasts (view), Automations toggles,
  Journeys (read-only) (`mobile/`)** — four more web features arrive
  on mobile via the More tab. Overview: stat cards for today's
  unread/messages/appointments, open-pipeline value, deals won, hot
  leads and available listings. Broadcasts: campaign list with live
  send/delivered/read progress bars (auto-refreshes while a campaign
  is sending) plus per-recipient status detail with filters —
  composing stays on the web. Automations: on/off switches driven by
  the validating `PATCH /api/automations/[id]` route, plus WhatsApp
  flow statuses — builders stay on the web. Journeys: read-only
  per-buyer stage lists rendered from the same `journey_items` rows as
  the web mind map. Billing and Team settings remain deliberately
  web-only (Play-billing policy and admin surface).

- **Mobile app: core CRM tranche — Inventory, Deals, Calendar,
  Templates (`mobile/`)** — the companion app grows from
  inbox+contacts to the core CRM pillars, in a 5-tab layout (Inbox /
  Contacts / Properties / Deals / More). Properties: list powered by
  the same `GET /api/properties` search the web uses (natural-language
  queries like "2bhk in whitefield under 80L" work), listing-type
  filters, infinite scroll, and a detail screen with photo pager,
  specs, features and owner link. Deals: pipeline switcher, stage
  strip with counts and per-stage value totals, and a move-stage sheet
  applying the web kanban's exact status + property-status side
  effects. Calendar: upcoming appointments grouped by day with
  complete/cancel, plus a create form (type, date/time picker,
  location, contact search) writing the same row shape as the web's
  schedule dialog — cron-driven WhatsApp reminders apply unchanged.
  Inbox thread gains an approved-template picker with {{n}} variable
  inputs and live preview — the compliant way to reach customers
  outside the 24-hour window (text-header templates in v1). The More
  tab hosts Calendar, profile/credits, and a directory of
  deliberately-web-only features (flow builder, broadcasts, Journey,
  analytics, billing).

- **Mobile app: WhatsApp OTP sign-in + rich UI pass (`mobile/`)** —
  the companion app now signs in with a WhatsApp one-time code as the
  primary flow (6-digit code boxes, resend timer; email/password as
  fallback) — a mobile-first capability the web doesn't have — and the
  phone-verification gate is a full native OTP flow instead of a
  redirect-to-web stub. UI rebuilt with a light/dark design system:
  inbox with search, status/unread filters, live AI-credits chip and
  skeleton loaders; WhatsApp-style thread with day separators, delivery
  ticks (✓/✓✓/read), failed-send reasons, bot markers, and images
  rendered through the auth-gated media proxy with expired-media
  placeholders; contacts with classification colors; settings with
  profile, credits and role cards.

- **Mobile companion app scaffold (`mobile/`)** — Phase 1 of the plan in
  `docs/mobile-app-implementation-plan.md`: an Expo SDK 57 + expo-router
  app (Android-first, iOS-ready) living in this repo as a self-contained
  npm project. Ships email/password login against the shared Supabase
  project (session AES-encrypted at rest, key in Keychain/Keystore), the
  migration-137 phone-verification gate, a realtime inbox and
  conversation thread (Supabase Realtime + TanStack Query persisted to
  AsyncStorage for offline reads), text replies via
  `POST /api/whatsapp/send`, and a contacts tab with native dialer /
  WhatsApp deep links. Run it with `cd mobile && npm install && npm
  start` (see `mobile/README.md`). Root tsconfig/eslint/Vercel configs
  ignore `mobile/`, so web builds and deploys are unaffected.

- **API routes now accept `Authorization: Bearer <access_token>`** —
  the mobile app has no cookies, so `createClient()` in
  `src/lib/supabase/server.ts` (the chokepoint every API route's
  Supabase client comes from) now attaches a bearer JWT to PostgREST
  requests (RLS enforced identically to cookie sessions) and validates
  it via GoTrue, falling back to the existing cookie session when the
  header is absent or not a JWT (Vercel Cron's `Bearer ${CRON_SECRET}`
  stays on the cookie path). No per-route changes; web behavior
  unchanged.

- **Journey mind map** (**migration required**: `131_journey_mindmap.sql`) —
  a new `/journey` canvas that renders one relationship's full funnel as
  a mind map instead of a kanban. Open a buyer's journey and their card
  fans out to every property shared with them, each property tracing
  left-to-right through the stages it has reached (Shared → Shortlisted
  → Visited → Owner Meeting → Token & Legal → Registration → Brokerage
  Paid — fully customisable per account: rename, recolor, reorder,
  add/remove stages). Columns render only up to the furthest stage any
  item has reached; properties that fell out of the running stay visible
  at the stage where they died, in red, with the drop reason on the
  card. The same rows read in reverse give the seller view: open a
  property's journey to see every interested contact racing through the
  same stages. Click any node for a detail sheet with a stage progress
  rail, an append-only event timeline, and advance / move / drop-with-
  reason / reactivate / remove actions; hover a frontier card for a
  one-click advance. Buyer journeys can bulk-import the contact's
  existing property inquiries as the first stage. Entry points: sidebar
  ("Journey"), the contact panel's "Journey Map" action, a journey icon
  in the inbox thread header, and a "Journey" button on inventory rows.
  Built on the same React Flow canvas stack as the chatbot flow editor.
  New tables: `journey_stages`, `journey_items`, `journey_events` (all
  RLS-scoped per account).

- **New building-construction themed loader for the property
  inventory list, paired with the ConvoReal wordmark like every other
  page loader.** `PropertyConstructionLoader`
  (`src/components/ui/property-construction-loader.tsx`) — a crane
  swinging beside a building that rises floor by floor, then fades to
  rebuild. Replaces the radar-pin loader on Inventory's "Loading
  property inventory" state, now shown alongside `ConvoRealLoader`
  underneath it, matching the `[themed icon] + ConvoRealLoader + text`
  convention already used on Pipelines, Contacts, Pulse, and other
  pages.

- **Name Tag now shows next to a contact's name everywhere, not just 3
  places.** `contacts.name_tag` (a short internal qualifier like "Bank
  DSA", migration 122) previously only rendered in the Contacts list,
  contact detail view, and inbox sidebar. Extracted a shared
  `NameTagBadge` component (`src/components/contacts/name-tag-badge.tsx`)
  and wired it into every other place a contact's name is displayed:
  Agents Directory (list + detail), inbox conversation list and thread
  header, pipeline kanban cards, broadcast recipient tables, calendar
  (agenda/team views, smart-add preview, mention picker), Today page,
  Match Radar and Pulse event feeds, the dashboard's Active Users
  widget, property owner/interested-contact displays and every
  share-contact dialog, the shared searchable-contact picker
  components, global command-palette search, duplicate-contact
  merging, referrer autocompletes, and automation/flow run logs. Several
  of these needed `name_tag` added to their underlying Supabase
  `.select()` queries and local TypeScript interfaces — it was silently
  absent from the data, not just the UI, in those spots.

- **Showcase Pulse: dedupe, filters, and an anonymous-visitor nudge.**
  Further Pulse timeline polish on top of the identity-stitching /
  scroll fixes below:
  - **Duplicate collapsing**: consecutive events for the same session,
    event type, and property within 5 minutes now collapse into one
    row with a `×N` repeat badge instead of N separate lines
    (`src/lib/pulse/dedupe-feed.ts`).
  - **Filter pills**: All Activity / Property Views / Identified Only,
    above the timeline.
  - **Anonymous-visitor nudge**: when 60%+ of a feed of 5+ events has
    no attributed contact, a banner points the agent at Inventory →
    Share Showcase → "Send personally" — the one flow that reliably
    gets a name attached.

- **Showcase page: next-step CTAs for visitors.** Two cards under the
  hero on the public showcase (`src/components/showcase/
  showcase-view.tsx`) nudge visitors toward the two things the agent
  most wants from them:
  - **"Get Deal Alerts"** — opens the existing requirements modal
    (already feeds Match Radar for future property matches); framed
    as never missing a hot or urgently-priced listing.
  - **"List My Property"** — links to the previously-unlinked `/list`
    self-serve submission page (`src/app/list/page.tsx`), for visitors
    who have their own property to sell or rent.

- **Showcase Pulse: fewer "Anonymous Guest" entries, and a scrollable
  timeline.** Two fixes to the visitor activity feed (Dashboard →
  Pulse):
  - **Identity stitching on the two other places a visitor reveals
    who they are.** The per-contact `?v=` share link already tagged
    events by name; now the same retroactive stitch (already used
    there) also fires when a visitor submits the showcase inquiry
    form (`/api/public/inquiry`) or types their phone into the "Ask
    about this property" chat (`/api/public/ask`) — their earlier
    (and future) "Anonymous Guest" events from that browser session
    get attributed to the real contact once their phone number is
    known. Extracted the shared session-key helper
    (`src/lib/pulse/session-key.ts`) that three components were each
    reimplementing.
  - **Live Event Timeline no longer forces scrolling through the
    entire feed to reach Top Listings.** The timeline (up to 100
    events) now scrolls in its own `max-h-[600px]` panel instead of
    growing the whole page — most noticeable on mobile, where the two
    columns stack.

- **Validate WhatsApp Flow JSON directly against Meta.** Settings →
  WhatsApp → WhatsApp Flows now has a "Validate Against Meta" button
  alongside Publish. It uploads the Buyer Preference Intake Flow JSON
  to Meta's asset validator and reports the real result — without
  publishing — so a change to the flow blueprint
  (`src/lib/whatsapp/preference-flow.ts`) can be checked against Meta's
  actual component rules before going live, instead of relying only on
  hand-coded assumptions in unit tests (as happened with the
  `init-value`-inside-`Form` bug fixed above).
  - `validatePreferenceFlowJson` (`src/lib/whatsapp/meta-flow-service.ts`)
    — creates the flow container on Meta if needed but never calls
    `/publish`.
  - `POST /api/whatsapp/flows/validate` — new route backing the button.

- **On-brand 404 / error pages.** The stock "This page could not be
  found" is replaced everywhere with real-estate-flavored copy in a
  shared "unreliable agent" voice, plus the static house glyph from
  the new loader family (`src/components/ui/property-house-glyph.tsx`)
  so it visually matches.
  - `src/app/not-found.tsx` / `error.tsx` — public 404 and error
    boundary ("Site Visit Cancelled" / "Our Agent Is Running Late").
  - `src/app/global-error.tsx` — deliberately dependency-free fallback
    for a root-layout crash.
  - `src/app/(dashboard)/not-found.tsx` / `error.tsx` — in-app variants
    that render inside the sidebar shell for signed-in users
    ("This Listing Walked Off the Market" / "Hold On, Just Wrapping
    Up a Call").

- **Real-estate-themed loading states.** Two on-brand replacements for
  the generic spinner, both pure SVG/CSS (no icon-library dependency)
  and driven by the same `--primary`/`--card` tokens as the rest of the
  UI, so they follow whichever of the 5 accent themes is active.
  - `PropertyRadarLoader` (`src/components/ui/property-radar-loader.tsx`)
    — a map pin broadcasting expanding rings, echoing Match Radar's
    "still searching" language. Now used for the inventory list's
    loading state and the WhatsApp broadcast "Sending..." step.
  - `PropertyBlueprintLoader`
    (`src/components/ui/property-blueprint-loader.tsx`) — a
    single-stroke house that draws itself (outline → door → window)
    then fades to redraw. Now used for the AI flyer image-generation
    overlay and the property-image upload button.
  - Both respect `prefers-reduced-motion` (freeze on a static frame)
    and expose `role="status"` / `aria-label` for screen readers.

- **Owner property status digests.** Property owners/sellers get an
  automatic WhatsApp update about buyer activity on their listings —
  new enquiries, shortlisted buyers (pipeline entries), scheduled site
  visits, and showcase views — at a per-account cadence (daily, or
  weekly on Monday mornings IST), and **only when there's new
  activity** in the period.
  - **Consent-first**: before anything recurring, each owner gets a
    one-time consent request (Yes/No buttons) — digests flow only after
    they say yes, and the owner's choice always overrides the account
    setting. They can flip it anytime by replying "STOP UPDATES" /
    "START UPDATES".
  - Delivery is template-first (`owner_digest_consent` +
    `owner_property_digest`, both Utility) with a free-form upgrade when
    the owner's 24h window is open; one-click template submission from
    Settings.
  - Configure in Settings → WhatsApp → "Owner Property Digest";
    cron at `/api/cron/owner-digest` (registered in vercel.json),
    deduped per IST day via the `owner_digest_log` ledger.

**Migration required**: `supabase/migrations/126_owner_property_digest.sql`
(adds `owner_digest_settings`, `owner_digest_log`, and
`contacts.owner_digest_consent` / `owner_digest_consent_requested_at`).

- **Native WhatsApp Flows — buyer preference intake.** Buyers can now
  fill/update their budget, locality, property-type and expected-ROI
  preferences inside a WhatsApp form screen (a native Meta Flow), instead
  of a back-and-forth text conversation.
  - Texting "update my preferences" (or tapping an `update_preferences`
    button) sends the form; submissions save straight onto the contact
    and get a confirmation summary in the chat thread.
  - Settings → WhatsApp now has a **WhatsApp Flows** card showing the
    flow's publish status with a one-click "Set Up & Publish Preference
    Flow" button (and re-sync after updates).
  - `POST /api/whatsapp/flows/setup` — one-click create/publish of the
    flow on Meta for the tenant's WABA: generates and registers the
    RSA-2048 encryption keypair, uploads the Flow JSON, publishes, and
    records it in the new `whatsapp_meta_flows` registry.
  - `POST /api/whatsapp/flows/send` — agent-initiated send to a contact.
  - New per-tenant encrypted data-exchange endpoint
    (`/api/whatsapp/flows/endpoint/[accountId]`) implementing Meta's
    Flows crypto handshake (RSA-OAEP + AES-GCM, flipped-IV responses),
    health-check pings, prefill on open (INIT) and submit handling.
  - Requires the official Meta Cloud API integration (not sandbox).

**Migration required**: `supabase/migrations/125_whatsapp_meta_flows.sql`
(adds `whatsapp_meta_flows`, `whatsapp_meta_flow_sessions`, and flow
encryption-key columns on `whatsapp_config`).

Foundation for multi-user accounts. Every wacrm install becomes
multi-tenant on the database side: a single user's signup creates a
fresh "account", and every row is scoped to that account rather than
to the user directly. The user-visible invite / members surface lands
in follow-up PRs gated by the `'account_sharing'` beta feature flag —
this release is wiring with no behaviour change on its own. Existing
self-hosted instances keep working: every existing user is backfilled
as the sole owner of their own account and sees identical data.

### Fixed

- **Signing in would sometimes get stuck bouncing forever between
  `/dashboard` and `/profile-setup`, both showing nothing but the
  ConvoReal splash** — first noticed after the Owners Den migrations
  landed, which made the dashboard shell's profile-row query (now
  joined against `accounts`, `org_role`, `team_id`, `is_read_only`)
  slower and occasionally flaky. `useAuth`'s `fetchProfile`
  (`src/hooks/use-auth.tsx`) treated any failed fetch the same as "this
  user genuinely has no profile row": the dashboard shell read that as
  "no profile" and redirected to `/profile-setup`, whose own (fresh)
  fetch would then succeed and redirect straight back — and if the next
  dashboard fetch happened to fail again, the cycle repeated
  indefinitely. `fetchProfile` now retries once after a short delay
  before giving up, and surfaces a distinct `profileError` state so a
  real fetch failure is no longer confused with "no profile yet".
  `src/app/(dashboard)/dashboard-shell.tsx` now holds still and shows a
  "couldn't load your profile — Retry" screen instead of redirecting
  when `profileError` is set.

- **Favoriting a Contacts quick-filter (e.g. "Needs Review") favorited
  the whole unfiltered Contacts list instead.** The quick-filter tabs
  (All Contacts / Needs Review / Transacted / Active Buyers) were
  plain component state with no URL param, so the page-level Favorite
  star — which only knows the URL — could never tell them apart, and
  the filter itself reset to "All Contacts" on every reload anyway.
  Synced the active quick-filter to a `?filter=` param
  (`src/app/(dashboard)/contacts/contacts-content.tsx`), and the
  Favorite button now labels/links the exact filtered view, e.g.
  "Contacts — Needs Review" → `/contacts?filter=pending_review`
  (`src/app/(dashboard)/contacts/page.tsx`).

- **Property Documents upload showed a plain spinner while Property
  Images (right above it, same form) showed the themed loading
  animation.** Both are "Uploading..." buttons in the property form's
  media section, but only Images was switched over when the
  real-estate-themed loaders shipped. Documents now uses the same
  `PropertyBlueprintLoader` (`src/components/inventory/property-form.tsx`).
- **Every page's loading state used a different icon size and spacing
  for its themed loader**, so the loading UI felt inconsistent and easy
  to miss when hopping between pages (Pulse's heartbeat loader read
  noticeably bigger than Flows' node loader, Contacts' and the inbox
  panels' loaders were tiny by comparison, some pages skipped the
  loading-text line entirely). Standardized every full-page/section
  themed loader on one layout — 104px icon, 20px `ConvoRealLoader`
  wordmark directly beneath it, a loading-text line under that — across
  Pulse, Radar, Flows (list, detail, runs), Automations (edit, logs),
  Broadcasts (list, detail), Calendar, Requirements, Ads, Contacts
  (list, import), and the inbox conversation list and message thread.
  Left untouched: small inline sub-panel spinners nested inside an
  already-loaded page (e.g. Agents' per-card "loading notes") and the
  bare wordmark-only loaders used where a page has no themed icon at
  all (app shell, admin, profile setup, join-by-invite) — both are a
  deliberately different, smaller category from the noticeable
  full-page loaders this pass targeted.

- **Calendar voice logging ("tap the mic and say it") was silently
  broken for every visitor.** A site-wide `Permissions-Policy:
  microphone=()` header (`next.config.ts`) unconditionally vetoed
  microphone access before the browser's own per-site permission
  prompt could matter — no amount of allowing the mic in Chrome would
  have worked. Scoped the policy to `microphone=(self)`. Also stopped
  masking the real cause behind a single "access denied" toast:
  `src/components/calendar/mic-error.ts` now maps `NotFoundError` /
  `NotReadableError` / etc. to a message that names the actual problem
  and, for genuine permission denials, points at the address-bar
  site-info icon rather than the OS-level toggle.
- **WhatsApp preference flow JSON failed Meta's publish validation**
  ("Property 'init-value' is not allowed in 'TextInput' component.").
  Per-field `init-value` is only valid on inputs outside a `Form`
  component; ours are Form-wrapped, so the bindings now live on the
  Form's `init-values` map instead (`src/lib/whatsapp/
  preference-flow.ts`).
- **WhatsApp preference flow JSON also failed Meta's publish
  validation** on `min_budget`/`max_budget`/`min_roi`
  ("Expected property 'min_budget' to be of type 'number' but found
  'string'.") — caught by running the new "Validate Against Meta"
  check (above) against a real WABA. Those three screen-data fields
  fed `TextInput`s with `'input-type': 'number'`, so Meta requires the
  schema type to be `'number'`, not `'string'`. Changed the schema
  types and `buildPreferencePrefillData` to emit real numbers (`0` as
  the "not set yet" sentinel, since a number field can't be `''`).
  Re-validated against Meta after the fix: zero validation_errors.
- **System-initiated WhatsApp sends (owner-update digests, bot replies)
  crashed with "null value in column "user_id" of relation
  "conversations" violates not-null constraint"** whenever the
  recipient didn't already have a conversation row. `user_id` on
  `contacts`/`conversations` is still `NOT NULL` — a legacy holdover
  from the pre-account tenancy model — but `sendWhatsAppMessageAndPersist`
  (`src/lib/whatsapp/meta-api-dispatcher.ts`) fell back to `null` when
  no acting user triggered the send. Now falls back to the account's
  `owner_user_id` instead.
- **Meta could never publish the Buyer Preference Intake flow, and
  once published the flow would have failed for every real buyer.**
  `src/proxy.ts` (this Next.js version's `middleware.ts`) gated every
  `/api/whatsapp/*` request behind a logged-in browser session unless
  the path contained `/webhook`. `/api/whatsapp/flows/endpoint/
  [accountId]` — the server-to-server callback Meta calls directly for
  health-check pings, `INIT`, and `data_exchange` — carries no session
  cookie and doesn't match `/webhook`, so it got a blanket 401 before
  the route handler (which already authenticates via HMAC signature +
  RSA/AES encryption) ever ran. That's what kept Meta's publish health
  check permanently `BLOCKED` with `endpoint_available`. Added an
  explicit exemption for that one path.

### Changed

- **Tenancy moves from per-user to per-account.** RLS on every
  domain table (contacts, conversations, messages, broadcasts,
  automations, flows, pipelines, templates, tags, …) now checks
  account membership via a new SECURITY DEFINER helper
  `is_account_member(account_id, min_role)` instead of
  `auth.uid() = user_id`. The `user_id` columns stay on every row
  for assignment / audit but no longer enforce isolation.
- **WhatsApp config is one-per-account, not one-per-user.** The
  `whatsapp_config.UNIQUE(user_id)` constraint is replaced by
  `UNIQUE(account_id)`.
- **`flow_runs` idempotency key swaps to `(account_id, contact_id)`**
  so two accounts sharing a contact phone number can each run their
  own flows independently.
- **The signup trigger (`handle_new_user`) now also creates a
  personal account** and links the new profile to it as `owner`.

### Changed

- **Flow-media storage is now account-scoped.** Migration 016
  pathed uploaded files under `auth.uid()/...`, which orphaned
  flow media when a teammate left a shared account. New uploads
  go under `account-<account_id>/...` and any account member
  with the right role can edit them. Legacy paths remain
  writable by the original uploader for backward compatibility.
- **Webhook contact lookup now pre-filters in SQL.** Previously
  pulled every contact in an account just to JS-filter to one
  row by phone — fine when account = one user, painful when
  account = team. Pre-filter by phone suffix on the database
  side; re-apply `phonesMatch` on the (typically 0-2 row)
  candidate set.

### Migration required

- `supabase/migrations/020_account_sharing_followups.sql` —
  composite partial indexes on `automations(account_id,
  trigger_type) WHERE is_active` and `flows(account_id) WHERE
  status='active'` for the engine dispatch hot path; updated
  `flow-media` storage RLS to allow account-member writes under
  the new path convention. Idempotent.

- **Role-aware UI gating across the app.** The inbox composer's
  send button + textarea, the "New broadcast / automation / flow"
  buttons, the "Add pipeline / deal" buttons, and the "Add /
  Import contact" buttons are now disabled-with-tooltip for
  viewers (and for agents on settings-class actions). Choice:
  show-but-disable rather than hide, so the UI never feels
  silently broken to a teammate looking at a feature they don't
  yet have permission for.
- **Sidebar surfaces the active account** above the user info
  when the `account_sharing` beta flag is on. Solo users keep
  the original layout (their account is named after them, so
  duplicating it would just add visual noise).

### Fixed

- **Inbound WhatsApp messages now land in the shared inbox.** The
  webhook + automations + flows engines used to route inbound
  events by `user_id`, which after the 017 migration only matched
  the WhatsApp config owner's automations / flows — teammates'
  rules never fired. PR 8 of the multi-user series flips every
  lookup to `account_id` so any member of the account sees the
  inbound message and any teammate's automation or flow can react
  to it. Also fixes incipient NOT NULL violations on
  `automation_logs`, `automation_pending_executions`, `flow_runs`,
  and `deals` — those tables gained `account_id NOT NULL` in 017
  but the engines hadn't yet been updated to populate it.

### Added

- **Account & member management API** — server-side endpoints
  for the upcoming Members tab UI. All routes are role-gated and
  return Supabase-RLS-scoped data.
  - `GET /api/account` — caller's account + role. Any member.
  - `PATCH /api/account` — rename the account. Admin+.
  - `GET /api/account/members` — list members. Email visible to
    admin+ only; agents/viewers see name + avatar + role +
    joined date.
  - `PATCH /api/account/members/[userId]` — change a member's
    role. Admin+. Owner promotion/demotion goes through the
    transfer endpoint instead.
  - `DELETE /api/account/members/[userId]` — remove a member.
    Admin+. The removed user keeps their login and is moved to a
    freshly-created personal account (mirror of the signup flow).
  - `POST /api/account/transfer-ownership` — owner only. Atomic
    swap with the named member.
- **Invitation API + redeem flow** — the no-email, link-only
  invite path. Backend is complete; the Members tab UI that
  drives it lands in a follow-up.
  - `GET /api/account/invitations` — list outstanding (admin+).
  - `POST /api/account/invitations` — create an invite, returns
    the plaintext token + share URL **exactly once** (we store
    only the SHA-256 hash on the row). Body
    `{ role, expiresInDays?, label? }`. Admin+.
  - `DELETE /api/account/invitations/[id]` — revoke (admin+).
  - `GET /api/invitations/[token]/peek` — public, per-IP
    rate-limited. Returns `{ ok, account_name, role, expires_at }`
    or `{ ok: false, reason }` so the join page can render
    "You're being invited to <Account> as <Role>".
  - `POST /api/invitations/[token]/redeem` — authenticated.
    Atomically moves the caller's profile to the inviter's
    account and cleans up the orphan personal account. Refuses
    with 409 if the caller's current account already contains
    domain data (no silent data loss).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/017_account_sharing.sql` — introduces the
  `accounts` and `account_invitations` tables plus an
  `account_role_enum` type; adds `account_id` to every
  user-scoped table and backfills it; rewrites every RLS policy;
  replaces the new-user trigger. Idempotent. **No data loss** —
  every existing user is mapped to a freshly-created account
  with role `owner` and every existing row of theirs is linked
  to that account.
- `supabase/migrations/018_account_member_rpcs.sql` — adds three
  `SECURITY DEFINER` RPCs (`set_member_role`,
  `remove_account_member`, `transfer_account_ownership`) that
  back the member-management API. They self-check the caller's
  role and raise SQLSTATE `42501` / `22023` on forbidden / bad
  input so the API layer can map cleanly to 403 / 400.
  Idempotent.
- `supabase/migrations/019_invitation_rpcs.sql` — adds two
  `SECURITY DEFINER` RPCs: `peek_invitation` (anonymous read by
  token hash, returns a fixed-shape JSON envelope) and
  `redeem_invitation` (authenticated atomic move + orphan
  cleanup, with a domain-data safety check). Both bypass the
  RLS that would otherwise block their reads/writes. Idempotent.

## [0.2.2] — 2026-05-29

Flow nodes can now send media. Closes the most-requested gap from user
feedback after the v0.2.0 Flows launch — flows were text-only and
couldn't deliver an invoice, receipt, product photo, or short demo
video mid-conversation.

### Added

- **`send_media` flow node.** Send an image (PNG / JPEG / WebP), video
  (MP4 / 3GP), or document (PDF, Word, Excel, PowerPoint, TXT) to the
  customer from any point in a flow. Pick a file in the builder, it
  uploads to the new `flow-media` Supabase Storage bucket, and Meta
  fetches the public URL at send time. Optional caption (1024 char cap,
  supports `{{vars.X}}` interpolation); documents also take an optional
  filename shown in the recipient's chat. Auto-advances after send —
  same suspend semantics as `send_message`.
  ([#156](https://github.com/ArnasDon/wacrm/pull/156))

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/016_flow_media.sql` — does two things:
  1. Adds `'send_media'` to the `flow_nodes.node_type` CHECK
     constraint. Without this the `send_media` node fails to save with
     a constraint violation.
  2. Creates the public `flow-media` Supabase Storage bucket (16 MB
     file-size cap, image / video / document MIME allowlist) plus
     per-user RLS policies (path prefix = `auth.uid()`). Without this
     the builder's file picker fails on upload. Same shape as the
     `avatars` bucket from migration 008 — the bucket is **public** so
     Meta can fetch the URL without credentials.

The migration is idempotent and safe to re-run.

## [0.2.1] — 2026-05-26

Bug-fix release. Plugs a silent inbound-message drop that triggered
when two users on the same instance saved the same WhatsApp
`phone_number_id`.

### Fixed

- **Inbound WhatsApp messages no longer silently disappear** when two
  users have claimed the same `phone_number_id`. Previously the
  webhook used `.single()` to look up the owning config, which errors
  `PGRST116` for both 0 rows *and* ≥2 rows — the second user's save
  put the DB into the ≥2-row state and every inbound message was
  dropped while the log misleadingly reported *"No config found for
  phone_number_id"*. Three layers of fix: `POST /api/whatsapp/config`
  now returns **409** when another user has already claimed the
  number, the webhook lookup distinguishes 0 rows from ≥2 rows and
  logs the conflicting `user_id`s, and a new DB constraint
  (`UNIQUE(phone_number_id)`) prevents the bad state at the storage
  layer. Reported in
  [#136](https://github.com/ArnasDon/wacrm/issues/136), fixed in
  [#143](https://github.com/ArnasDon/wacrm/pull/143).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`
  — adds `UNIQUE(phone_number_id)` to `whatsapp_config`. **Fails
  loudly with a copy-pasteable resolution hint** if duplicate rows
  already exist; auto-deduping would destroy encrypted tokens, so
  the operator picks which row keeps the number. To check first:

  ```sql
  SELECT phone_number_id, array_agg(user_id) AS owners, count(*) AS n
  FROM whatsapp_config
  GROUP BY phone_number_id
  HAVING count(*) > 1;
  ```

  If that returns rows, `DELETE` the duplicate row(s) you want to
  drop, then re-run the migration.

### Note on multi-user setups

wacrm is intentionally **single-tenant per WhatsApp number**. RLS on
`conversations`/`messages` is `auth.uid() = user_id`, so a second
user physically cannot read messages routed to a different owner —
two users sharing one number was never supported. If you need
multiple humans handling the same inbox, run them under one shared
account.

## [0.2.0] — 2026-05-22

The **Flows** release. Adds a no-code, branching, button-driven WhatsApp
conversation engine that runs alongside Automations. Also ships a
5-theme color picker in Settings and opens Flows to all users.

### Added

#### Flows — branching chatbot conversations

- **Module + schema.** New `flows`, `flow_nodes`, `flow_runs`,
  `flow_run_events` tables with partial unique indexes that enforce
  one active run per contact. Widened `messages.content_type` CHECK
  to accept `'interactive'`; added `interactive_reply_id` column so
  the inbox can render button/list taps.
  ([#112](https://github.com/ArnasDon/wacrm/pull/112))
- **Runner engine.** `dispatchInboundToFlows` parses every inbound
  webhook, decides whether the message is a reply on an active run
  or a fresh trigger, advances the state machine, and reports back
  to the webhook so consumed messages don't also fire automations.
  Idempotent on Meta's `message_id`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))
- **No-code builder UI** at `/flows`. Linear-list editor with
  per-node config forms, live validator, draft/active/archived
  status, and a 5-route REST API (`GET/POST /api/flows`,
  `GET/PUT/DELETE /api/flows/[id]`, `POST /api/flows/[id]/activate`,
  `GET /api/flows/[id]/runs`, `GET /api/flows/templates`).
  ([#115](https://github.com/ArnasDon/wacrm/pull/115))
- **Templates + v1.5 node types.** Three starter templates
  (Welcome menu, FAQ bot, Lead capture) cloneable from the New-flow
  dialog. Three new node types: `collect_input` (capture customer
  text into a variable), `condition` (branch on var / tag / contact
  field), `set_tag` (add or remove a tag). `{{vars.X}}` interpolation
  in send_message + collect_input prompts. Per-flow run-history
  viewer at `/flows/[id]/runs`.
  ([#117](https://github.com/ArnasDon/wacrm/pull/117))
- **Stale-run sweep cron** at `GET /api/flows/cron` — marks runs
  past their configured timeout (default 24h) as `timed_out` so
  abandoned conversations free up the contact for new triggers.
  Reuses `AUTOMATION_CRON_SECRET`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))

#### Color themes

- **5 color themes** (Violet default, Emerald, Cobalt, Amber, Rose)
  selectable from a new **Appearance** tab in Settings. CSS variables
  scoped under `html[data-theme="..."]`, applied at runtime via
  `dataset.theme`, persisted to `localStorage`. Inline boot script in
  `layout.tsx` replays the choice before first paint so there's no
  flash of the default.
  ([#132](https://github.com/ArnasDon/wacrm/pull/132))
- **Theme tokenization sweep** — every previously hard-coded
  `violet-*` Tailwind class replaced with `primary` tokens across
  ~49 files. Picking a non-violet theme now themes the whole app,
  not just the chrome.
  ([#133](https://github.com/ArnasDon/wacrm/pull/133))

### Changed

#### Flows — soft-GA

- **Flows is now available to every authenticated user.** The
  per-account beta gate is gone; the sidebar entry + page header
  carry a small "Beta" chip as the only remaining signal.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))
- **Editor UX**:
  - Internal `node_key` + per-button/row `reply_id` identifiers
    hidden behind a per-node "Show advanced" disclosure.
    ([#118](https://github.com/ArnasDon/wacrm/pull/118))
  - `send_list` nodes can have multiple sections.
    ([#119](https://github.com/ArnasDon/wacrm/pull/119))
  - Collapsed node cards show a 1-line content preview per node
    type (text excerpt, button titles, condition summary, etc.).
    ([#120](https://github.com/ArnasDon/wacrm/pull/120))
  - Validation issues are clickable: jump to + flash the offending
    node.
    ([#121](https://github.com/ArnasDon/wacrm/pull/121))
  - Unsaved-changes "● Edited" indicator + `beforeunload` reload
    guard.
    ([#122](https://github.com/ArnasDon/wacrm/pull/122))
  - New-flow dialog actually widens to fit the 3 template cards
    (was capped at 384px by a baked-in `sm:max-w-sm` from shadcn).
    ([#129](https://github.com/ArnasDon/wacrm/pull/129),
    [#131](https://github.com/ArnasDon/wacrm/pull/131))
  - Validation panel pinned to the viewport bottom so
    activate-readiness follows the user as they scroll through nodes.
    ([#130](https://github.com/ArnasDon/wacrm/pull/130))

#### Engine reliability

- **Atomic `execution_count` increment** via SECURITY DEFINER RPC —
  prevents lost counts when two webhooks start runs concurrently.
  Mirrors the automations engine pattern.
  ([#124](https://github.com/ArnasDon/wacrm/pull/124))
- **Preload all flow_nodes once per dispatch** — one SELECT per
  inbound instead of one per advance-loop iteration. A 5-node
  auto-advance chain now costs 1 round trip, not 5.
  ([#125](https://github.com/ArnasDon/wacrm/pull/125))
- **Wasted re-read dropped** after reprompt reset; `loadActiveRun`
  switched to defensive `.limit(1)` so a migration glitch producing
  duplicates can't crash dispatch.
  ([#126](https://github.com/ArnasDon/wacrm/pull/126))

### Security

- **PII redacted from `reply_received` event payload** — customer
  text is no longer persisted to `flow_run_events.payload`; only
  the length is. A `collect_input` prompt asking "what's your card
  number?" used to leave the PAN sitting in the events table.
  ([#123](https://github.com/ArnasDon/wacrm/pull/123))
- **Constant-time cron-secret compare** on `/api/flows/cron`
  (`crypto.timingSafeEqual`) to close a theoretical
  timing-side-channel on the `x-cron-secret` header check.
  ([#127](https://github.com/ArnasDon/wacrm/pull/127))

### Fixed

- **`/flows` no longer spuriously redirects to `/dashboard`** when
  navigating in. Root cause: `useAuth` flipped `loading: false`
  before the profile fetch resolved. `use-auth` now exposes a
  separate `profileLoading` boolean.
  ([#128](https://github.com/ArnasDon/wacrm/pull/128))

### Migration required

Apply, in order, against your Supabase project:

1. `supabase/migrations/010_flows.sql` — Flows core tables, indexes,
   RLS policies, and the `messages` schema widening.
2. `supabase/migrations/011_profile_beta_features.sql` — adds the
   `profiles.beta_features` column. Surviving for future betas;
   Flows no longer reads it.
3. `supabase/migrations/012_flows_increment_counter.sql` — atomic
   counter RPC. Without this the engine still runs but
   `flows.execution_count` is racy.

Each migration is idempotent — safe to re-run if you're not sure
whether you applied a previous one.

### Removed

- **`src/lib/flows/feature-flag.ts`** + its tests. Flows is open to
  all users; the `profiles.beta_features` column itself survives
  for future beta gates.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))

---

## [0.1.1] — 2026-05-19

### Added

- Chat actions in the inbox: emoji reactions, reply-with-quote, and
  copy-text on individual messages. Hover on desktop, long-press on
  touch. Outbound reactions and replies forward to WhatsApp via the
  Cloud API; inbound reactions and swipe-replies from customers
  arrive through the webhook and appear in real time.

### Migration required

- Apply `supabase/migrations/009_message_actions.sql` to your
  Supabase project. It adds `messages.reply_to_message_id` and the
  new `message_reactions` table (with RLS and realtime). The
  migration is idempotent — safe to re-run.

### Changed

- The webhook no longer stores inbound customer reactions as fake
  text messages. They are written to `message_reactions` instead,
  so any custom queries that counted reactions as messages will
  need updating.

---

## [0.1.0]

Initial template release. Core CRM: inbox, contacts, pipelines,
broadcasts, automations (with a Wait-step cron drain), WhatsApp
Cloud API integration, Supabase auth + RLS.
