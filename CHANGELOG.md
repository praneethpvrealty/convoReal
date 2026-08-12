# Changelog

User-visible changes in `convoreal`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0, `MINOR` bumps cover new modules; `PATCH` bumps cover bug fixes
and polish.

## [Unreleased]

### Added

- **Voice notes, understood and acted on.** A voice note sent to the
  WhatsApp assistant is now transcribed once and read as text by every
  path that already existed — so speaking a listing files a listing,
  speaking a contact files a contact, speaking *today* returns your
  agenda, and speaking a correction edits the open draft. Before this,
  audio reached exactly one destination, the calendar parser: anything
  that wasn't an event came back "I couldn't find an event or task in
  that", and a voice note that arrived while a listing draft was open
  matched no branch at all and was answered with **nothing** — no reply,
  nothing saved. Non-English notes are transcribed and translated, so a
  listing dictated in Hindi, Telugu or Kannada goes through the same
  prompts as a typed one. When the assistant still can't place what was
  said, it now quotes the transcript back, so a misheard word is
  distinguishable from a misunderstood request. Voice-created events
  keep the transcript on the record. Spoken scheduling costs the same as
  it did (`voice_transcribe` + `event_parse` = the old
  `voice_event_parse`); everything else voice can now do is new.

- **The map pin that arrives before its listing.** Forwarding a Google
  Maps pin to the WhatsApp assistant on its own used to come back with
  "I couldn't tell what that was", and the pin was gone — so the listing
  details sent seconds later were saved with no coordinates, invisible
  to radius matching and ad targeting, even though the lister had sent
  the most precise thing they had. The pin is now acknowledged, named
  where the geocoder can name it, and attached to the next listing draft
  that sender opens: map link, coordinates, and whichever of
  locality/city/state the listing itself didn't state. The listing's own
  words always win — a pin only fills gaps, and a listing carrying its
  own pin is left alone. Held for 15 minutes only: stamping a stale pin
  onto an unrelated property puts it in the wrong place, which is worse
  than leaving it unpinned. A pin sent *during* an open draft already
  worked and is unchanged. **Migration required:** `261_pending_map_pins.sql`.

- **Ask an owner for the property details, in one message** (**migration
  required**: `262_owner_details_request_settings.sql`). The first message an
  agent sends a seller, and the one that moves them onto the business number.
  **Ask for Details** on a web contact, **Ask Details** on the mobile contact
  screen.

  It goes from the agent's **own** WhatsApp, because that is where first
  contact with a seller happens — there is no open 24-hour window on the
  business number until the owner writes to it, and there may never be one.
  So the message carries a one-tap link to the office number with `START
  UPDATES` pre-filled: the owner's tap opens the window, creates the thread
  the whole team can see, and records digest consent at the same moment.
  That is what makes the closing promise — every enquiry, every shortlisted
  buyer, every site visit, every offer — something the Engine can actually
  keep rather than a claim. Sending from the office number stays available
  for an owner already inside the window; outside it the route answers 409
  and both surfaces fall back to the same hand-off instead of dead-ending.

  **The first ask is the minimum, and asks for no documents.** No title deed,
  no khata, no encumbrance certificate: papers change hands after a buyer is
  finalised and the token is paid, and the message says so in as many words.
  The papers checklist still exists and is one tap away for the agent who has
  reached that stage. The rest of the checklist follows the property's own
  type, so a plot owner is never asked for a BHK configuration or a building
  sanction.

  A brokerage can make it theirs in **Settings → WhatsApp → Owners**: pick
  what the first ask carries, or replace the prose entirely with
  `{{placeholders}}`. Keeping `{{checklist}}` means even a fully rewritten
  message still asks the right questions for the property in front of it, and
  `{{engine_link}}` keeps the one-tap hand-off. Leave both empty and the
  built-in message is what goes out, forever.

  Wording lives in `src/lib/owners/details-request.ts`, sends through
  `POST /api/owners/details-request`, and is stored per account in
  `owner_details_request_settings`. The mobile copy of the builder is
  drift-guarded literal by literal in `src/lib/mobile-parity.test.ts`. The
  settings *editor* is web-only for now — the message itself is at full
  parity, and the gap is recorded in `FEATURE_ROADMAP.md`.

- **The confidential-listing request drawer, on the phone.** Tapping the
  Confidential chip on a property card in the app now opens who asked for
  access, what came of each request, and who can open the listing right
  now — with Revoke. The counts shipped to mobile without the action
  behind them, which left an agent away from a desk able to see that
  someone could open a listing and unable to stop them. Status wording is
  shared with the web drawer, so a timed-out request reads "No answer" on
  both rather than "Rejected" on one.

- **Focus — the screen to open the app on.** A consultant's day in three
  answers, on web (`/dashboard?tab=focus`, now the tab an unqualified
  `/dashboard` lands on) and in the app (More → Focus). **Tasks &
  visits** is today's appointments and open to-dos, with overdue rows
  labelled rather than hidden and located appointments counted as site
  visits. **Top journeys** ranks live journeys by the priority a human
  set, then how close to closing they are, then how long they have sat
  still — and never spends two of the three slots on one relationship
  seen from both the buyer's and the property's end. **Requests to act
  on** merges four inbound queues into one ranked list: Owners Den
  offers, pending listing submissions, unanswered property inquiries and
  new Match Radar events, scored by kind, by how soon they expire, and
  by how long someone has been waiting. Each web card expands in place —
  journeys open the real Journey map inside Focus, not a picture of it.
  The ranking itself lives in `src/lib/focus/rank.ts` and reaches both
  surfaces through `GET /api/focus`, so the phone and the browser can
  never disagree about what to do next.

  The Today tab became Focus: its agenda is now the Tasks & visits card,
  and its other signals — reply windows closing, hot leads going quiet,
  the day's numbers — render underneath. `/today` redirects to Focus on
  web, `/today` deep links open Focus on mobile, and a Focus pin
  replaces a Today pin in the app's More menu (an existing Today
  favourite is dropped rather than pointing at a screen that is gone).

  **Migration required:** `259_focus_read_access.sql`. It gives
  `contact_property_inquiries` the `account_id` every other operational
  table has (backfilled from `contacts`, with a membership RLS policy
  alongside the legacy owner one) — until now a portal inquiry was
  visible only to whichever member happened to own the contact row, and
  `/api/contacts/merge` was already writing to a column that had never
  been added. It also gives `public_listing_submissions` the SELECT
  policy it never had, so a seller's submission is readable by the
  account it was addressed to. Writes to both stay exactly as they were.

- **Mobile: the helper speaks the agent's language.** The copilot chat,
  guided-tour tooltips and floating button now render in the app
  language the agent picked on the web (Hindi, Kannada, Tamil, Telugu,
  Malayalam or Marathi) — read straight off
  `profiles.active_ui_language`, exactly the handoff migration 247
  planned for. The app carries a pure ported slice of the web catalogue
  (`mobile/lib/i18n.ts`), held byte-equal per language by
  `mobile-parity.test.ts`, so the two helpers can never drift apart. On
  web, the helper's own chrome (title, greeting, guides list, tour
  buttons, feedback row) joins the catalogue too. No migration — the
  language columns shipped with the multi-language release.

- **Web Contacts: filter "Enquired for" by project.** The starred-property
  chips gain the mobile app's project axis — a **Project** picker beside
  the chips (fed from `properties.project`, so units never linked to a
  project row still count) narrows the list to everyone interested in
  ANY unit of a tower: first-choice inquiries across all its units plus
  contacts who named the project in their stated or AI-extracted
  preferences. A per-unit chip only ever found a fraction of a tower's
  buyers. The active filter mirrors to `?interest_project=` and survives
  refresh, mutually exclusive with the property chips. Interest-filter
  id lists are now bounded (150 contacts / 200 units), matching the
  mobile port.

- **Web Inventory: map view and "Near me".** The mobile app's two
  location features arrive on desktop. A List/Map toggle beside the
  listing tabs draws the current search as the app's violet price pins
  (click one to open the listing) on a dark-styled Google map, and a
  **Near me** button beside the locality filter runs the same radius
  search from the browser's location — no new API surface, the
  properties route already accepted the coordinates. The map needs a
  referrer-restricted `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`; without it
  the view explains itself instead of breaking. Rows without saved
  coordinates don't appear as pins (the geocode backfill self-heals).
- **Copilot usage metering.** Every helper interaction — chat answers
  (with platform and coverage), guided-tour starts and completions on
  web and mobile, support tickets — now lands in `copilot_events`, and
  **Admin → Demand** opens with a 30-day adoption rollup: chats split
  web vs mobile, tours started/completed, tickets filed. Aggregation
  runs in SQL (`copilot_usage_summary`); tenants' admins can read their
  own team's rows. **Migration required:**
  `supabase/migrations/245_copilot_events.sql` (SQL Editor, like 244).

- **Copilot on mobile: chat, guided tours and a spotlight overlay.** The
  helper is no longer web-only. A floating button on the app's main
  screens opens the same chat brain (`/api/copilot`), and tours that can
  run on a phone (add a contact, send a broadcast, check Pulse) spotlight
  the real buttons with a native scrim + tooltip — the engine navigates
  between screens itself. Answers are **platform-aware**: every mobile
  reply carries a coverage verdict, so a doable task gets in-app steps
  plus a "start the tour" offer, a desktop-only task (connect WhatsApp,
  templates, email lead sync…) gets an "open on desktop web" link, and
  anything the helper can't (fully) answer offers the support team.
- **Help desk: "Ask the support team" from the helper chat.** On web and
  mobile, an unanswered question files a `support_tickets` row (reference
  `HELP-XXXX`) with the question, the helper's reply and the page it was
  asked from. The user picks how the answer should come back — WhatsApp
  or email. Platform staff triage from **Admin → Support**: assign,
  write the answer, and Send delivers it over the chosen channel
  (WhatsApp via the platform sender with free-form fallback, email via
  Resend) and records what actually went out. **Migration required:**
  `supabase/migrations/244_support_tickets.sql` (also adds the
  `coverage` column + updated `match_copilot_qa` for the mobile answer
  cache — apply in the Supabase SQL Editor like 109/236).

- **Mobile: the same Filters chip on the Properties tab.** The listing
  pills (All / Sale / Rent / JV-JD), Near me and "Include unavailable"
  were the whole filter surface; everything else `GET /api/properties`
  understands was unreachable from a phone. A **Filters** chip now opens
  a sheet with category and property type, status, price from/up to,
  listed by (owner or agent), showcase state, and sort — badged with how
  many are on, applying live, with the footer counting the listings left.
  The Properties list and the map screen share one filter state, so both
  keep showing the same set. Sort is suppressed under a location filter
  and says so, because the route's tiered near-search orders by distance
  and ignores it. No new API surface — every option is a param the route
  already accepted.

### Fixed

- **A visitor with site data blocked got the error page on every
  showcase link.** Chrome with cookies/site data blocked does not return
  null from `localStorage` — reading the property throws. The showcase
  read it unguarded while restoring saved filters, so the page fell to
  the error boundary for that visitor while working for everyone else,
  on a URL that served a correct 200. Every web-storage read and write
  now goes through `src/lib/safe-storage.ts`, which degrades to "not
  remembered" instead of throwing.

- **A listing's own photos disappeared from the app once it was made
  confidential.** Gating moves the photos into the guarded bucket so a
  forwarded public link cannot carry them — but every internal view read
  the public `images` array alone, so the agent's own gallery and card
  cover went blank. The photos were never lost; nothing was reading them.
  Internal galleries now fall back to the authenticated proxy, which
  re-checks the viewer on every request. Publishing paths — share links,
  flyers, portal post kits — deliberately still see only public photos.

- **The watermark on confidential photos never marked anything in
  production.** Guarded photos are stamped with the recipient's masked
  number so a forwarded screenshot is traceable, and the copy tells the
  recipient so. The overlay was drawn as SVG text; the runtime has no
  fonts for that renderer, so it composited cleanly and drew nothing —
  a photo served live differed from the stored original only by
  re-encoding. The label is now drawn from a bitmap font straight into
  pixels, with no renderer involved, and the tests compare against a
  plain re-encode so a silent no-op fails them.

- **"Residential" searches missed plots and land listed after the type
  split.** `Residential Plot` and `Residential Land` replaced the single
  `Residential Land/ Plot` option, but the category map behind natural-
  language search and the type filter was never updated — so a plot
  saved after the split fell out of every "residential" query, on web and
  in the new mobile category filter alike. The map now covers the whole
  authoring vocabulary of each group (PG listings were missing too), with
  the legacy value kept alongside its replacements, and a test that fails
  if the two ever drift again.

- **Mobile: filter contacts by the property or project they enquired
  for.** The Contacts tab had one axis of filtering — the five segment
  pills (All, Needs Review, Favourites, Transacted, Active Buyers) —
  and no way to ask the question an agent standing in a tower actually
  asks: who wanted this. A new **Enquired for** chip leads the filter
  row and opens a picker. It opens on the listings starred in
  Inventory, so the six quick filters the web Contacts page shows as
  chips are one tap away here too, and search reaches any other listing
  by code, title or project. Picking a **project** rather than a single
  unit is the mobile addition: a tower's buyers are spread across its
  units and across stated preferences, so that filter unions everyone
  who enquired about any unit in the project with everyone whose
  preferences name it, and each row says which unit it matched. The
  active chip carries the code or project name and its own clear
  button.

- **Mobile: the rest of the web Contacts filters.** A **Filters** chip
  beside it opens the web Filters dialog's remaining controls —
  classification, tag, budget from/up to, area of interest and sort —
  as a sheet of chips rather than dropdowns, carrying a badge of how
  many are on. Selections apply as they are made and the footer button
  counts what is left ("Show 12 contacts"), so a chip's effect is
  visible without dismissing the sheet. Semantics match web exactly: a
  *budget from* bound admits contacts marked as having no budget
  constraint, a *budget up to* bound does not, and the budget ladder
  itself is now a shared constant that a drift test holds the two
  platforms to. Segment counts hide while any narrowing filter is on
  rather than contradicting the list below them.

- **Shared requirements can now be answered, not just read.** Passing a
  client brief to another brokerage used to be copy-pasted text: the
  broker read it on their personal WhatsApp and, if they had something
  matching, forwarded it back as a message you had to qualify and type
  into inventory yourself. The share dialog now attaches a link to each
  brief. The broker opens it, sees the requirement — masked by default,
  so the budget and locality travel under a code like `REQ-A3F2` while
  the client's name, your tags and your notes stay behind — and sends a
  matching property straight from that page. If they would rather use
  WhatsApp, the same page hands them your Engine number with the code
  filled in; texting it starts the guided listing bot, so a broker who
  only ever forwards photos gets walked through a proper listing. Both
  routes land the property in Inventory under **Review** with the
  requirement reference on the confirmation and a note on the client's
  card recording who answered, and the sender is filed as an Agent
  rather than an owner lead, so responding to a brief builds out your
  co-broker network. Links carry an expiry and can be revoked; a dead
  one reveals nothing.
  **Migration required:** `210_requirement_share_links.sql`.
- **Service credit: extend a customer's subscription when we let them
  down.** After an outage, a slow patch or a billing mistake on our
  side, a super-admin can now add paid days to affected accounts from
  Admin → Extensions — one account, or a whole incident at once under a
  shared incident reference that can later be revoked as a unit. The
  credit is confirmed with a WhatsApp code sent to the acting admin's
  own number, the same step-up the plan override uses, and the code is
  bound to a hash of the exact request: a code issued for "3 days to one
  account" cannot be replayed to apply "90 days to everyone".
  Extensions live in their own ledger rather than overwriting the
  billing period, so the next gateway renewal can't silently erase
  them, and a one-off credit can never turn into free days on every
  future cycle. Owners see the extra time on their own billing screen.
  **Migration required:** `204_subscription_extensions.sql`.
- **Affected customers are told, in words that own it.** Granting an
  extension sends the account owner a message on WhatsApp, by email and
  to their in-app bell — from ConvoReal's own number, not the tenant's.
  When the reason is our fault (outage, degraded service, billing
  error) the message leads with an apology and says so plainly; when the
  days are a goodwill gesture it stays warm without inventing a fault
  that didn't happen. WhatsApp delivery goes through two new Utility
  templates so it reaches customers who haven't messaged us recently;
  the admin can create them in one click from the same screen, preview
  the exact wording before approving, and replace the default line with
  their own. Per-channel delivery is recorded against each grant, so an
  apology that failed to send is visible rather than silently lost.

### Fixed

- **A booking with a real date now reaches the calendar.** "Meet lawyer
  Kusuma regarding the Whitefield property on 30th July 2026" was filed
  as a *contact draft* instead of an appointment: the scheduling gate
  recognised only relative days ("tomorrow", "next Friday") and clock
  times ("at 4pm"), so a stated calendar date counted as no time at all
  and the message fell through to contact ingestion. Written-out dates
  ("30th July", "Jul 30"), numeric dates ("30/07/2026") and named
  weekdays ("on Friday") are now cues, the WHEN may come before the verb
  or on its own line, and a date with no time of day books at 10:00 IST
  rather than midnight. Forwarded portal leads that mention a day
  ("...is interested in the HSR plot, call him on Monday") still go to
  contact intake, and property figures — "2-3 crore", "3.50 acres" — are
  not mistaken for a date or a time. Applies to both the agent's own
  bookings and a lead asking for a visit.

### Changed

- **Agent inventory digests now send through the owner digest's
  template.** They no longer have a template of their own. Four
  agent-specific submissions were each approved by Meta as MARKETING —
  billed at the marketing rate and requiring marketing opt-in — even
  after the wording was stripped down to a near word-for-word copy of
  `owner_property_digest`, which Meta had approved as UTILITY three
  weeks earlier. A template's category is fixed at first review and can
  never be edited, and deleting one reserves its name for four weeks,
  so each attempt burned a name permanently. Both digests declare the
  same three body params, so the agent digest reuses the approved
  template and inherits its UTILITY category. Accounts still holding an
  approved agent-specific template keep sending from it as a fallback.
  The trade-off is coupling: the two digests now share one Meta
  template, so a re-categorisation, quality pause, or deletion affects
  both at once. Background and the rules that make this permanent are
  documented in the header of
  `src/lib/whatsapp/agent-inventory-digest-template.ts` and in
  `AGENTS.md` §2.7.

- **The WhatsApp assistant's help card now says what it can actually
  do.** Texting your own Engine number used to answer with a four-line
  "AI Ingestion Chatbot" card that only described draft-session
  commands — and showed `*Cancel*` literally, because it used Markdown
  bold instead of WhatsApp's. Send *help* (or hi / menu / start) and
  you now get the real capability guide with worked examples: add a
  listing from text, an ad screenshot or a brochure PDF; add a contact
  or portal lead; the *today* agenda, event and to-do commands and
  voice notes; answering a lead alert directly; and the photo /
  plain-language-correction / Confirm / Cancel / 15-minute-expiry rules
  for an open draft. A message that classifies as neither a listing nor
  a contact now gets a short "couldn't tell what that was" with the
  three likely intents instead of the whole menu.

### Added

- **Reply to a lead straight from the WhatsApp ping.** The
  "💬 New lead just messaged you" alert that lands in your own
  WhatsApp is now answerable: reply to it (quote it) and the text is
  delivered to the lead as a normal agent message, visible in the
  shared Inbox like any other reply. ConvoReal answers with
  "✅ Sent to <lead>" — quote that to keep talking — and mirrors the
  lead's later messages to your WhatsApp so the whole exchange can
  happen from your phone without opening the app. Text only; media and
  templates still go through the Inbox. Outside Meta's 24-hour reply
  window you get a "couldn't send" note with a link to re-engage by
  template instead. Only the staff member the ping was addressed to
  can reply through it, and read-only members can't.
  **Migration required:** `171_whatsapp_reply_bridges.sql`.

- **Mobile: property quick-edit + showcase sharing.** The property
  screen's action rail gains **Edit** — a mobile-scale form for the
  fields agents change in the field (title, price or rent +
  maintenance, status, bedrooms/bathrooms/area, description,
  published toggle), saving through the same `PUT /api/properties`
  route; photos, locality and deal terms stay in the web's full
  form. The Properties tab header gains a **share showcase** button
  that opens the native share sheet with the account's public
  showcase link (subdomain-aware). Showcase links already deep-link
  into the app for users who have it installed (`+native-intent`
  maps `?property_id=…` to the property screen) — App Links verify
  once an EAS build ships with the site's cert env set.

### Added

- **Mobile: release scaffolding.** `mobile/eas.json` with
  development / preview (internal APK) / production (Play .aab,
  auto-increment) profiles; a brand launcher icon, adaptive icon,
  splash and favicon in the aurora-glass palette (lime chat bubble
  with a house cutout on the deep aurora green — generator in
  `scratch/gen_app_icons.py`); and `mobile/RELEASE.md` documenting
  the path to stores: EAS env setup, build/submit commands, App-Link
  cert envs, store checklists, and OTA updates via `eas update`.

- **Mobile: Connection check (More → Workspace).** A support screen
  that runs the probes separating the "Unauthorized" failure modes —
  which Supabase project the app points at, session and refresh-token
  validity at that project, and live API probes with a fresh token
  against both the configured and `www` hosts — color-coded, made to
  be screenshotted into a bug report.

### Fixed

- **Mobile: dead sessions now recover instead of endless
  "Unauthorized".** When the API keeps rejecting the token AND the
  refresh token is also dead (a sign-out on another surface — e.g.
  Den ↔ staff switching — revokes the whole session), the app now
  signs out cleanly so the next sign-in mints a working session.
  Previously direct reads kept working off the cached token, hiding
  the breakage while every API action failed. Also: the hold-to-peek
  expansion animates smoothly — rows below glide down/up (layout
  transitions) instead of jumping, and the capsule fades in and out.

- **Mobile: sends failing "Unauthorized" even after the redirect
  fix.** Some RN fetch stacks don't report the final URL after a
  redirect, so the apex→www detection could miss. `apiFetch` now has
  a deterministic fallback: still-401 on an apex base → retry the
  `www.` variant directly and pin it on success.

- **Mobile "Import from Phone" crash on SDK 57.** `expo-contacts`
  moved its function API (`getContactsAsync` & co.) behind the
  `expo-contacts/legacy` entry point; the import now targets it.

### Changed

- **Mobile: swipe-back navigation.** Screens slide in from the right
  and swipe back out: full-screen swipe-back on iOS, and Android's
  predictive back gesture is enabled (`predictiveBackGestureEnabled`,
  applies to EAS builds) so the system edge swipe animates through
  app screens. The header up-arrow stays — it's Material convention
  too, and the only reachable affordance on tablets.

### Fixed

- **Mobile "Unauthorized" on every API send — apex-domain redirect.**
  `convoreal.com/api/*` 308-redirects to `www.convoreal.com`, and
  fetch strips the `Authorization` header on cross-origin redirects —
  so every authenticated call from the app arrived anonymous and
  401'd while direct Supabase reads kept working. `apiFetch` now
  detects the redirect's final origin, pins it for the session, and
  re-issues the request there with the header (media URLs use the
  pinned origin too). Setting `EXPO_PUBLIC_API_BASE_URL` to the
  canonical `https://www.convoreal.com` avoids the extra hop
  entirely.

### Changed

- **Mobile: the desktop ConvoReal loader, ported.** Loading states
  across the app (boot gate, thread, contact, property, broadcasts,
  automations, calendar, credits, template picker) now show the
  web's wordmark loader — "ConvoReal" with a bright band sweeping
  through the letters (same 1.6s loop, primary→white→primary),
  rebuilt natively with a text mask + animated gradient, static
  under reduced motion. New dependency:
  `@react-native-masked-view/masked-view` — run `npm install` in
  `mobile/`. Inline button/row spinners stay as-is.

- **Agent replies clear the chatbot handoff flag.** When the bot
  hands a customer to staff ("Talk to an Agent"), the conversation
  goes `pending`; it now flips back to `open` automatically as soon
  as a human sends any message (web or mobile), and the mobile
  thread header spells the state out ("Needs your reply") instead
  of a bare "Pending" that read like the contact's review status.
  Mobile API calls also retry once with a refreshed token on 401 —
  a sign-out on another surface could revoke the token and surface
  as "Unauthorized" on send while the rest of the app kept working.

- **Mobile: long-press menus are launcher-style popovers.** The
  WhatsApp button's long-press options opened as a giant centered
  system dialog; they now appear in a compact floating menu anchored
  right at the pressed button (icon + label rows, themed, opaque),
  like the Android home-screen context menu.

- **Mobile Contacts: compact rows, one WhatsApp button.** Contact
  rows slim down to the essentials — avatar, name with a small
  inline call button, classification + phone, last-contacted time —
  and a single WhatsApp button on the right. Tapping it opens
  WhatsApp with the prefilled welcome message; long-pressing offers
  the two other sends: a blank WhatsApp chat, or an internal message
  in the Engine inbox (creating the conversation first if none exists,
  like the web). Long-pressing the row opens a quick preview sheet
  with the details the row no longer carries — budget, tags,
  interested-in properties, areas, email, company, last contacted —
  and an "Open full contact" button; a plain tap still goes straight
  to the contact screen. Refined to hold-to-peek: a row-sized capsule
  expands inline right below the pressed row while the finger stays
  down — flashlight accent, real shadow, two crisp lines (budget /
  company, then areas · tags · ★ interests · last contacted) — and
  collapses the moment it lifts. Budgets with only one bound now read
  "Up to ₹4.4 Cr" / "₹2 Cr+" instead of "— – ₹4.4 Cr" (also fixed on
  the contact card).

- **Mobile Contacts: the Agents entry is a tie-person glyph with an
  "Ag" caption.** The briefcase icon didn't say "Agents" (user
  feedback); after comparing candidates, the entry is now the
  person-with-tie icon over a tiny "Ag" monogram — same footprint
  and color as its icon neighbours.

- **Mobile bottom sheets are opaque again.** The shared sheet used a
  translucent glass fill, so the screen underneath read straight
  through "Import from phone", "New contact", the share sheet and
  every other sheet. Sheets now use a near-opaque surface (the same
  rule as dropdowns and sticky bars: glass belongs on surfaces over
  the aurora, not on overlays above content).

- **Inventory mobile search no longer hides the results.** On phones,
  the search overlay dropped a full-screen dim scrim over the list —
  results updated live behind it but were blacked out until "Show
  results" closed the panel. The panel is now an in-flow sticky card
  that pushes the list down instead of covering it: results stay
  visible and filter live as you type; the button became "Done".

### Added

- **Mobile: desktop-parity approve + connected properties; staff
  numbers excluded.** Approving a Needs-Review contact no longer
  asks through a system dialog — one tap flips them active and,
  like desktop, auto-sends the inquired property's details
  (address + map link) through the Engine WhatsApp number; outside
  Meta's 24-hour window it opens the thread for a template send
  instead. Contact screens now show connected properties like the
  web card: Managed properties for Owner/Seller/Developer (and
  agents' showcase list), and Interested properties for buyers
  (inquired + marked interests, tap-through). Team members' own
  WhatsApp numbers no longer appear as leads — contacts matching a
  staff profile phone are filtered from the list and the segment
  counts.

- **Mobile Agents: two-pane layout, Requirements and Schedule.** On
  wide screens (tablets/foldables ≥700dp) the Agents screen becomes
  the desktop two-pane directory: agent list on the left, full
  detail on the right with the action row (Call / WhatsApp / Inbox /
  Journey) — no more bouncing back to the list. The agent detail
  (both panes and the contact screen) gains the desktop tabs that
  were missing: a **Requirements & brief** editor (saves to the
  contact like the web tab) and a **Schedule** section listing every
  appointment involving the agent — primary or multi-attendee —
  upcoming first with history below, plus a Schedule shortcut that
  opens the new-appointment form with the contact prefilled.

- **Mobile: prefilled WhatsApp welcome message.** The desktop
  contacts page's "Send pre-filled welcome message" button now
  exists on the app. Contact rows gain a WhatsApp button and the
  contact card's WhatsApp action opens WhatsApp with the same
  drafted message desktop builds: a personalized greeting, the
  qualification questions (location/budget/type/stage), and
  showcase links — the exact enquired property plus similar
  matches when the lead has one, otherwise links filtered by their
  areas/property interests (subdomain-aware, `ref` fallback). The
  row's chat bubble still jumps into an existing thread; when no
  thread exists it now falls back to the prefilled message instead
  of an empty WhatsApp compose.

- **Mobile: Agents directory + contact review actions.** A briefcase
  button on the Contacts tab opens the web Agents tab's mobile
  counterpart: every "Agent"-classified contact with company, phone
  and linked-property counts, searchable by name/company/phone. An
  agent's contact screen now shows their showcase properties (tap
  to open, unlink with confirmation — `owner_contact_id` cleared,
  same as the web) and agent notes (`contact_notes`, add + newest
  first). Review actions arrive too: contacts in Needs Review get an
  amber approve button right on the list row, and their contact
  screen shows a "Needs review — From {source}" banner with Approve
  (`status` → active), matching the web's approve flow. Sending
  property details after approval stays in the conversation thread.

- **Mobile Contacts: web-parity list features.** The Contacts tab
  gains the web page's marked features: quick-filter segments —
  All / Needs Review / Transacted / Active Buyers — with live counts
  and the exact same definitions as the web tabs (`status`
  active/pending_review, won-deal contacts, HOT-or-inquired);
  richer rows with a colored classification badge, up to three tag
  chips, starred "Interested in PROP-xxxx" chips (resolved from
  `property_interests` + last inquiry), and last-contacted time; a
  chat shortcut per row that jumps straight into the contact's
  latest conversation (falls back to WhatsApp when no thread
  exists); and **Import from Phone** — pick device contacts
  (expo-contacts) and create them through the same gated
  `POST /api/contacts` route, with duplicate/limit failures counted
  in the result. New dependency: `expo-contacts` — run `npm install`
  in `mobile/`. The Requirements tab stays web-only for now.


- **Mobile: the web's rich share dialog, on the property screen.**
  Tapping Share now opens a full share sheet instead of the bare OS
  sheet: To Client / To Co-Broker audience cards (client links open
  the showcase with the inquiry form; co-brokers get the clean
  `mode=view` page), tone (Professional/Casual/Friendly) and detail
  (Quick/Standard/Complete) pickers, an editable auto-drafted
  message — generated by a 1:1 port of the web's
  `share-message-builder`, so drafts match the web exactly — a
  copy-link row, and channel buttons: WhatsApp, Telegram, Email, SMS,
  Copy message, and "More apps…" (native share sheet). New
  dependency: `expo-clipboard` — run `npm install` in `mobile/`.
  Engine-tracked template sends stay in the conversation thread and the
  web dialog.

- **Auto-generated listing videos.** A "Listing Video" card on the
  property form builds a WhatsApp-ready vertical teaser (≤16MB,
  ~35s) from the listing's photos: Ken Burns motion, caption
  overlays, branded end card, background music, and narration via
  Sarvam AI in 11 Indian languages (English scripts are translated
  automatically; espeak fallback without a key). Renders run on the
  Redis queue worker (Dockerfile.worker now installs
  ffmpeg/fonts/espeak-ng), cost 50 credits — disclosed on the button,
  charged up front, auto-refunded on failure — and the finished video
  plays on the Showcase page next to the photos. **Migration
  required:** `151_listing_videos.sql`. Env: `SARVAM_API_KEY` on the
  worker (and Vercel for future use); credit policy documented in
  docs/credits-policy-listing-video.md.

### Fixed

- **Contacts page: slow networks get a Retry card, not an eternal
  spinner or fake counts.** The contacts load now races a 20s
  timeout; a stalled connection surfaces an inline "Couldn't load
  contacts / Retry" card instead of "Loading contacts..." forever.
  While loading, the tab counters show "…" instead of a false
  "All Contacts (0)". Navigation was never blocked during loads and
  stays that way — the sidebar remains fully tappable mid-load.

- **Slow networks no longer produce a "zombie" session.** When the
  post-login profile fetch stalled (flaky mobile connection), the app
  stayed stuck in a profile-pending state indefinitely: the header
  showed a generic "User", role gates treated the caller as
  least-privileged ("Read-only view — templates are managed by your
  Organization Manager"), and account-scoped lists rendered empty
  ("No templates yet") — misreporting both permissions and data. The
  profile fetch now times out per attempt (10s, one retry), a hang
  surfaces the existing "We couldn't load your profile / Retry"
  screen instead, and the Templates panel keeps its loader up until
  the profile actually resolves.

- **Page can no longer pan sideways on phones.** `overflow-x: clip`
  on `html`/`body` guarantees the page itself never scrolls
  horizontally — every intended horizontal scroller (tables, tab
  bars, chip rows) lives in its own container and is unaffected.
  Layout was verified to reflow cleanly down to a 260px effective
  viewport (high zoom / large text scaling) with no overflowing
  elements.

### Added

- **AI tag suggestions with tap-to-confirm.** The preference
  extraction now also proposes up to 3 short buyer-profile labels
  from the requirements text ("Investor", "Rental Income", "NRI"),
  shown on Requirements cards as dashed ✨ suggestion chips. Tapping
  one reuses an existing account tag with that name or creates it,
  then attaches it — suggestions are never applied automatically, so
  the tag vocabulary stays curated by humans. Chips disappear once a
  matching tag is attached. **Migration required:**
  `150_tag_suggestions.sql` (adds `contacts.pref_suggested_tags`).
  Existing contacts pick up suggestions the next time their
  requirements change (extraction skips unchanged text by hash).

- **AI-extracted preferences now visible everywhere, in sync.** The
  Gemini extraction that parses budgets, areas, and property
  interests out of a contact's requirements text (migration 092)
  previously fed only the matching engine — the Requirements cards
  and Contacts table showed just the manually-entered fields, so
  "Budget within 3 cr" typed into a demands statement still read
  "Not specified". A shared merge (`src/lib/contact-preferences.ts`,
  explicit fields always win, AI fills the gaps — the same rule the
  matching engine uses) now drives the Requirements card's Estimated
  Budget and new preference chips, plus the Contacts table's Areas
  of Interest / Property Category Interests / Max Budget columns.
  AI-derived values carry a ✨ marker so provenance stays visible;
  editing the contact's explicit fields overrides them.

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
  the whole Engine between the original dark look and a new light theme
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

- **Mobile: black map screen fixed + crash and deprecation fixes.**
  The Properties map (and the detail mini-map) rendered a black void:
  Google Maps needs an Android API key that was never configured, and
  Expo Go on Android can't render Google Maps at all (removed in
  SDK 53+). Both spots now show a graceful explainer with an "Open in
  Google Maps" handoff when native tiles can't render, and a new
  `app.config.js` injects `GOOGLE_MAPS_ANDROID_API_KEY` from the
  environment at build time — maps light up automatically in the EAS
  build. Also fixed: a hooks-order crash on the property screen
  (`useSafeAreaInsets` ran after the loading early-return, changing
  the hook count when data arrived) and the deprecated
  `experimentalBlurMethod` prop (now `blurMethod`) on all four
  BlurView call sites.

- **Mobile: Owners Den (tranche 1).** The owner-facing portal now
  lives in the app too, per the "same app, owner entry" decision.
  The staff login gains a "Property owner? Open the Owners Den" entry
  leading to the Den's own WhatsApp-OTP sign-in (signups allowed,
  `app_context: 'den'`, same as web /den/login; the idempotent
  `/api/den/auth/complete` runs on every entry so agency links stay
  fresh). A persisted surface flag routes each signed-in device to
  the staff Engine or the Den shell. Den screens: **Home** — activity
  totals (views / enquiries / shortlists / site visits) over a 7/30
  day window plus every linked property with per-property stats,
  agency and Deal Mode chips; **Offers** — the masked-bidder offer
  inbox with accept/decline (accept reveals the buyer contact with a
  WhatsApp shortcut, same mutual-reveal rules as web); **Settings** —
  display name, WhatsApp notification toggles, digest frequency,
  sign out. Deal rooms + Token Safe stay web-only for now.

- **Mobile property detail: quick actions.** A new action rail under
  the price — Share (native share sheet with the public showcase
  link, same URL the web Share dialog builds), Email (prefilled
  composer), Archive/Unarchive (the web's status-flip via
  `PUT /api/properties/[id]`), and Delete (confirmed, destructive,
  via the same API route as the web) — with busy states and friendly
  error alerts. Flyer and Post Ad stay web-only (browser canvas and
  the Chrome portal extension); Promote and full Edit arrive with
  broadcast composing / property editing.

- **Mobile property detail: web parity + readable locality
  dropdown.** The locality autocomplete dropdown now sits on a solid
  panel — its translucent glass fill let the filter chips and cards
  underneath read through the suggestions, making them illegible.
  The property detail screen now mirrors the web modal's view mode:
  type / Agent Referred / Via WhatsApp badges, "Equivalent to: ₹15
  Crore" wording under the price, Locality / Frontage / Ownership
  spec tiles, a conditional Listing Metadata card (super built area,
  dimensions, frontage/depth, road width, land zone, ideal for,
  rental income with computed yield), a floor-wise tenancy rent-roll
  section, Nearby Landmarks chips, and the amber Engine-only Internal
  Notes block. Every section hides when the property has no data.

- **Mobile property detail: gallery + empty-field cleanup.** (1) Spec
  tiles (Bedrooms/Bathrooms/Area/Facing) and contact-card rows now
  hide when there's no value — web parity — instead of showing "—"
  (a commercial plot no longer advertises dashed-out bedrooms).
  (2) The photo gallery renders correctly on wide/foldable screens:
  pager math now uses the live window width instead of a stale
  module-scope Dimensions value, and the thumbnail strip no longer
  gets clipped by the overlapping content sheet. (3) Tapping the hero
  photo (or the new counter chip / "+N" thumb) opens a full-screen
  gallery viewer — black backdrop, swipe-paged, photo counter,
  safe-area close button, pinch-to-zoom on iOS. The sticky price bar
  also became near-opaque so scrolled content can't read through it.

- **Mobile: glass cards no longer show a grey shadow band (light
  theme).** Android draws elevation shadows UNDER a view, so on a
  55%-translucent glass card the shadow bled through the fill as a
  grey gradient inside the card (iOS layer shadows do the same).
  Shadows are now removed from every translucent glass surface —
  rows, panels, skeletons, search pill, GlassCard — whose depth comes
  from the fill + 1px light border, matching the mockups. Shadows
  remain only on opaque surfaces (gradient hero cards, blurred
  floating bars).

- **Mobile: uniform aurora backgrounds.** The first aurora renders
  showed wide vertical banding stripes ("seams") and visible glow
  rims on device — 8-bit quantization of very close dark base colors,
  magnified by stretching a 512×640 image ~3.7× onto a phone screen.
  The generator (`scratch/gen_aurora.py`) now renders at phone aspect
  (810×1755) with triangular dither noise and smoothstep glow
  falloff; both PNGs regenerated — backgrounds are now perfectly
  smooth in both themes.

- **Mobile: "aurora glass" design system.** Full visual re-skin per
  `docs/design/GLASS_UI_IMPLEMENTATION_SPEC.md`. Light mode is
  Option 7 "WhatsApp Native on Glass" — WhatsApp deep-green
  `#075E54` primary with bright-green accents, Inter typeface, and
  frosted white glass panels floating over a pre-baked daylight
  aurora background; dark mode is Option 4 "Liquid Glass" — lime
  `#C6F68D` primary and Plus Jakarta Sans over a deep forest aurora.
  New `AuroraBackground` (mounted once behind the root navigator;
  every screen went transparent) and `GlassCard` primitives; glass
  tokens (`glass`, `glassBorder`), per-theme shadows and a per-theme
  type scale + font map returned from `useTheme()` (screens resolve
  Inter/Jakarta at render). List rows, panels, chips, tags, search
  pills and sheets are now translucent glass with 1px light borders;
  the chat composer, property sticky bar and tab bar use real
  `BlurView` (kept off scroll-view cards for 60fps Android scroll,
  per the spec's perf rule); hot-lead rings became solid green
  (light) / glowing lime (dark); unread badges are bright green;
  bottom sheets gained a drag handle. The appearance setting stays
  exactly light/dark/system. New dependency:
  `@expo-google-fonts/inter` — run `npm install` in `mobile/`.

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

- **Mobile app: core Engine tranche — Inventory, Deals, Calendar,
  Templates (`mobile/`)** — the companion app grows from
  inbox+contacts to the core Engine pillars, in a 5-tab layout (Inbox /
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

Foundation for multi-user accounts. Every ConvoReal install becomes
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
