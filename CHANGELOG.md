# Changelog

User-visible changes in `convoreal`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0, `MINOR` bumps cover new modules; `PATCH` bumps cover bug fixes
and polish.

## [Unreleased]

### Merged 19 August – 19 September 2026 (#638–)

This file was unreadable from #614 until it was restored from the last clean
revision, so the pull requests merged in between carry their merge title rather
than a written entry. Newest first.

#### 26 September 2026

- **Guidance value pages without a column header keep the table's
  columns.** Ramanagara's village pages print dry, wet and garden land
  (lakhs per acre) and a site rate under a header on the first page only;
  continuation pages were read as site, apartment and commercial rates.
  Each read now tells Gemini the columns of the page before, and a site
  figure written into a lakh row keeps its own unit instead of being
  multiplied.

- **Guidance values printed in lakhs are stored in rupees.** Village
  tables in Ramanagara, Mysuru and Bengaluru print land rates "in lakhs
  per acre", and the reader stored 55 lakh as ₹55; on some pages it also
  filed the dry, wet and garden columns as site and apartment rates. The
  reader now marks lakh and crore columns and stores full rupees, and
  affected notifications are re-read.

- **Guidance value lookups find villages printed with a suffix.** A
  notification often prints a village as "Addoor Village (Gurupura Hobli)",
  and the spelling-tolerant lookup compared the whole name, so an RTC's
  Adduru found nothing once Mangaluru Taluk was re-read. Bracketed text and
  the words village and grama are now ignored on both sides. **Migration
  required:** `20260926031500_guidance_place_key.sql`.

#### 25 September 2026

- **Guidance value units come from the notification's header, as a hint.**
  The unit correction added below relabelled stored rates whenever a
  notification's text mentioned only one of sq m / sq ft, but such a
  mention is often a project's measured area, a site-size category or the
  carpet-area note, and some rates stored as sq ft are really per acre. It
  no longer changes rates: a unit stated in a rate header ("per Sq.Mtr") is
  now passed to Gemini as the default for tables that print none.

- **Guidance values say which land class an agricultural rate is for, and
  site rates keep the notification's own unit.** An agricultural village
  row carries four figures (dry, wet, garden, plantation) that were all
  saved as plain "Agricultural"; they now keep their class, shown on web
  and mobile. And the per-square-metre header is printed once near the
  front of a notification, so later pages were often saved per square
  foot, making values about 10.8× too high (Ramanagara Taluk: 911 of
  1,000 site rates). When a notification prints only one of sq m / sq ft,
  every rate is now stored in that unit. **Migration required:**
  `20260925180000_guidance_rate_land_class.sql` and
  `20260925180100_guidance_search_land_class.sql`.

- **Guidance value reading skips the pages that hold no rates.** Every
  notification opens with a gazette header, instructions, an amenities list
  and an apartment ready reckoner, and Gemini was paid to read them and
  return nothing (or, worse, construction-cost rows saved as rates). The
  reader now reads each page's text locally first and skips pages it can
  positively identify as non-rate content, about 2% of pages across ten
  sampled notifications with no real rate page lost; anything blank,
  garbled or carrying rate words is still read.

- **Guidance value reads stop paying for runaway output.** Twelve batch
  requests today ran to Gemini's 65,000-token ceiling on two pages each,
  produced nothing readable, and were resubmitted every 15 minutes. Output
  is now capped at 8,192 tokens; a range that hits the cap is read one page
  at a time, and a page that still overflows is marked instead of retried.
  Thinking tokens are now logged per call. **Migration required:**
  `20260925143000_guidance_output_cap.sql`.

- **Guidance value reading no longer stalls on one range.** The Mangaluru
  Taluk notification stopped at page 66: every request for pages 67–68 ran
  for five minutes and failed, while each page alone read in three seconds.
  A range read now has an 80-second deadline across all fallback models, and
  a two-page range that misses it is read one page at a time.

- **Listing access approvals get their own WhatsApp template.** An approved
  listing-access request went out on `location_reveal`, which told the
  requester their "exact location" request was approved and the link lasts
  48 hours. A listing approval actually opens the full listing, photos,
  address and map pin for 7 days. The new `listing_access_approved` Utility
  template (all seven languages, submitted from Settings → Templates) says
  that, and is used as soon as Meta approves it. Until then listing
  approvals keep going out on `location_reveal`, so nothing stops sending.

- **Internal notes no longer look sent on mobile.** Inbox notes the Engine
  writes for the team, such as "Listing Access Request", are never sent to
  WhatsApp, but the mobile app drew them as outgoing green bubbles with
  delivery ticks. They now show as a dashed "Internal note · not sent" chip,
  as they already did on web.

- **One district name per guidance value rate.** Rates had been saved under
  Bellary and Ballari, Bagalkot and Bagalkote, taluk names such as Anekal
  and Devanahalli, and placeholders such as "Not specified". A rate now
  keeps its printed district only when it is a real district (old spellings
  included) and otherwise takes the notification's district, and uploaded
  notifications are filed under their district too. Existing rows were
  rewritten the same way.

- **A failed guidance value batch is no longer resubmitted every 15
  minutes.** When Gemini reports a batch failed, cancelled or expired, its
  notifications drop their background queue request, so they wait for an
  admin to queue them again. The cron now gives its queue step only the
  time polling left over, and skips queuing when too little is left.

- **Guidance value from an RTC.** Upload a Karnataka RTC (Pahani) on web or
  mobile and its taluk, hobli, village, survey/hissa and extent are read; the
  Kannada village and the extent are shown as printed, and village names match
  the notification's spelling (Adduru finds Addur, never Adyar).

- **Address fragments are no longer saved as a buyer's area.** Contacts
  were filed under "#365", "#650", "Block", "Sector", "24th Main" and
  survey numbers, and the bot read them back ("listings near #365"). A
  portal lead email took the first comma segment of the listing address
  — the door number — as the area; it now takes the first segment that
  is a locality. Areas from AI requirement extraction, the contacts API,
  the public requirements form and the buyer portal pass the same check:
  door, survey and plot numbers, bare numbers and a lone block, sector,
  phase or numbered main/cross road are dropped, a list pasted as one
  entry is split, and repeats are kept once.

- **Guidance batch queuing continues in the background.** Clicking Queue now
  marks every waiting notification, and the 15-minute cron keeps queuing any
  that one request could not reach, so leaving the page no longer stops the
  import. **Migration required:**
  `20260925100121_guidance_value_batch_requested.sql`.
- **A map link that names a place now pins the listing there.** Links
  such as `maps.app.goo.gl/…` that open a named place, or
  `google.com/maps?q=<address>`, carry no coordinates, so the listing fell
  back to a guess from its address text. The place the link names is now
  geocoded when the listing is saved (and by the pin-repair script), so it
  gets a pin from the place the lister chose. Links that open
  nothing stay unpinned.

- **Showcase "Search near" now looks 5 km around the place, down from
  10 km.** In central Bengaluru 10 km covered most of a brokerage's
  catalog, so "near Basavanagudi" listed around a hundred homes. The
  dashboard's own locality search keeps its 10 km radius.

- **A buyer's locality is saved as they spelt it, not as a listing
  misspells it.** A lead who typed "Vijaya Bank Layout" was told the
  engine was matching "near Vijayanbank layout" and had "4 listings in
  Vijayanbank layout", because the reply was mapped to the first listing
  whose sublocality fuzzily matched — and three listings carry the typo.
  The resolver now keeps an inventory spelling identical to what the buyer
  typed, then prefers the curated locality, and only then falls back to
  the nearest variant.

- **Showcase "Search near" sends the typed text as the visitor wrote it.**
  With the area-only filter on, "basavan, Bengaluru" matched no area at
  all, so "basavan" found nothing. The lookup now tries the bare text
  first, which is what the dashboard sends, and adds the city only if
  that finds no area. A failed lookup is logged and no longer cached,
  so one bad call can't keep a place unsearchable.

- **Showcase "Search near" now asks Google for areas only, near the
  brokerage's own listings.** With autocomplete open to every kind of
  place, "basavan" matched a temple in central Bengaluru before the
  Basavanagudi neighbourhood, so the search was centred on the temple.
  The lookup is now limited to localities and neighbourhoods and
  weighted toward the middle of the showcase's inventory, so a partly
  typed area lands on the area. The dashboard's own place search is
  unchanged.

- **Showcase "Search near" now understands a partly typed area.** The
  first version sent the text to Google's address geocoder, which could
  not place a fragment like "basavan" and fell back to the middle of
  Bengaluru, so the "nearby" list was centred on the wrong spot. The
  lookup now uses the same Places autocomplete the dashboard uses, which
  resolves "basavan" to Basavanagudi, then reads that place's position.
  It is still one billed lookup per new search, cached, and capped as
  before.

- **The showcase location box now finds listings near a place none of
  them name.** Typing an area the catalog has no listing in (say
  "basavan") used to empty the suggestions and leave every listing on
  screen. The box now offers _Search near "basavan"_, and Enter runs
  it. The place is geocoded in the city most of the inventory is in,
  and the result lists the listings that name it first, then the other
  published, available listings within 10 km, closest first, each
  marked "X km away". That matches the 10 km locality radius the
  dashboard uses. Distances are rounded to half a kilometre and no
  coordinates reach the page. Google is only called when the visitor
  asks, results are cached, and the lookups are capped per visitor and
  per showcase per day. Enter on a typed area that the catalog does
  name now applies the first suggestion, and a short entry with no
  match says so instead of showing nothing. The suggestion list also
  no longer slides under the listing cards.

- **The mobile typecheck no longer compiles the server-only web code.**
  One type-only import, from the requirement-profile helper to the AI
  preference extractor, pulled Gemini, the notification dispatcher and
  every WhatsApp template module into the Expo app's type program — for
  a type that names none of them. The shape now lives in a leaf module
  the extractor re-exports, so no caller changed, and the web files
  mobile compiles drop from 81 to 22 with the WhatsApp and notification
  subtrees gone entirely. A test walks the import graph and fails if any
  of it comes back. Nothing changes for anyone using the app.

- **Cheaper guidance value imports.** Gemini now writes each notification's
  district, taluk, hobli and village once per table instead of on every
  rate, and one line carries all of its rate columns, so a page costs a
  fraction of the output tokens it did. Admin → Guidance values and the
  import extension can also queue every unfinished notification as a
  Gemini batch at half price; results are saved in the background by a
  new 15-minute cron, usually within a few hours. **Migration required:**
  `20260925024645_guidance_value_batches.sql`.
- **Batch import fixes.** A notification is claimed before its batch is sent,
  so two queue runs at once never pay for it twice; a page range that opens a
  new district no longer inherits the previous area's hobli or village; and
  the import extension re-uploads a notification whose earlier upload was
  interrupted instead of skipping it forever.
  It only does so when the PDF is really missing and nothing was read yet: a
  storage hiccup leaves the notification and its rates alone for the next run.
- **Guidance value accuracy.** Gemini no longer guesses a hobli or taluk from a
  place name it recognises; a heading printed earlier in the notification is
  carried forward instead. Construction-cost, floor-rise, parking and
  ready-reckoner tables are no longer stored as rates, and queuing loads each
  PDF once, so a single run queues far more notifications.

#### 24 September 2026

- **Forwarded e-Khata fixes.** An owner the listing read picked up from an
  e-Khata no longer lands on the draft or becomes a contact; an apartment
  no longer takes the plot's site area and dimensions (nor a plot the
  building's built-up area); and the ePID, khata form and year built are
  no longer lost when another message updates the draft at the same moment.
  An e-Khata that opens a draft also clears what the listing read took
  from it that doesn't fit the property type, and a plot never keeps a
  construction year from a concurrent merge.
- **Forward an e-Khata on WhatsApp.** Send the e-Khata PDF to the
  ConvoReal number (with "e-Khata" or "Khata" in the file name or caption)
  and the listing draft is filled from it: address, city, map pin, site
  area and dimensions, built-up area, year built, ePID and khata form.
  Sent while a draft is already open, it only fills what the draft is
  missing. The draft preview shows the khata and year built, and the
  confirmed listing keeps them. No photo is taken from an e-Khata, since it
  carries the owner's photograph.
- **Fill a listing from its e-Khata.** On the web property form (Property
  Documents → Read e-Khata) and in the mobile property editor, upload a
  Karnataka e-Khata PDF or photo and ConvoReal proposes the address, city,
  map pin, site area and dimensions, built-up area, year built, ePID and
  khata form (A or B). Tick what to copy — values that would overwrite
  something already entered start unticked — and the owner, property tax,
  liabilities and boundaries are shown for reference. The e-Khata is kept
  with the listing's documents. It costs the same credits as reading a
  listing and is refunded when the file cannot be read. Listings gain
  ePID, Khata and Year built fields on both surfaces. **Migration
  required:** `20260924142702_property_khata_fields.sql`.
- **Expected close on the Records index.** Each record shows its
  expected close date, marked when it is within a week or has passed,
  and Closed with the actual date once the deal is done, on web and
  mobile. A Recent / Close date switch orders the list by soonest
  expected close, undated after dated, closed deals last. **Migration
  required:** `20260924150000_transaction_index_expected_close.sql`
  (recreates `transaction_workspace_index`).
- **Payment schedule per tranche.** The Overview tab of a transaction now
  carries a payment schedule under the financials, on web and mobile: one
  row per tranche with a label, amount and due date, a receipt recorded
  as a date with an optional part amount and instrument reference, and
  scheduled, received and outstanding totals summed on the server. A
  tranche with money against it is corrected rather than removed. An
  unpaid tranche's due date joins the deal deadline watch on Focus, Today
  and the agent digest. **Migration required:**
  `20260924140000_deal_payment_tranches.sql` (new table, additive) and
  `20260924140100_deal_deadlines_payment_tranches.sql` (replaces
  `deal_deadlines_for_account`).
- **More Gemini fallbacks, and no browser autofill on the key form.** Google
  sets a separate quota per model, so a key over quota on
  `gemini-3.5-flash` or `gemini-3.1-flash-lite` now carries on with
  `gemini-3.6-flash` or `gemini-3.5-flash-lite` instead of failing. In
  Admin → AI keys the add-key form asks for a new secret rather than a
  sign-in, so the browser stops filling it with a saved email and password.
- **Bundle linked deals from the record.** A transaction with no bundle
  shows a Bundle chip in its header, on web and mobile; it opens a picker
  that lists the same buyer's other open deals first and pre-ticked,
  proposes a name after the buyer, and creates the bundle through the
  existing route. A bundled deal shows its bundle's name instead, which
  opens the members with their combined milestone progress and a link to
  each. Each deal keeps its own seller, milestones, papers and terms.
- **Deal deadlines are watched.** A milestone's target date and a deal's
  expected close date now surface as a Deal deadlines card on Focus (web
  and mobile) and a section on the Today page, two weeks ahead, with
  overdue and due-today marked, and the agent task digest carries a Deal
  deadlines block for the agent's own deals due within three days or
  already past. Completed or skipped milestones, closed deals and won or
  lost deals never appear. **Migration required:**
  `20260924103000_deal_deadlines.sql` (two SQL functions and two partial
  indexes, additive).
- **New Gemini keys no longer fail on a retired model.** Google no longer
  offers `gemini-2.5-flash` to new accounts, so a newly added key failed
  every call that reached it — every full-Flash call, and every lite call
  once lite was busy or over quota. A model Google reports as retired for a
  key is now skipped for that key and the call moves on to the next model;
  the lite tier now ends on `gemini-3.5-flash`.
- **Buy Gemini credits from the AI keys panel.** Each key card in Admin →
  AI keys has a Buy credits button that opens Google Cloud billing in a new
  tab, signed in as the key's Google account when its label is an email.
  Google offers no way to pay for credits from another app, so payment
  stays on Google's page; record the top-up on the card afterwards to keep
  the estimated balance.
- **Rental yield calculator.** `/tools/rental-yield` gives the gross
  and net rental yield of a property from its price and monthly rent,
  after vacancy, yearly costs and one-time purchase costs, with the net
  income, the payback period on rent alone and a table of the rent a
  target yield needs. It takes amounts as lakh or crore, offers a
  WhatsApp-ready summary, links to the stamp duty and EMI calculators,
  carries FAQ and WebApplication structured data, and sits in the sitemap
  and the landing page's Free Tools section.
- **A journey shows under Lost and under its live stage at once.** A buyer
  with one property dropped and another at Legal now appears under both
  groups: expanded under Legal it leads with the live property, and under
  Closed Lost with the dropped one, the rest folded behind a count. The
  live group is now the furthest stage a _live_ property has reached, so a
  dropped property no longer holds the journey at a later stage than
  anything still in play. A journey with nothing live sits under Lost
  alone, as before. Web and mobile both. **Migration required:**
  `20260924071006_journey_overview_live_and_lost.sql`.
- **The mobile `@/` alias can no longer shadow a web module.** `@/*`
  resolves against the mobile root before `../src`, and that applies to
  the web modules the app pulls in for their types too — so a mobile
  file sitting at a path a web module imports as `@/<path>` silently
  stood in for it. `mobile/lib/languages.ts` did that to
  `src/lib/languages.ts`, and the WhatsApp template modules failed on
  exports the trimmed mobile mirror does not carry. It was the only such
  collision in the repository; the mirror is now `contact-languages.ts`,
  the two roots no longer overlap, and a test on each side fails if they
  ever do again. Nothing changes for anyone using the app.

- **Two more free tools: stamp duty and EMI.** `/tools/stamp-duty`
  works out Karnataka stamp duty, surcharge, cess and the registration
  fee on the higher of the sale price and the guidance value, with the
  area picked for the surcharge and every rate printed on the page;
  `/tools/emi-calculator` gives the monthly EMI, total interest and a
  year-by-year balance from the property price, down payment, rate and
  tenure. Both take amounts as lakh or crore, produce a WhatsApp-ready
  summary, link to each other and to the guidance value finder, carry
  FAQ and WebApplication structured data, and sit in the sitemap and the
  landing page's Free Tools section.
- **Cheaper AI for low-risk jobs.** The daily conversation sweep, Copilot
  answers, occasion greetings and listing and contact corrections now run on Gemini's
  lite model, which costs a fraction of full Flash and falls back to it when
  lite is unavailable. Reading listings and business cards from photos, voice
  notes and answers to buyers stay on full Flash. A listing correction is
  still normalised and re-derived as before, keeps any plot size or rate it
  does not mention, and stays a draft until the agent confirms it.
- **Automations no longer send a burst of stale follow-ups.** When the job
  that resumes waiting automations had been down, it caught up by sending
  every overdue step at once — one contact received the same "circling
  back" message many times in a minute. A step resumed more than six hours
  after it was due is now skipped and logged instead of sent, and a contact
  who reaches the same wait again (for example by sending another message)
  replaces the follow-up already queued, so it is sent once, timed from the
  latest message — even when two messages arrive at the same moment.
  **Migration required:** `20260924071500_park_automation_wait.sql`.
- **A journey with every property dropped moves to Lost.** The Journey
  view grouped a buyer (or property) at the furthest stage any item had
  reached, so a buyer whose three shortlisted properties were all dropped
  at Negotiation/Token still sat under Negotiation/Token with "Nothing in
  the race". Once no live item is left, the journey now sits under the
  account's lost stage (Closed Lost) on web and mobile; the items and
  their history are untouched. Accounts without a lost stage keep the old
  grouping. **Migration required:**
  `20260924063001_journey_overview_all_dropped_lost.sql`.
- **Free tools on the marketing site.** convoreal.com now carries two
  public, indexable tools that bring in traffic and hand it to sign-up:
  a Karnataka guidance value finder at `/tools/guidance-value`, which
  searches the imported notifications by area, road, village and survey
  number with no sign-in, and stage-by-stage property process guides at
  `/tools/property-process` built from the liaison workflow templates
  (khata transfer and name change, sale deed registration, EC, TDS,
  builder re-assignment, home loan). Both carry FAQ, breadcrumb and
  HowTo / WebApplication structured data for search and answer engines,
  sit in the sitemap, and are linked from the landing page's new Free
  Tools section, nav and footer. The public lookup never reads a deed or
  calls Gemini: uploading the schedule stays the in-app feature the pages
  sell. The lead bot answers guidance value and liaison questions from
  the same config.
- **Gemini keys are managed from Admin → AI keys.** Platform admins add,
  label, test, disable and remove Gemini keys in the app; they are stored
  encrypted and both the web app and the WhatsApp worker pick them up
  within a minute, with `GEMINI_API_KEY` kept as the fallback. A key that
  runs out of credits rests for ten minutes while the next takes over, and
  its state is shared across instances. The panel shows each key's calls,
  tokens and estimated spend for today, this month and since its last
  recorded top-up, an estimated remaining balance, and daily spend charts by
  key and by feature. **Migration required:** `20260924060500_ai_provider_keys.sql`.
- **You are told when a Gemini key runs out.** Platform admins get an
  in-app, push and WhatsApp alert the moment a key is refused for credits or
  billing, and another if every key ends up resting, at most once per key
  every six hours. The migration also switches AI call logging on, which
  the usage panel reads. **Migration required:**
  `20260924063000_ai_provider_keys_alerts.sql`.
- **Existing contacts stay out of Needs Review.** A WhatsApp message
  naming a listing — a showcase "I'm interested" tap, a property code or
  one of our Click-to-WhatsApp ads — used to move any contact to Needs
  Review, including buyers the agent had worked with for weeks. Only a
  contact that message created goes there now; an existing contact keeps
  their status, and the listing is still linked and the enquiry recorded.
- **A logged personal share no longer rewrites "Contacted about".**
  Logging a personal-WhatsApp share on web or mobile set the contact's
  enquired listing to whatever was sent, so the Contacts list showed a
  buyer as asking about a listing they never asked about, and Approve
  would have re-sent it. The share is still noted on the timeline and
  now reaches the property share ledger from web too, as it already did
  from mobile.

#### 23 September 2026

- **Guidance value import Chrome extension.** One click on the new
  `extension/guidance-value-import` extension imports every Karnataka
  guidance value notification: it reads the IGR revised guidelines value
  table in your browser, downloads each PDF, uploads it to ConvoReal and
  waits while its rates are read. Already imported notifications are
  skipped and unfinished ones resume, so re-running it is safe. Needs a
  platform admin signed in to ConvoReal in the same Chrome profile.

- **Upload many guidance value PDFs at once.** The IGR website appears
  to refuse connections from cloud servers, so Import from the IGR
  website could not reach it from production. Admin → Guidance values now takes a whole folder of PDFs
  downloaded in the browser: the SRO and district are guessed from each
  file name, can be corrected per file, and the files are read one after
  another. A failed IGR import now names the network error and points to
  this instead.

- **Guidance value from a sale deed schedule.** Upload the schedule of a
  Karnataka sale deed (PDF or photo) and ConvoReal reads its location,
  type and extent, matches it against the government guidance value
  notification, and shows the rate and the value. The schedule is
  editable, so a missing site area or a misread road is one field away,
  and a value can be saved against a property or a transaction. It is on
  the dashboard (`/guidance-value`, the property menu and each
  transaction), in the mobile app, and in the Portfolio portals for
  buyers and owners, who use it free under a daily limit. Staff reads
  cost 5 credits, refunded when the read fails. Rates come from the IGR
  PDFs a platform admin imports under Admin → Guidance values —
  uploaded by hand, or listed and downloaded straight from the IGR
  website with Import from the IGR website. **Migrations
  required:** `20260923051521_guidance_values.sql`,
  `20260923055423_guidance_values_server_writes.sql`,
  `20260923060239_guidance_value_source_url.sql`.

#### 24 September 2026

- **Start a requirement from the Requirements screen on mobile.** The
  screen now has an "Add a requirement" button: pick the buyer or agent,
  then write the brief, without hunting for the contact first. The
  client arrives carrying whatever brief is already on record, so an
  existing requirement is shown for editing instead of being replaced by
  what you type. Read-only members do not see the button. The picker
  lists the buyers whose briefs the app can write; an agent's
  requirement stays visible, shareable and parkable on the screen but no
  longer offers an Edit button the server would refuse.

#### 22 September 2026

- **An attachment the agent sent now shows in the thread.** Sending
  worked, but the mobile inbox drew every agent-sent photo as "media no
  longer available". A message's `media_url` holds one of two things —
  the auth-gated proxy path for a photo the contact sent, or a public
  storage URL for one the agent sent — and the image bubble prefixed
  both with the app's own address, which turns the second into a URL
  that cannot load. It now asks the same resolver the video, audio and
  document bubbles already used, so each is fetched from where it
  actually lives and no bearer token is sent to another host. Property
  photos shared into a thread were affected the same way and are fixed
  with it.

- **Attachments really send now, and deal documents with them.** The
  previous change moved inbox attachments off the API route and straight
  to storage, but the app still handed React Native a Blob to PUT and
  the platform did not carry the file's content type with it. Supabase
  answers a typeless upload with "mime type application/octet-stream is
  not supported", which the app reported as "could not upload — try
  again": a refusal no retry could ever fix. The file is now streamed
  from disk by the native uploader, which sends the type it is given, and
  a storage refusal is shown with its actual reason instead of a retry
  prompt. Deal documents took the same route as the inbox attachments
  did — through a serverless function that rejects anything over 4.5 MB,
  an eleventh of the 50 MB the folder offers — so a scanned deed failed
  the same way; they now stage the same way, on web and mobile. Filing
  the row reads the stored file back, so its size and type on the record
  are what storage actually holds.

- **Attachments send.** Picking a photo, video or document in a thread
  failed on every attempt, on web and on mobile alike, with "Could not
  send that attachment — try again"; no attachment had ever reached a
  contact. The app posted the file to its own API route first, and a
  serverless function rejects a request body over 4.5 MB before any code
  runs — below the 5 MB photo, 16 MB video and 100 MB document limits the
  attach sheet offers — so larger files died at the edge as a dropped
  connection rather than a refusal that could be explained, and on
  Android the multipart body the picker produced did not survive the
  bridge at any size. The file now goes straight to storage under a
  one-shot URL the server signs for a single path inside the account's
  own folder, so the advertised limits are the real ones. An unsupported
  type or an oversized file is refused before anything uploads, in the
  same words on both surfaces, and a send reads the stored file back
  before handing WhatsApp a link to it.

- **A number WhatsApp is experimenting on no longer looks like a broken
  send, and a blocked contact still gets reached.** Meta drops marketing
  templates to numbers it holds in an experiment group and answers with
  error 130472, which the inbox showed as a bare "Delivery failed" with
  Meta's own wording while the dispatcher kept trying the same contact.
  That error is now handled exactly like the marketing frequency cap: the
  thread says WhatsApp is running an experiment on the number, explains
  that the contact's reply clears it and that a Utility template still
  reaches them, offers no pointless resend, and pauses marketing
  templates to that contact until they write in. Alongside it, a send to
  a contact whose marketing is paused now prefers an approved Utility
  variant of the same template over a Marketing one in their language —
  which matters because Meta downgrades some translations to Marketing
  while the English original stays Utility, so a Kannada buyer under a
  block was getting nothing where English would have arrived. Every send
  path gets that fallback, because the swap happens where they all meet:
  a paused marketing send is moved onto an approved Utility variant of
  the same template when it fits the parameters already built, and is
  refused only when none does. Nothing changes for a contact who is not
  blocked: they still get their own language.

- **Buyer requirements on the phone.** The Requirements screen is now on
  mobile, under More → Buyer requirements: every buyer and agent brief
  the account holds, the same four counters that double as filters, the
  same type and priority filters, and one search over client, phone,
  brief, notes and areas with the spelling merge. A card shows the brief
  the contact is actively asking about, with AI-extracted values marked,
  and lets you open the chat, edit the brief, park or unpark it, tap a
  suggested project or tag to attach it, and share the brief masked or
  in full — including straight to an agent's own ConvoReal account. The
  masking rules come from a port of the web digest module that a parity
  test holds to identical output.
- **Shared requirements search merges spellings.** Searching the
  received or sent shares for "Brookfield", or "in Brookfield", now
  finds a brief whose areas say "Brookefield", on web and on the phone,
  using the same spelling groups as the Contacts and Requirements
  searches.
- **A translation Meta already holds is adopted, not refused.** Submitting
  the Kannada `post_call_options` failed with "There is already Kannada
  content for this template" while the row still read Draft: an earlier
  click had got through to Meta (and been approved) and a failed retry
  then overwrote the local row back to an unsubmitted draft. When Meta
  refuses a create because the language exists, the submit route now
  looks up the variant Meta holds and adopts its id, status, category
  and wording, exactly as Sync from Meta would. A refused submit no
  longer rewrites a row Meta already holds; it only records the error.
  And every submit button ignores a second click while the first is in
  flight.

- **The Requirements page search matches areas, spellings merged.** The
  search box on Requirements now looks at each brief's areas as well as
  the client, phone, requirement text and notes, and a typed locality
  finds every spelling of it, exactly as the Contacts search does.
- **One submit button per translation, and none once it is at Meta.** A
  reviewed Kannada draft showed two ways to submit: the review strip's
  "Submit to Meta" and the generic per-row "Submit" that opens the edit
  dialog, and on an unreviewed draft the generic one led to a dialog the
  server then refused. The review strip is now the only door for a
  translation behind the gate. The strip also stayed on rows already
  pending at Meta, offering a resubmit that Meta would reject as a
  duplicate name; it now disappears while Meta holds the row. A
  translation Meta rejects goes back behind the gate instead of
  straight into the edit dialog: reword it on the card, mark it
  reviewed, and "Submit to Meta" re-submits through the Meta edit, which
  now refuses unreviewed or altered translated wording.

- **The Contacts search box merges spellings too.** Typing "Brookfield",
  or "buyers in Brookfield", now finds contacts saved with "Brookefield"
  or "brookefield, Bengaluru" as well, on web and on the phone. The
  search uses the same spelling groups as the area filter; a word that
  is not a stored locality searches exactly as before.
- **Translations submit under the category Meta already holds for the
  template.** Marking a Kannada, Hindi, Tamil or Telugu engine template
  reviewed and submitting it failed with Meta's "The category UTILITY
  doesn't match the one that's already associated with this template,
  MARKETING" whenever Meta had approved the English version as Marketing
  rather than the Utility the builder asked for. Meta fixes a name's
  category at its first review and every language of that name shares
  it, so the submit route now looks up the category Meta holds for the
  name and sends the translation under it, the draft is created wearing
  that category so the badge matches what will be sent, and the toast
  says when the category differs from the one requested. **Migration
  required**: `20260922040000_align_translation_draft_categories.sql`
  re-labels existing unsubmitted drafts to match their Meta-held
  sibling; reviewer sign-offs are kept.
- **Filter contacts by several areas at once, whatever the spelling.**
  The Contacts area filter on web and mobile now offers each locality
  once — "Brookefield", "Brookfield" and "brookefield, Bengaluru" are one
  chip that matches all three — and any number of chips can be on at the
  same time, so "everyone looking in AECS Layout or Brookefield" is one
  filter, up to twelve areas at once. Every chip shows how many contacts
  carry it, and the mobile
  filter now reads the AI-extracted preference areas as well as the
  agent-entered ones, as web always did. The list of localities comes
  from a new account-scoped SQL function instead of scanning every
  contact row in the browser, which also lifts the 500-contact cap the
  phone had. **Migrations required**:
  `supabase/migrations/20260922024134_contact_area_options.sql` and
  `supabase/migrations/20260922031500_contact_area_group_counts.sql`.

#### 21 September 2026

- **The mobile share sheet shows the listing template too.** Sending a
  property to its matching contacts from the phone already picked the
  approved listing template on the server, but the sheet only showed the
  editable draft, which is what a contact inside the 24-hour window
  receives; everyone else got a template the agent never saw. The "Send
  from ConvoReal" section now shows the template as the first recipient
  will receive it, rendered by the server with the same pick and the same
  parameters as the send, lets you choose which of the listing's photos
  leads the message, and, when the template is missing or still under
  review, says so before anything is sent. The chosen photo travels with
  each send, on web and mobile, and the server only accepts one of the
  saved listing's own images.

- **Sharing a listing with its matching contacts no longer asks which
  WhatsApp template to use.** The Matching Contacts step listed every
  approved template in the account by its raw Meta name, with nothing
  selected, and then asked for each placeholder to be mapped by hand. It
  now picks the listing template itself, photo-first when the property has
  photos, shows the message as the first recipient will receive it, lets
  you choose the header photo, and sends each contact through the same
  path the Share dialog, Match Radar and the mobile app use: the full
  message with photo inside the 24-hour window, the approved template
  outside it, the share ledgered either way. A contact the template cannot
  reach is reported with the reason (no listing template submitted, or
  still awaiting Meta approval). "Use a different template" keeps the old
  picker and placeholder mapping for custom templates. On the inventory
  card, the Details button is gone: the whole card opens the listing, and
  Share, Matches and the overflow menu sit on one line.

- **Contacts page and the mobile property screens get the inventory
  treatment.** The web Contacts list had two stacked page headers and two
  stacked tab rows; the segment pills, the action buttons, search, filters
  and sort now share one control block under the single page header, with
  a results line ("N contacts match the current search and filters") that
  explains why the segment counts and the list size differ. Every dropdown
  on the page (sort, project, classification, tag, budget, area) showed its
  raw value — a tag id, a rupee number, `created_desc` — and now shows its
  label; the sort orders and their names match the mobile filter sheet, and
  a column sort the menu does not list is still named in the trigger. The
  "Added / Modified" pair leaves every row for the name's tooltip, the
  redundant per-row Eye button and the second Edit entry in the overflow
  menu are gone, the Filters badge now counts the starred-property and
  project filters, Clear All no longer resets the sort, the smallest text
  is 11px, and the "All Contacts" segment is called "Active" on web and
  mobile because it never included contacts awaiting review. A project
  filter change also no longer reads the previous project's cached rows.
  On mobile, the property detail no longer repeats the locality in its
  address line ("Kormangala East, Bengaluru, Kormangala East, Bengaluru"),
  drops the green "Equivalent to" line that restated the price, keeps
  Edit, Share and Flyer inline with Duplicate, Portal dates, Archive and
  Delete behind a More menu, and its Enquired and Matching sections no
  longer say "No enquiries recorded" or "0 already shared" while still
  loading. The mobile portal-drift alert collapses to one line like the
  web's, the property and contact cards lose their audit-date line, and the
  properties list clears the Copilot button at the end of the list.

- **Inventory page reworked around the listing, not the buttons.** Every
  property card showed thirteen actions across three rows, with delete and
  archive as icon-only buttons at the same weight as everything else, so six
  listings needed two screens. The card now keeps Details, Share and Matches
  inline and moves the rest behind one overflow menu with Archive and Delete
  set apart at the bottom; the price sits on the title row, the audit dates
  live in the title's tooltip, the photo and title open the listing, and the
  always-on "Added to inventories" link is replaced by a "Shared by N agents"
  chip that appears only where another agency holds a copy (web and mobile).
  The status badges no longer sit under the selection checkbox, the sort
  dropdown names its order instead of showing `created_at`, the floating
  helper buttons no longer cover the last column, and the first summary tile
  counts active listings so it agrees with the All pill. The four summary
  tiles now filter the list, the status tabs and search share one control
  block, the portal-drift alert collapses to one line until opened, the grid
  gains a fourth column on wide screens, and the smallest text is 11px. A new
  **table view** sits beside the grid and map with sortable Listing, Locality,
  Price, Status and Added columns; the sort menu gains price and title orders
  matching the mobile filter sheet. Uploads that look like scanned paperwork
  are placed after the photos so a bank letter does not become the cover.
  Sorting locks to "Nearest first" while a locality or Near me filter is
  on, as the mobile sheet already did, and the table keeps Approve / Reject
  on pending-review rows. **Migration required:**
  `20260921180000_inventory_import_counts.sql` adds the membership-guarded
  `inventory_import_counts` function, and
  `20260921183000_inventory_stats_published_active.sql` makes the Showcased
  tile count active published listings only, so it matches the rows the
  tile filters to.

- **The closed-window announcement template is now `announcement_video_notice`.**
  It was called `audio_announcement_notice`, but what it sends is a video
  (a branded still card over the narration), because Meta has no audio
  header format — so the old name misdescribed the message. Meta cannot
  rename a template, so the new name is a fresh submission from the
  Templates screen. The old name stays a send candidate: an account whose
  `audio_announcement_notice` is approved keeps sending on it until the
  renamed one is approved, at which point the new name is preferred.
- **Change a contact's language from the record, on web and mobile.** The
  language every WhatsApp template to a contact goes out in was set only
  deep in the web edit form and not at all on mobile. A language chip now
  sits under the contact's name on both surfaces: one tap picks any of the
  seven product languages or hands the contact back to the account default,
  through a new single-column `PATCH /api/contacts/[id]/language` route. The
  send path is unchanged — contact language wins over the account default on
  every template, as before — the choice is just reachable where the agent
  reaches for WhatsApp.
- **WhatsApp a contact on the number they actually use.** A contact whose
  primary number is not on WhatsApp, with the WhatsApp number added later
  under "Other phones", kept being messaged on the primary: the WhatsApp
  action, the Engine inbox thread and every template all address the primary
  number. On web and mobile the WhatsApp action now offers a choice of
  numbers when a contact has more than one, each other number on the mobile
  record opens WhatsApp, Call or Make primary, and the mobile editor gains
  the web's swap-to-primary arrow, so the Engine thread follows the right
  number too. A Meta "message undeliverable" error now says to make another
  of the contact's numbers the primary. The question is asked once: the
  number picked becomes the primary and the choice is recorded on the
  contact, so the next tap goes straight to WhatsApp. **Migration
  required:** `20260921103000_contact_whatsapp_phone_confirmed.sql` adds the
  nullable `contacts.whatsapp_phone_confirmed_at` column.

- **Importing a phone contact fills first name, second name and Name Tag.**
  A phonebook entry such as "Dr Murali Makam Owner Hsr Has Building On 27th
  Main" used to land in the contact's Name field whole. Import from phone on
  mobile and the phonebook picker on web now split it the same way: the
  trailing qualifier becomes the Name Tag ("Owner Hsr Has Building On 27th
  Main"), the first given name with any title or initial in front of it
  becomes the Name ("Dr Murali"), and the rest becomes the Second Name
  ("Makam"). The web bulk-import review gains a Second Name column, and the
  mobile editor now loads the second name it edits, so saving a contact there
  no longer clears it.

- **"Close my enquiry" closes one listing, not the lead.** The quick reply on
  the check-in and enquiry templates used to mark the whole contact dead:
  their requirement stopped matching, every automated send was refused, and
  the goodbye's "just reply START ALERTS" led nowhere — the reply flipped
  consent but the contact stayed dead, so the confirmation was blocked and
  no alert could follow. The close is now scoped to the listing the template
  named: it is rejected for that contact and its journey branch dropped, the
  contact stays live and matching, and the acknowledgement says their other
  enquiries stay open. After the drop-off reason the lead sees their open
  enquiries as a one-tap list — close any of them or keep them all, each
  answer logged on the journey and the agent notified — and then the
  requirement ladder or their current matches, so the moment ends with both
  their enquiries and their brief sorted. Deals already at token, legal,
  registration or won never appear on that list. "Bought elsewhere" and
  "not buying right now" park the search instead (the lead is marked dead
  until they reply START ALERTS); a close that names no listing on a journey
  with nothing open does the same. START ALERTS in the
  lead's own words now revives a dead contact, un-parks the requirement and
  grants consent before the confirmation and ladder go out.

- **Share Listings for buyer contacts, saved to their Portfolio.** A buyer's
  contact record on web and mobile gains "Share Listings": hand-pick up to 25
  listings and send them through the existing showcase share flow with that
  contact already chosen, from the business number or personal WhatsApp. Every
  send is recorded on the property share ledger and mirrored into the buyer's
  Portfolio shortlist as "shared by <agency>", so they can compare, keep or
  drop the listings from their own account; a buyer who has not signed in yet
  gets the same rows on first login. The message ends with a Portfolio nudge
  that says whether they already have an account or should sign in with this
  WhatsApp number. **Migration required:**
  `20260921120000_buyer_shortlist_shared_source.sql` widens the shortlist
  source check to accept `shared`.

- **Share Portal now works for agent contacts.** The contact record's "Share
  Portal" action was hidden for anyone classified as an Agent because the
  invite was written for a buyer. It now appears for agents on web and mobile
  and sends the same portal link in agent view (`mode=view`), with co-broker
  copy: browse the full inventory for your clients, forward any listing with
  your own share link so location requests come to you first, and send back
  the ones your clients want to see. Buyers get the unchanged invite; the
  24-hour-window template fallback and the personal-WhatsApp timeline note
  behave as before, and the template's portal button carries the agent view.

- **A lead who closes their enquiry is asked why the shared property did not
  fit.** "Close my enquiry" on the check-in and enquiry templates still marks
  the lead dead and sends the goodbye; the goodbye is now followed by one
  tap-to-answer list naming the property the check-in was about — budget,
  location, property type, size, bought elsewhere, not buying right now, or
  something else. The property is read from the quoted template, then the
  last week of outbound messages, then the recorded enquiry; a close with no
  listing behind it asks nothing. The answer is filed on the listing's
  feedback (so matching never re-offers it), on the contact's timeline and on
  the active journey item for that pair, the assigned agent is notified, and
  a short thank-you closes the thread — nothing further is sent. Web and
  mobile both read the same note, journey event and notification.
  **Migration required:**
  `supabase/migrations/20260921100000_listing_feedback_dropoff_reasons.sql`
  widens the listing-feedback reason set.

#### 20 September 2026

- **An expanded journey leads with the stage it is filed under.** Inside a
  stage group, opening a journey now shows the items resting on that stage
  first, ringed in the stage colour, and folds the items at other stages
  behind an "N more at other stages" control, on web and mobile. A buyer
  filed under Negotiation/Token because of one property no longer opens to
  five New Inquiry rows above it.
- **Journey list is readable again.** A stage header now expands and
  collapses its rows; focusing on one stage is a separate "Only this stage"
  control, an empty focused stage says so and offers every stage back, a
  search runs inside the focused stage, and on web the focused stage lives in
  the address so a reload keeps it. Journeys hidden on this device are
  counted next to the Active tab with a tray that can show them one at a time
  or all at once, instead of a strip at the foot of the list. Rows stop
  repeating the stage they are grouped under and show "N in the race" (grey
  at nothing) plus when they last moved; the actions menu holds full screen
  and open-as-page for everyone; drag handles appear only under Manual order;
  the toolbar and stage headers stay pinned while scrolling; the list clears
  the floating Copilot and Help buttons; subtitles and pills are larger and
  brighter; name tags truncate. The Deals page no longer repeats the Journey
  lede, the "Stages follow the Board" label is now an "Edit stages on the
  Board" link, and the top bar's duplicate AI Assistant button is gone (the
  sidebar item and floating button remain). Mobile gets the same stage
  collapse, focus control, empty state and race count.
- **Captured shares can be reviewed on mobile.** A journey card's
  "N captured" count is now a chip that opens the same Captured tray the
  web journey has: each auto-captured WhatsApp share can be shown on the
  journey, all can be shown at once, or one can be removed after an inline
  confirmation. Until now the mobile count was read-only and the hidden
  items could not be reached at all.
- **Tap a stage to focus on it.** Selecting a stage card on the Journey
  list, on web and mobile alike, hides the other stage cards and
  highlights the selected one in its stage colour; selecting it again
  brings every stage back. Switching mode or view also clears the focus.
- **The Copilot button no longer covers the last journey row.** The
  Journeys list pads its bottom by the floating button's real height and
  offset, so the move, convert and notes icons on the final row scroll
  clear of it.

#### 19 September 2026

- **Mobile contact actions scroll sideways.** The Call, WhatsApp, Inbox,
  To Engine and other buttons on a contact now sit in one horizontal strip
  that scrolls instead of wrapping into rows, so more actions fit without
  pushing the contact details down the screen.
- **WhatsApp number-change notices now exclude new contacts.** The
  automatic precursor and the notify-recent-contacts action only address
  contacts whose one-to-one thread contains a message from before the
  number switch; a fresh portal lead no longer receives an irrelevant
  announcement about a number they never used. **Migration required:**
  `20260919143100_pre_switch_number_change_audience.sql`.
- **Buyer requirements resume after the bot resumes a thread.** The
  qualification listener now follows the latest outbound sender instead
  of staying muted whenever any of the last six messages came from an
  agent. A later bot reply hands the thread back to automation, while a
  later agent reply still keeps the bot quiet.
- **WhatsApp: stop retrying contacts capped by Meta error 131049.** Delivery
  failures now keep the original message intact and appear as a friendly status
  on web and mobile. A recipient-level 24-hour cooldown suppresses only
  Marketing templates, queued property alerts wait without consuming retries,
  Utility templates remain eligible, and any reply from the contact clears the
  cooldown. **Migration required:**
  `20260919150000_whatsapp_marketing_suppression.sql`.
- **Contacts: share the property portal link from a contact.** A new
  "Share Portal" action on the contact record (web and mobile) drafts a
  WhatsApp invite to the account's portal, opened on the contact's
  recorded area, property interest and buy/rent intent and attributed to
  them in Pulse. The message tells the buyer to search and filter for
  properties matching their requirements, shortlist the ones they like
  and send the enquiry from the portal so the agent can take it from
  there. It goes out from the business number (free text inside the
  24-hour window, the approved property selection template with a
  portal button outside it) or opens in the agent's personal WhatsApp,
  which notes the share on the contact's timeline.
- **Deals: one stage vocabulary for the journey and the board.** Journey
  stages are now mirrors of the pipeline's stages, so a buyer's map and
  the Kanban read the same names in the same order, and the journey's
  separate stage editor is gone in favour of the Board's pipeline
  settings. A converted deal and its journey branch stay on the same
  stage whichever one you move, and moving a branch into Negotiation/
  Token or later opens its closing record on that stage, asking for the
  brokerage first exactly as the board does — on the web journey, on
  the mobile journey (a new "Move to stage" action per branch) and from
  the WhatsApp closing card. A pipeline stage with journey items on it
  can no longer be deleted. **Migration required:**
  `20260919120000_journey_stages_mirror_pipeline.sql` and
  `20260919120200_pipeline_stage_delete_guard.sql`, then
  `20260919120050_journey_deal_sync_same_pipeline.sql` and
  `20260919120100_journey_stages_backfill.sql` once the app is updated.
- **Deals: the closing record starts itself.** Moving a deal into
  Negotiation/Token or any later stage (except Closed Lost) now seeds
  the standard milestones on the spot, whether the move comes from the
  board, the record's stage picker or the mobile app, since all three
  go through the same deal route. The Records tab lists closing records
  only, so the "Not yet a transaction" badge and the manual "Add
  standard milestones" button are gone; a pipeline deal that has not
  reached the closing stretch lives on the Board.
- **Deals: one place for the board, the journeys and the records.**
  Pipelines (which lived under Automations), Journey and Transactions
  were three pages describing the same deal cycle. They are now three
  tabs of a single **Deals** entry: Board, Journey and Records. The
  old addresses still work and carry their links across, Automations
  keeps Flows and Analytics only, and the Groups entry is named
  WhatsApp Groups so it no longer reads as part of the deal cycle. The
  mobile Deals screen gains Board and Records segments and a Journey
  button.
- **WhatsApp qualification: "More site" gets more sites.** A lead who
  answered a shortlist with "More site" was read as asking for a bigger
  plot, re-asked the budget question they had answered a day earlier, and
  then told nothing fits. Three fixes. A request for more listings ("more
  site", "any other options?", "anything else?") is now its own route:
  the bot sends the next listings the share ledger says the lead has not
  seen, or says that is everything that fits, with nothing filed and no
  question asked. The ladder reads what it has already asked off the
  whole thread rather than the last six messages, so a rung is never put
  twice. And relative size feedback ("bigger", "lesser dimensions") is
  anchored after the merge with the saved brief, so the bound it clears
  stays cleared — the merge had refilled it and stored a 2,824–2,400
  sq.ft. band nothing could satisfy. "More" only reads as a size signal
  before a measure word (area, extent, dimensions, sqft), never before
  "site" or "plot".
- **Transactions: the index reads like a closing record.** Rows are
  headed by buyer and property (unit number first) with the deal's own
  title demoted to a second line, so a requirement-style pipeline title
  no longer stands in for the transaction. A pipeline deal that was
  neither converted from a journey nor given milestones is marked
  **Not yet a transaction**, and the row offers "Add standard
  milestones" to start the checklist. The stage chip on the workspace
  header is now a stage picker: a lost or won deal can be moved back to
  an active stage without leaving the workspace, through the same call
  the pipeline board makes, and it asks for brokerage before a closing
  stage exactly as the board does. Web and mobile alike.
- **Auto-reply from a retired WhatsApp number.** A saved number that is no
  longer live still receives messages (it shares the WhatsApp Business
  Account), and the webhook used to drop them unseen. Each saved number in
  Settings → WhatsApp → Saved numbers now has an "Auto-reply" switch: with it
  on, a message to that number gets a reply from that number pointing at the
  live one, with the business name, the new number and a tap-to-chat link
  (or a custom message with `{{business_name}}`, `{{new_number}}`, `{{link}}`),
  at most once per sender per day. The inbound message reaches the account
  owner as an in-app and push notification linking to the contact. The switch
  cannot be turned on for the live number and clears when the number goes
  live again. **Migration required:**
  `20260919043000_whatsapp_retired_number_autoreply.sql`.
- **Matching: a single stated plot size now admits the larger corner
  sites.** "60x40" is filed as exactly 2,400 sq.ft., and the size gate
  dropped the 3,114 sq.ft. corner sites in the same layout as a miss. A
  single stated figure is now read as the size the buyer has in mind
  rather than a band: plots up to 35% larger stay in as near-fits, ranked
  below exact fits and below the within-10% near-misses, while smaller
  plots and anything beyond that headroom are still excluded. A stated
  band ("2,000–2,400 sq.ft.") and the "smaller"/"bigger" feedback anchors
  keep their strict caps. The order holds even when a full brief clamps
  every plot's score at 100: the size fit breaks that tie.
- **Matching: a stated plot type now matches plots, and the locality a
  buyer names comes first.** A lead who asked for a 60x40 site in Vijaya
  Bank Layout was sent a 10 BHK building, a villa in HSR Layout and a house
  in Koramangala while four plots in the layout sat unmentioned. The engine
  had no subtype group for "Residential Plot" or "Residential Land", the
  labels the extraction files, so a plot seeker's type fell back to the
  residential category and every house within radius tied with the plots.
  Both labels now map to the plot group, so houses are excluded for a plot
  seeker. Locality names are read with spelling slips allowed — one
  character per stem, a transposed pair, or a name fused into one word
  ("Vijayanbank layout") — in the stated areas, the excluded areas and the
  listing's own fields. Naming a locality now outranks being within radius
  of it: every buyer-facing shortlist (the qualification reply, the
  on-demand match reply, digests and the buyer portal) leads with the
  listings in that locality, plots before houses for a plot seeker, and
  only then nearby listings; a listing there in the buyer's stated sector
  stays in the list past a type mismatch, at the end. Being in the named
  locality is a location match whatever the listing's coordinates say. The
  on-demand match reply now records what it sent in the share ledger, so
  the qualification reply minutes later no longer repeats the enquired
  listing.

#### 18 September 2026

- **Number-change notice.** A new Utility engine template,
  `contact_number_update`, tells a contact that the brokerage now messages
  from a different WhatsApp number. After a switch in Settings → WhatsApp the
  connection tab shows a "Number changed" card for seven days: one tap sends
  the notice to every contact active in the last N days (7 by default, up to 30) who has not been told, and for those seven days the first routine
  message to any other contact is preceded once by the same notice. Free-form
  inside the contact's 24-hour window, the approved template outside it; a
  ledger keeps each contact to one notice per number. The template is offered
  under "templates the Engine sends" in every product language.
  **Migration required:** `20260918200000_whatsapp_number_change_notices.sql`.
- **WhatsApp registration state now comes from Meta.** Saving a number without
  a PIN used to record it as registered on trust, so a number Meta had never
  registered (for example one whose display name was declined) showed
  "Registered" while WhatsApp still said "Invite to WhatsApp". The save, the
  Verify with Meta probe, and a saved-number switch now read Meta's platform
  and display-name status, record the real state, and say what to fix.
- **Saved WhatsApp numbers.** Settings → WhatsApp now keeps every Official API
  number an account has connected, with its encrypted token and Meta
  registration state, in a "Saved numbers" card. Switching the live number is
  one click: no token re-entry, no two-step PIN, no re-registration. Only one
  number is live at a time; messages to the others are not delivered to
  ConvoReal until they are switched back. A number saved by another account,
  live or not, can no longer be claimed. `whatsapp_config` stays the single
  live row every consumer reads. Web only for now — the WhatsApp connection
  screen has no mobile counterpart (see `FEATURE_ROADMAP.md`).
  **Migration required:** `20260918190000_whatsapp_number_profiles.sql`.
- **Transaction Workspace (Phase 3): published updates.** From a deal's new
  Updates tab, compose an update for the buyer side, the seller side or all
  stakeholders from the milestones and timeline entries that side may already
  see, preview it per recipient, and publish it as a durable snapshot: the
  record cannot be edited afterwards, and a correction is a new update that
  names the one it replaces. Each recipient is reached through the business
  number (free-form inside their 24-hour window; the approved Purchase
  progress template to a buyer outside it, with their private link following
  their reply), through the agent's own WhatsApp as a hand-over the app never
  sends, or by link only. Sent, opened and acknowledged are recorded
  separately per recipient, and the stakeholder portal gains an Acknowledge
  action. Web and mobile at parity. **Migration required:**
  `20260918050000_transaction_workspace_updates.sql` and
  `20260918050100_transaction_workspace_update_events.sql`. (#903)
- Honor the Helper's active UI language (#902)
- **Retain every portal ad ID mapped to a property.** Reposted or refreshed ads
  from the same portal no longer replace one another and reappear forever in
  the mapping queue; all retained IDs continue to resolve future leads exactly.
  **Migration required:** `20260918160000_portal_listing_aliases.sql`.
- **Transaction Workspace (Phase 2): stakeholders and private links.** A deal
  now lists its stakeholders (buyer, seller, advocate, banker, broker,
  witness) by side, and each buyer- or seller-side person can be handed a
  private link that shows only what their side may see: milestones, timeline
  entries and documents each carry a visibility (internal only by default),
  financials and internal notes never appear, and photos open with the
  viewer's name watermarked. Links expire (24 hours, 7 or 30 days), can be
  revoked, count every open in SQL, and log each open and document fetch;
  a sensitive link can require a one-time code sent by email, checked at
  most five times. Nobody outside the brokerage gets a login. Web and mobile
  at parity, including the per-link access log. **Migration required:**
  `20260918030000_transaction_workspace_stakeholders.sql`,
  `20260918030200_deal_share_view_counter.sql` and
  `20260918030100_transaction_workspace_share_events.sql`. (#900)
- Make the audit timestamp test independent of the machine's timezone (#899)
- Fail the build when CHANGELOG.md stops being readable text (#898)
- Restore CHANGELOG.md as readable markdown (#897)
- **Transaction Workspace (Phase 1).** A Journey converts into a deal's closing
  record: overview with internal-only financials, an immutable event timeline,
  reusable milestones kept separate from pipeline stage moves, deal-linked
  tasks, and a document folder with a forward-only lifecycle. Web and mobile at
  parity; code identifiers stay `deal_*`. Decisions are recorded in
  `docs/transaction-workspace.md`. **Migration required:**
  `20260918010000_transaction_workspace.sql` and
  `20260918010100_transaction_workspace_stage_events.sql`. (#896)
- **One-tap portal mapping confirmation.** When an unmapped portal ad already
  has a guessed property, the agent accepts that mapping in one tap on web and
  mobile, with a separate path to choose a different property. (#895)
- Guard the property-ask chat's scroll against a missing scrollTo (#894)

#### 17 September 2026

- **Requirement account shares.** Buyer requirements are shared directly between
  agent accounts, with verified in-app sharing and responses on web and mobile,
  plus independent edit and delete controls for saved buyer briefs. **Migration
  required:** `20260917131000_requirement_account_shares.sql` and
  `20260917133000_requirement_account_share_indexes.sql`. (#893)
- Fix mobile chat optimistic send feedback (#892)
- Preserve dial prefixes and offer WhatsApp channels (#891)
- Show enquired contacts on property details (#890)
- Clarify journey stage notes (#889)
- Default buyer intent and add Bengaluru market zones (#888)

#### 16 September 2026

- Send accurate property status notifications (#887)
- Fix filtered showcase result sharing (#886)
- Add clear-all controls to public showcase shortlist (#885)
- Fix locality nearby search selection (#884)
- Fix dotted locality search and share property shortlists (#883)
- Include Google Maps in property share templates (#882)
- Fix LeadBot crash when Element.scrollTo is unavailable (#881)
- Fix false 16 MB limit for Premium video uploads (#880)
- Fix calendar correction timezone shift (#879)
- Allow 100 MB walkthrough uploads on paid plans (#878)
- Fix property location from Google Maps pins (#877)
- Consolidate the uploaded invoice into the deal document folder (#876)
- Fix Redis rate-limit cold-start fallback (#875)
- Fix Helper navigation to the deal folder (#874)

#### 15 September 2026

- Fix public showcase links caching zero results (#873)
- **Journey stage notes on every stage.** Every configured stage takes an
  append-only note before or after it is reached; the latest note shows in the
  stage rail and the full history keeps its stage snapshot, author and time.
  (#872)
- Prevent false requirement save timeouts (#871)
- Record reasons when closing inbox leads (#870)
- Fix unhandled clipboard rejection on co-broker reshare copy (#869)
- Preserve contact RLS in Journey summaries (#868)
- Aggregate Journey overview safely in Postgres (#867)
- Load complete Journey history and keep notes readable (#866)
- Fix Journey mobile parity and stage-note integrity (#865)
- Restrict Journey table privileges (#864)
- Organize journeys by stage, outcome and notes (#863)
- Add a per-invoice GST toggle and correct AGENTS.md's codebase figures (#862)
- Add brokerage invoicing and the deal document folder (#857)
- Defuse the dated calendar test that starts failing on 15 Sep 2026 (#861)
- Guard the showcase share link's clipboard write (#858)
- Pin the reschedule-dedup test's old-appointment date (#860)

#### 14 September 2026

- Say why a signup was refused instead of "Database error" (#856)
- Keep contact budget band tags in step with the budget (#855)
- Fix greeting card fallback after image timeout (#854)
- Prevent greeting card generation from failing compose (#853)
- Add personal WhatsApp option for occasion greetings (#852)
- Retry transient WhatsApp configuration reads (#851)
- Select individual contacts for occasion greetings (#850)
- Add actual close date and invoice uploads to deals (#847)
- Capture contact budgets as an amount and a unit (#849)
- Close final tenanted matching edge cases (#846)
- Ignore generic budget questionnaires in buyer qualification (#848)
- Send alert consent as interactive WhatsApp buttons (#845)
- Fix occasion greeting generator startup failure (#843)
- Harden tenanted-only matching evidence (#844)
- Guard calendar product invariants (#837)
- Add tenanted-only buyer matching and alert consent nudge (#836)
- Fix calendar reschedule idempotency and name matching (#835)
- Fix calendar participant reminder audience (#834)
- Show upcoming appointments and tasks on mobile calendar (#833)
- Fix WhatsApp calendar reschedule corrections (#832)
- Retry transient WhatsApp contact lookups (#831)
- Fix portal lead property context replies (#830)
- Prevent incorrect buyer follow-up deliveries (#829)
- Send matching buyer alerts in real time (#828)
- build(deps): bump @dagrejs/dagre from 3.0.0 to 3.1.1 (#718)
- build(deps): bump actions/setup-go from 6 to 7 (#716)
- build(deps): bump actions/cache from 4 to 6 (#715)
- chore(deps): bump actions/upload-artifact from 4 to 7 (#714)
- chore(deps-dev): bump the dev-dependencies group across 1 directory with 7
  updates (#798)
- fix(mobile): redirect expired sessions to login (#802)

#### 13 September 2026

- Add omnichannel document approvals and improve chat matching (#827)
- Show contact and inventory audit dates (#826)
- Clarify unchanged WhatsApp listing edits (#825)
- Track showcase search queries in Pulse (#824)
- Store WhatsApp tenant updates in structured rent roll (#823)
- Make brokerage paid the terminal deal outcome (#822)
- Fix location-only buyer refinements (#821)

#### 12 September 2026

- Make inventory WhatsApp shares scope aware (#820)
- Keep property context in buyer broadcasts (#819)
- Fix agent inventory digest buyer details (#818)

#### 11 September 2026

- Clarify Helper web and app handoffs (#817)
- Add actionable Helper links and voice input (#816)
- Fix commercial plot intake and mobile road width (#815)
- Fix buyer match showcase URLs (#814)

#### 10 September 2026

- Fix event close replies falling into property search (#813)

#### 9 September 2026

- Fix per-sqft buyer budget extraction (#812)
- Keep WhatsApp AI replies in the buyer's language (#811)
- Add invite-to-reshare property onboarding (#810)
- Allow PDF uploads for land sketches (#809)
- Add still-considering follow-up disposition (#808)
- Add property linking from contact details (#807)
- Fix exact contact search ranking (#806)
- Add periodic property portal expiry reminders (#805)
- Fix PDF guide display under security headers (#804)
- Add feature-wise onboarding help centre (#803)

#### 8 September 2026

- Reconcile and retry mobile property share fan-out (#801)
- Fix mobile sharing from historical listing audiences (#800)

#### 7 September 2026

- Add contextual property availability check (#799)
- Fix Pulse attribution for Engine property shares (#797)
- fix(copilot): add copy controls and repair desktop handoff (#796)
- fix(copilot): guide listing audience sharing before add-property tours (#795)

#### 6 September 2026

- Add agency showcase web address to onboarding guide (#794)
- Fix mobile map E2E cleanup (#793)
- Focus showcase map from shortlist and allow collapse (#792)
- Fix blank showcase maps, scrolling and bookmark hover text (#791)
- Let agencies choose among three showcase designs (#790)
- Select named showcase properties in the enquiry browser test (#789)
- Keep the floating assistant above showcase shortlist actions (#788)
- Add showcase shortlist and combined property enquiries (#787)
- Handle matching agent and agency names in inventory UI test (#786)
- Show who added a property to their inventory on web and mobile (#785)
- Personalize invites with waiting inventory (#784)

#### 5 September 2026

- Personalize top property inventory shares (#783)
- Add category-aware inventory detail replies (#782)
- fix: share-feedback-followups queried nonexistent messages columns (#781)
- Add property interest follow-up action (#780)

#### 4 September 2026

- Make the web AI Assistant easy to find (#779)

#### 3 September 2026

- Serve selected property details within buyer budget (#778)
- Serve corrected buyer requirements before alerts (#777)

#### 2 September 2026

- Refresh mobile implementation status (#776)
- Align Copilot migration version (#775)
- Add confirmed Copilot actions (#773)
- Fix and expand onboarding guide PDF (#774)
- Align Copilot migration history timestamp (#772)
- Add indexed Copilot entity references (#771)
- Add listing duplication for same-society inventory (#770)
- Update onboarding guide with visual workflows (#769)

#### 1 September 2026

- Show invited team members a role-appropriate welcome (#768)
- Add shareable quick-start guide to onboarding and invites (#767)
- Flag property listings within 100m as probable duplicates (#766)

#### 31 August 2026

- Include developers in the new-listing alert audience (#764)
- Make "keep me posted" actually subscribe the lead, and offer the catalogue
  (#763)
- Stop re-asking a lead what we already know, and re-offering what they were
  sent (#762)

#### 30 August 2026

- Let an agent unmap a portal ad from the wrong listing (#761)
- Lock seller replies to the sender's language (#760)
- Do not drop an inbound message whose contact has no profile (#759)
- Document the Sentry DSNs the mobile, worker and ingress builds need (#758)

#### 26 August 2026

- Improve Calendar task status and participant check-in (#756)
- Fix opencode workflow model (#757)
- Check with participants before closing calendar tasks (#755)

#### 25 August 2026

- Fix false portal drift alerts for plot and built-up area (#754)
- Treat a rate-limited property share as a wait, not a failed send (#753)
- Fix property shares reported as failures while still sending (#752)
- Render personalized invite text directly in OG image (#751)
- Restore serverless-safe cached invite images (#750)
- feat(inventory): search the audience picker, and say what it selected (#749)
- Fix personalized invite images in WhatsApp previews (#748)
- Send the inventory update template from the phone (#747)
- Serve the inventory digest from the API so mobile can send it (#745)
- Fix production invite preview image rendering (#746)
- Personalize and securely resend beta invites (#744)
- Restore readable mobile showcase cards (#743)
- Bring the three-step showcase share to mobile (#740)
- Open beta invites in the typed WhatsApp contact (#742)
- Bind beta invites to a verified WhatsApp number (#741)
- Enable privacy-safe production error monitoring (#739)
- Revamp showcase sharing into a three-step flow (#738)
- Fix showcase share crash and scope shares to the active search (#737)
- Keep selected-contact sharing visible on property details (#736)
- Fix Property Edit keyboard focus scrolling (#735)
- Add contact inventory sharing and WhatsApp invites (#734)
- Add mobile Calendar to-do editing (#733)
- Add event editing and participant notifications (#732)
- Stabilize production AI billing smoke balance (#731)
- Run production AI smoke after workflow changes (#730)
- Fix production AI smoke configuration (#729)

#### 24 August 2026

- Restrict public business profile writes to admins (#728)
- Complete multi-turn property visit booking from WhatsApp (#727)
- Make public business profile copy customizable (#726)
- Confirm properties before orchestrating lead follow-up (#725)
- Secure beta invite issuance (#724)
- fix: soften desktop showcase 3D motion (#723)
- Preserve pending lead context on clarification (#722)
- Assert automatic inventory sync at dashboard login (#713)
- Use a valid listing source in inventory E2E fixture (#712)
- Run inventory E2E in the configured protected environment (#711)
- Add E2E coverage for agent inventory sharing (#710)
- Share inventory across agent accounts (#709)

#### 23 August 2026

- docs(agents): CREATE OR REPLACE on an existing function is not an additive
  migration (#708)
- docs(agents): opening the PR and applying the migration are not optional
  (#707)
- feat(onboarding): add guides for recent features (`12bb5408`)
- feat(inventory): share a listing with another listing's audience in one click
  (#705)
- feat(chatbot): hold new-listing pitches until the date a client named (#704)
- feat: add company and desktop showcase designs (#703)
- fix(chatbot): stop answering someone else's question, and stop re-sending
  (#702)
- feat: add multi-location property filters on mobile (`1d0bc0ed`)
- test: expand mobile development-build E2E coverage (#648)
- feat: replace showcase tilt with mobile flip deck (#700)
- chore: align showcase migration history (#699)
- feat: add agent showcase styles and 3D transitions (#697)
- feat: share journey drop feedback with owners (`5b611929`)
- feat: add showcase multi-location filter (`3ef2c4a7`)

#### 22 August 2026

- feat: add scoped WhatsApp bot rule book (#695)
- fix(chatbot): offer a candidate only when the book actually names one (#694)
- fix(mobile): stop retrying analytics timeouts (#693)
- fix(mobile): recover responsive analytics screens (#692)
- fix(whatsapp): deliver propertyless follow-up check-ins (`a0d8e239`)
- fix(whatsapp): prevent expired draft sessions from eating template button taps
  (#690)
- feat(chatbot): offer the contacts a forwarded chat points at (#689)
- fix(chatbot): a buyer's brief is demand, not a listing (#688)
- feat(chatbot): file the requirement a forwarded reply states (#687)
- feat(chatbot): hear the answer to "who is this client?" (#686)

#### 21 August 2026

- fix(contacts): a stated property interest is an enquiry (#685)
- feat: 30-minute property share feedback loop (#684)
- refactor(matches): one match row component per surface (#683)
- feat(matches): show what each matched contact enquired about (#682)
- fix(mobile): make matched-contact multi-select discoverable (#681)
- feat(showcase): add agency services and articles sections (#678)
- fix(mobile): collapse the matching contacts section and scroll it in place
  (#680)
- chore(whatsapp): script the location_reveal template edit (#679)

#### 20 August 2026

- feat(contacts): give the contact form a buy-or-rent field, web and mobile
  (#677)
- feat(whatsapp): ask buy-or-rent as a rung of the qualification ladder (#676)
- feat(showcase): keep the intent the visitor taps (#674)
- feat(whatsapp): carry the property into the location_reveal template (#675)
- fix(mobile): drop the map marker on the same pin the other surfaces use (#673)
- feat(matching): derive Sale/Rent intent from enquiry history (#672)
- fix(location): one map pin everywhere, property details with the reveal (#671)
- feat(sweep): exclude owner-side contacts (#670)
- Address clients with selected salutations (#669)
- fix(migration): drop the kind CHECK before writing the new kind (#668)
- refactor(sweep): collapse no_deal and missing_next_step into one gap (#667)
- fix(sweep): never auto-apply a number read out of yesterday's thread (#666)
- ci(mobile): bundle with expo export so unresolvable imports fail before merge
  (#665)
- fix(mobile): port resolveRequirementSource so the OTA bundle builds (#664)
- feat(sweep): daily 6am read-back over yesterday's conversations (#663)
- feat(whatsapp): handle property disinterest with factor deep dive and typing
  prompt (#662)
- fix(qualification): gate enquired property by stated budget and add disparity
  pivot reply (#661)
- fix(calendar): support contextual schedule replies with outcome recording and
  contact-linked follow-up meetings (#660)

#### 19 August 2026

- Capture personal WhatsApp agent sends in journey events and backfill history
  (#659)
- feat: move contact requirements into dedicated tab (#658)
- Capture personal WhatsApp sends in journey timeline (#657)
- test: add compound notify + reminder follow-up regression coverage (#656)
- Stabilize E2E template and follow-up regressions (#655)
- Handle compound notify intents with contact WhatsApp updates (#654)
- Capture personal WhatsApp journey sends in timeline (#653)
- Fix showcase agricultural matching and ensure buyer showcase link closeout
  (#651)
- Add inventory search clear controls (#649)
- Fix duplicate grouping and dismiss API validation (#647)
- test: add release gate E2E workflow (`c6d45d85`)
- fix(outreach): stop pulling sharp into the outreach-followups cron bundle
  (#645)
- build(deps): bump dorny/paths-filter to v4 (#644)
- chore(deps): bump lucide-react to 1.28.0 (#643)
- build(deps): bump actions/setup-node to v7 (#642)
- build(deps): bump actions/checkout to v7 (#641)
- chore(deps): update and pin Supabase clients (#640)
- chore(deps): bump date-fns to 4.4.0 (#639)
- Restore Starter caps with RLS-safe entitlements (#638)

### Changed

- **Mobile visual foundation is consistent across appearances and foldable
  widths.** Light and dark now share one brand typography pairing — Plus
  Jakarta Sans for display hierarchy, Inter for dense CRM copy — so changing
  appearance no longer changes text metrics or card layouts. Low-emphasis
  controls in light mode have stronger contrast, the floating tab and
  favourites bars cap their width on unfolded devices, and Properties adapts
  to two columns from 640pt and three from 960pt with matching loading cards.
  Inbox and Contacts now cap dense lists at a readable 760pt; narrow Inbox
  surfaces the three everyday filters first, while narrow Contacts separates
  requirement filters from lifecycle segments. More uses paired settings
  columns from 720pt so foldables no longer stretch one long menu across the
  full display. On iOS, floating navigation, favourites, sticky property
  actions, chat composition and opt-in blurred cards now use native Apple
  system materials, and the chat composer clears the home indicator.

### Added

- **Walkthrough video upload is available directly in both property editors.**
  Web and mobile now accept the same MP4 walkthrough used by WhatsApp intake
  (maximum 16 MB), attach it to the property showcase, and reuse the existing
  unlisted YouTube auto-upload queue. Replacing a video clears stale YouTube
  state before the new upload is queued. Bucket-relative videos from WhatsApp
  are also resolved correctly for playback, YouTube upload and removal. No
  migration is required.

- **Match Radar can include fresh contacts and learn from confirmed replies.**
  New-listing cards on web and mobile can search and add existing live Buyers
  or Agents who were not in the computed match set; manually added rows are
  labeled and never treated as a match or a learning signal. The send route
  rechecks account access, lifecycle, requirement status and WhatsApp consent
  before delivery. Every delivered property is now recorded in the share
  ledger and followed by one-tap Interested / None fit feedback when the chat
  window permits it (or after the recipient replies to the alert template).
  Only those confirmed replies feed learning: rejected listings stay out of
  both Radar directions, and a mismatch answer asks for the corrected budget,
  location, type or size so the contact's saved requirements drive later
  matches. No migration is required.

- **An over-size brochure now yields its contents instead of failing.**
  The listing details, floor plans and photos are extracted and kept; only
  the file itself is dropped, and the WhatsApp reply says so — naming the
  size, the limit, and what was kept — rather than reporting a bare
  failure. A brochure's worth to a listing is what is in it, and that part
  is a fraction of the size. Applies to a PDF that opens a draft and one
  forwarded into an open draft alike, and to non-PDF documents too.

- **Floor plans, pinned per floor** (**migration required**: `285`). A new
  `properties.floor_plans` array holds one plan drawing per floor — floor
  label, image, area and notes — for any property type, and
  `floor_tenancies` rows gain an optional `floor_plan` so a commercial
  rent-roll floor keeps its layout beside its tenant. Editable at full
  parity on web and mobile — a Floor Plans editor plus an Attach/Replace
  control on each rent-roll row — and shown on the property view of both.
  Brochures forwarded to the WhatsApp intake bot fill it in themselves:
  the parser names the floors it sees plans for and the extractor pins
  each drawing to the page that captions it, leaving a floor empty
  rather than guessing.

### Fixed

- **Property tags now participate in buyer search and matching.** Areas of
  interest, named projects, and requirement text can find an internal listing
  tag such as `LOTUS`, including in Match Radar and mobile property matches.
  Tags remain internal and are never exposed on the public showcase. No
  migration is required.

- **Mobile loading and Property Edit inputs stay fully visible.** The startup
  loader renders the complete ConvoReal wordmark without the font-timing mask
  that could clip its final letter. On Android, the Property Edit form now
  reduces its scroll viewport when the keypad opens so the focused property
  field remains above it. No migration is required.

- **HOT now means the buyer replied.** Portal imports, property matching,
  enquiry linkage and outbound messages no longer qualify a contact as HOT.
  Any inbound buyer reply can upgrade an unset temperature, while an agent's
  explicit HOT, COLD, Not Responding or Dead judgement remains untouched.

- **Android OTA exports resolve the property plan/sketch labels reliably.**
  The native editor now reads its display copy from the mobile bundle instead
  of a web-only runtime alias, so Metro can publish land-sketch support.

- **Property editors now ask for fields that fit the selected property type.**
  Land listings use a direct Add Sketch action and Land Sketches gallery on
  web and mobile instead of floor-plan terminology; commercial and industrial
  land no longer show rental-income or rent-roll fields. Penthouses no longer
  ask for parcel dimensions, Floor No. is limited to units inside a building,
  and Total Floors is editable on mobile for apartments and other constructed
  assets. Switching types also clears incompatible hidden area/floor values.
  No migration is required.

- **“Show Properties” now starts with the property the lead enquired about.**
  An available portal enquiry is pinned ahead of matching alternatives even
  when the buyer has not completed a wider brief, while an unavailable one is
  named explicitly before alternatives are offered. Qualification also retains
  the property type, budget, area and project facts already present on the
  contact, so a reply such as “2.5–3 Cr, KR Puram” no longer triggers a repeat
  question asking whether the buyer wants a villa. No migration is required.

- **A brochure over 10 MB could not be uploaded at all** (**migration
  required**: `285`). The `property-documents` bucket was capped at 10 MB
  (migration 058), so a 33 MB developer PDF forwarded to the WhatsApp
  intake bot was rejected by storage and reported only as "Failed to
  upload document. Please try again." — advice that could never work, on
  a draft that went on showing "Documents: 0 attached". The ceiling is
  now 100 MB on the bucket — but the **effective** ceiling is the lower of
  the bucket limit and the project-wide upload limit, so on a Supabase
  free plan it is 50 MB. Measured, not assumed: 50 MB uploads, 51 MB is
  refused with `EntityTooLarge`. `DOCUMENT_SIZE_LIMIT` is 50 MB to match,
  on every surface, and storage's own refusal is now reported as a size
  problem rather than as advice to retry. Raise the constant to 100 MB
  once the project's upload limit is lifted past it — nothing else needs
  to change.

- **PDF floor plans were silently skipped.** Image extraction read only
  `/DCTDecode` (JPEG) streams, which is what photographs use; line art —
  floor plans, site plans, elevations — is almost always `/FlateDecode`,
  so plans present in the file were never found. The extractor now
  inflates and un-predicts those streams too, and tells drawings from
  photographs so each can be filed where it belongs.

- **A PDF sent into an open draft was filed but never read.** Only a PDF
  that _started_ a draft had its images extracted; one forwarded into a
  session already in progress was stored as a document and nothing more.
  Both paths now get the same treatment, and the confirmation says what
  the brochure yielded.

- **Two more contact notes that never saved.** The forwarded-chat reply
  and inbox check-in reply handlers (`src/lib/journey/client-response.ts`)
  both omitted the NOT NULL `account_id`, so their note insert was
  rejected and only logged. Found by auditing every `contact_notes`
  write after the same bug turned up in the greetings dialog; no other
  call site is affected.

- **`DATABASE_SCHEMA.md` and `AGENTS.md` §12 corrected.** The schema doc
  described `contact_notes` as having `author_id` and `content`; the
  real columns are `user_id` and `note_text`, and code written against
  the documented names is rejected at runtime — which is how the two
  bugs above were written in the first place. The CI note claimed
  `build` never runs on pull requests; it runs whenever a PR adds or
  renames a route, `next.config.ts`, or `ci.yml`.

### Added

- **WhatsApp marketing consent is visible and settable per contact**, on
  web (the contact editor, under Preferred Update Channel) and on mobile
  (the contact screen, same place). Until now `buyer_alerts_consent` was
  written only by the contact's own STOP/START ALERTS reply, the buyer
  portal, the public requirements form and mark-dead — an agent could
  neither see it nor record what a client told them on a call. Three
  states, each with what it means for sends: Not asked yet, Opted in,
  Opted out. Moving someone to Opted out is always allowed; moving them
  _off_ Opted out undoes a refusal they made themselves, so it takes an
  explicit confirmation (`PATCH /api/contacts/[id]/consent` returns
  `CONSENT_OVERRIDE_REQUIRES_ACK` until acknowledged). Every agent-side
  change writes a dated, attributed line to `contact_notes`, because
  consent is a compliance record and "who changed this, and when"
  is the question that gets asked about it.

### Fixed

- **A greeting composed twice could carry the wrong card.** Composing
  again with the image toggle off — or after an image failure — left the
  previous occasion's artwork attached, so the saved greeting could go
  out with a Diwali card on a New Year message. Both surfaces now
  replace the card state on every compose instead of merging it.

- **The opted-in count is aggregated in SQL** (**migration required**:
  `284_alerts_consent_counts.sql`). Both greeting send dialogs counted
  opted-in contacts with a client-side `count: 'exact'` — a real
  `COUNT(*)` over the account's contacts on every open, on every device,
  which AGENTS.md §2.6 forbids. It now goes through
  `account_alerts_consent_counts()`, a `SECURITY DEFINER` function
  guarded by `is_account_member()`, served by
  `GET /api/contacts/consent-counts` and shared by both surfaces.

- **Editing a greeting works on mobile.** The card offered Send and
  Delete but no Edit, so a typo meant deleting and recreating — while
  the web card had had the action all along.

- **The AI greetings dialog never actually logged its sends.** Its
  `contact_notes` insert used a `content` column that does not exist
  (the column is `note_text`) and omitted the NOT NULL `account_id`, so
  every insert failed into a `catch` that only logged to the console.
  Found while adding the consent audit trail, which writes to the same
  table.

- **Occasion greetings on mobile.** The Greetings surface now exists on
  both platforms (§2.8): More → Marketing → Occasion greetings lists the
  account's greetings, composes one with the AI (occasion, tone, optional
  guidance, card image), and sends it to all contacts or by tag, with the
  same strict opt-in toggle and opted-in count the web dialog offers.
  Nothing about the feature is re-implemented natively — the screen is a
  client of the same `/api/greetings/*` routes. The occasion calendar in
  particular is **not** copied into the app: festival dates shift every
  year and a copy inside an installed build would go stale, so the new
  `GET /api/greetings/occasions` serves it from
  `src/lib/greetings/occasions.ts`, the module the web imports directly.

- **Occasion greetings** (**migration required**:
  `283_occasion_greetings.sql`). A "Greetings" tab on `/broadcasts`: pick
  an upcoming occasion (Ganesh Chaturthi, Diwali, New Year, Onam and
  more, or type your own), have the AI write the greeting in your
  agency's voice and design a festive card image (10 credits per
  compose, text refunded on failure — the same `greetings_generate`
  price as the per-contact generator), edit it, and broadcast it to all
  contacts or by tags. Sends ride a shared `occasion_greeting` WhatsApp
  template (image header + client name, greeting, agency name as
  variables) that is auto-submitted to Meta once per account and reused
  for every occasion; the fan-out is a normal broadcast, so delivery
  tracking, retries and the sweep cron apply, and contacts who replied
  STOP ALERTS are excluded. Note: Meta classifies festival greetings as
  **Marketing**, so sends count against Meta's per-user marketing caps —
  the template is submitted as Marketing deliberately (see AGENTS.md
  §2.7 on why chasing Utility burns template names). The send dialog
  offers a strict **"only clients who explicitly opted in"** toggle
  (`buyer_alerts_consent = 'granted'`), shows how many contacts have
  opted in, and explains where grants come from — the free-form ask a
  pending contact gets the first time they message in, and the portal
  enquiry forms. There is deliberately no consent-ask template: Meta
  classified the earlier `buyer_alerts_consent` template as Marketing,
  and a marketing template asking permission for marketing is the thing
  consent exists to prevent (`src/lib/buyer/consent-ask.ts`). Mobile
  parity is a stated gap in `FEATURE_ROADMAP.md`.

- **Post-call WhatsApp follow-up** (**migration required**:
  `281_post_call_followups.sql`). What a voice call produced now
  decides what the lead hears next. The provider's webhook carries an
  explicit `disposition` (or one is derived from the qualification
  block), and a per-flow playbook maps it to an action: the
  matched-listing shortlist for `qualified` / `budget_mismatch_open` /
  `requirement_changed`, a courtesy close for `budget_mismatch_closed`
  and `already_bought`, an agent handoff plus a to-do for
  `wants_site_visit` / `wants_details` / `wants_human`, a dated
  check-in for `not_now` (at the lead's stated `check_back_at`, else
  30 days — swept hourly by `/api/cron/outreach-followups`), and
  deliberate silence for the rest. A phone call does not open Meta's
  24-hour window, so a shut window sends one Utility opener template
  (`post_call_options`, new engine template in all 7 languages,
  gated on approved-and-Utility) whose "Yes, send them" tap opens the
  window and pulls the shortlist free-form. Every send passes one
  gate — do-not-call, window state, template category, webhook
  dedupe — and every non-send records its reason on
  `outreach_followups` instead of vanishing.

- **Call Analytics** (**migration required**:
  `282_call_analytics_rpcs.sql`). A new tab on Broadcasts analysing
  the account's calls: volume, connect rate and average call length,
  calls per day (total vs connected, bucketed in the viewer's time
  zone), the outcome split, what each conversation produced by
  disposition with follow-ups sent and opener taps per row, and the
  post-call follow-up funnel — including why skipped follow-ups were
  skipped. Served by SECURITY DEFINER aggregates behind
  `GET /api/calls/analytics`, so mobile can consume the same bundle
  later (gap recorded in `FEATURE_ROADMAP.md`).

- **Appointment reminders as WhatsApp voice notes** (**migration
  required**: `277_reminder_audio.sql`). Contacts who chose audio
  updates (`preferred_update_channel = whatsapp_audio`) now get their
  reminder spoken — the reminder cron queues a per-reminder TTS job and
  the queue worker renders it in the contact's conversation language
  (Sarvam translate + TTS → ogg/opus) and sends it as a voice note,
  when the account has opted in under Settings → WhatsApp → Voice and
  the contact's 24-hour window is open. 2 credits per note, refunded
  whenever the note never lands; every failure path falls back to the
  usual reminder template, so no reminder is lost to a render or queue
  outage. This completes the reminder-channel trio: text templates,
  voice-agent calls (Phase B), and now voice notes.

- **"Ask for property details" now offers the listing page too, and
  sends from the contact row.** The first message an agent sends a
  seller carried one route — the office WhatsApp number. It now carries
  both: the number, and the account's own **List your property** page
  (`/list?ref=…`, on the brokerage's subdomain when it has one), which
  takes the details, the photos and a PDF brochure in one form and
  verifies the sender's number on WhatsApp at the end. An agent sitting
  on a deck will usually take that one. The message also now says what
  answering it buys them — the property gets a page of its own, goes out
  to the buyers already looking for exactly it, and is ready for the
  portals — before the existing promise of updates on enquiries, visits
  and offers. It still goes from the agent's own WhatsApp, which is
  where a first conversation with an owner actually happens. Accounts
  writing their own wording get a `{{listing_link}}` placeholder. The
  action now sits on the contact **row menu** as well as the contact
  page, on web and mobile alike, so a list of owners can be worked
  through without opening each one. `docs/property-intake-consolidation.md`
  audits all six ways a property can get into the Engine and records why
  this page is the one to hand to anyone outside the brokerage.

- **Hot leads no longer go quiet unnoticed** (**migration required**:
  `272_follow_up_nudges.sql`). A ₹5-10 Cr portal lead enquired on two
  listings, asked "is the price negotiable", said "we can talk
  whenever" — and went six days unanswered, because the HOT-going-quiet
  panel on /today only watches leads someone remembered to mark HOT,
  and only on the days someone opens /today. Two changes close that.
  The webhook now sets `lead_temp = HOT` after the buyer replies on
  WhatsApp — never from a portal import, property match or outbound
  message, and never overwriting a temperature an agent set by hand.
  And a daily cron
  (`/api/cron/follow-up-nudges`, 04:15 UTC) cards the routed agent on
  WhatsApp about each HOT lead silent for 48h+: lead, listing, days
  quiet, with **💬 Check in** (the bot nudges the lead — free-form
  inside their 24-hour window, the approved `enquiry_checkin_notice`
  template outside it), **⏰ Snooze 3 days** and **❄️ Mark cold**.
  Per-lead state in `follow_up_nudges` caps the radar at one card per
  lead per week, capped at three cards per account per day. The /today
  panel also now includes `pending_review` leads, which every enquiry
  produces by design.

- **A buyer asking for photos now gets the photos.** "Sir can I get
  images images", sent moments after a listing was shared, was answered
  with "What kind of property are you looking for?" — the message is not
  question-shaped, carries no budget or property type, and numbers no
  shortlist entry, so the qualification ladder claimed it and restarted
  the intake of someone already reading a listing. An agent sent the
  photos by hand eight minutes later. The bot now replies with up to
  four of the listing's public photos (two each when several listings
  are in play), the first captioned with the title, the listing video
  when it is asked for and ready, and a closing line linking the rest of
  the gallery. Only the public photos ever travel: confidential and
  gated photos stay behind their proxy however the request is worded.
  When nothing can be sent — no listing pinned to the thread, or an
  empty public gallery — the reply promises the photos and hands the
  thread to an agent rather than going quiet.

- **A showcase enquiry lands in the Engine, as a card**
  (**migration required**: `268_whatsapp_display_phone_number.sql`).
  Tapping Enquire on the public catalog opened a chat to
  `showcase_settings.contact_phone` — in practice an agent's personal
  mobile — so the enquiry, and every message after it, was invisible to
  the Engine: no contact, no conversation, no Radar, nothing learned
  from the negotiation. `whatsapp_config` only ever stored Meta's opaque
  `phone_number_id`, so the showcase could not address the business
  number even in principle; it now also stores the dialable number,
  which the config save was already fetching and discarding. The
  enquiry tap resolves separately from what the page displays —
  `contact_phone` keeps the call link, the "Inquire:" line and the agent
  block — and a referral link still wins over both, so a co-broker's
  lead is never quietly reassigned. An enquiry that reaches the Engine
  now arrives as a card naming the listing and the buyer, with buttons
  to send the photos, send the full details, or take the thread and keep
  the bot out of it. Accounts on sandbox, or not yet re-saved, keep the
  previous behaviour.

- **The Engine notices when a portal ad and its listing disagree.**
  Once an ad is mapped, nothing told anyone when the two sides diverged
  — a listing was archived while its MagicBricks ad stayed live,
  approved, and producing leads for withdrawn stock. Four drift checks
  now run over the leads and sync logs already in the database
  (**migration required**: `267_portal_listing_drift.sql`): leads
  arriving on an ad whose listing is Sold/Archived/Off Market/Rejected;
  leads arriving after the recorded expiry (the expiry is stale, not
  the ad); no leads well past the expiry (the ad probably lapsed); and
  the ad's parsed type, price or area drifting from the listing's, one
  side having been edited. Findings appear on the Inventory page on web
  and the Properties tab on mobile, each with the facts behind it and a
  link to the ad. Nothing to dismiss: fixing the condition — relist,
  update the expiry, mark the ad removed — is what clears a row. Lead
  emails now also record the quoted ad id next to the parsed enquiry in
  the sync log (backfilled for existing leads from their retro-tagged
  contacts), which is what lets "what the ad currently says" be compared
  to the listing at all.

### Changed

- **A stated max budget now implies a floor.** Matching treated a
  budget as a ceiling only, so a buyer with ₹20 Cr on file scored
  "Budget fit" on a ₹4.32 Cr listing — every cheaper property in
  inventory read as a match for the biggest budgets. A max with no min
  now implies a floor at half the max: within half-to-full of the
  stated budget is a fit, down to 40% grades as flexible, further out
  excludes the contact from matches, shares and digests alike. Stating
  an explicit min budget on the contact widens the band on purpose.
  Explicit ceilings keep their old floor-less reading: "under X"
  phrasing in notes, a max at the entry band of its market ("Under
  ₹50 Lakh" / "Under ₹25K a month" — the whole bottom of the market),
  and a sale-scale budget read against a rental's monthly rent.
  Applies everywhere the engine runs — web, mobile, Radar, deal-mode
  and buyer digests.

- **The matched-contacts list can target agents alone.** The share
  dialog, the property form's matches tab and the mobile matches
  section replace the "Show Agents" toggle with a Buyers / Agents / All
  audience filter, so a co-broker blast is: Agents → Select All → send.
  Switching audience drops selections outside it, so a send never
  carries hidden picks from the previous tab.

### Added

- **Plot size is now a matching facet** (**migration required**:
  `275_pref_land_area.sql`). "Looking for lesser dimensions" used to
  have nowhere to land: size wasn't a preference the engine knew, so
  the feedback changed nothing. Preference extraction now captures
  stated sizes in canonical square feet ("30x40 site" → 1,200; "up to
  half an acre" → 21,780), the matcher enforces the band the way it
  enforces budget (±10% grades a near-miss; further out excludes), and
  relative feedback with no figure — smaller/bigger, "too big", "lesser
  dimensions" — is anchored to the listing the thread is pinned to, at
  a ratio chosen so the rejected listing itself can never crawl back in
  as a near-miss. The learned bound rides the audit registry like every
  other preference, and the requirement playback card shows it ("up to
  3,570 sq.ft"), one tap from correction.

### Added

- **The /list page takes the deck** (**migration required**:
  `276_listing_submission_documents.sql`). Commercial landlords do not
  paste text — they send the brochure. Suraj Group's first contact was
  two PDF decks over WhatsApp, and the seller funnel had nowhere to put
  them: the draft came back with every field Missing. The List-your-
  property page now accepts one PDF brochure per property alongside
  photos, and "PFA our deck" is a complete submission — the text floor
  only applies when no deck is attached. On WhatsApp verification the
  deck itself is parsed (Gemini reads the document directly, the same
  path the owner chatbot has always used for PDFs), its embedded photos
  become the listing gallery, floor-wise rent rolls land in
  floor_tenancies, and the brochure stays attached to the property.

### Fixed

- **A shared map pin reaches the listing again.** An agent forwarded a
  property's Google Maps pin into an open listing draft and got back "I
  couldn't find *https://maps.app.goo.gl/…* in your inventory" — twice —
  while the listing was saved with no coordinates at all. A "which
  property is this about?" question from hours earlier was still
  standing, and the pin's URL is 48 characters of mostly letters, so the
  property-answer reader took it for a listing NAME and swallowed the
  message before it could reach the draft. Two gates now: a link is
  never a listing name (a link that carries the code — "open the listing
  and share it here" — still answers), and the reader yields entirely
  while a listing draft is open, because a draft is the nearer context
  and every short correction typed into one was at risk the same way.
  The question keeps standing for after the draft closes.

- **No button label can be read as free text anywhere in the owner
  chatbot.** An audit after the "Today itself" misfire found the same
  hole across the whole interpretive corridor: a tap's label text could
  reach the quote-correction reader, the appointment-outcome reader (a
  bare "Cancel" or "Done" label satisfies its regex outright — with an
  appointment card standing in the thread, that tap would have
  cancelled or completed it), the message-replay path (a tap quotes its
  own card by construction), and the calendar scheduling intercept.
  Button-id dispatch now runs before every free-text reader, and each
  reader is gated against interactive replies — pinned by a corridor
  test suite so a new reader cannot ship without the gate. Lead-side
  flows were audited clean: the ladder and Q&A branches only ever run
  on plain text messages.

- **A follow-up reminder button no longer reads as a property name.**
  The "which property?" completion card offers Today itself / In 2 days
  / Can't say yet reminder buttons — and tapping one was answered with
  "I couldn't find _Today itself_ in your inventory": the tap's label
  text reached the new property-answer reader before the button's own
  id dispatcher, and the already-answered question was still standing.
  The reader now never claims an interactive reply (a tap's instruction
  is its id; the text is only the label), and an answered question is
  retired on the spot, so nothing later in its 48-hour window can
  re-trigger it. An unresolved code still leaves it standing for the
  corrected retry.

- **A rental no longer advertises a 1200% yield** (**migration
  required**: `278_clear_rental_listing_yield.sql`). PROP-1205, a J. P.
  Nagar office at ₹15.5 L/month, read "₹15.5 L/mo · 1200% yield" on its
  detail screen. Every writer computed the yield as annual rent over
  `price` — but a Rent or Built to Suit listing stores the _monthly_
  rent in `price`, so the sum divided a year of rent by a month of it,
  and a JV/JD deal has no asking price to divide by at all. Yield now
  comes from one rule (`src/lib/inventory/rental-yield.ts`), applies to
  sales only, and is derived server-side on every write rather than
  taken from the client — so the form, the API, the WhatsApp intake
  parser, the inventory card and the mobile detail screen cannot
  disagree. The ROI box disappears from the property form for listings
  that cannot have one, and the migration clears the figures already
  stored.

- **The bot now hears the answer to its own "which property?"
  question.** A forwarded client reply that names no listing is logged
  against the contact, and the agent is asked which property it belongs
  to. Typing the code back — "Prop-1194" — reached the listing
  classifier instead, which read a bare code as a brand-new listing and
  opened a draft with Title, Price, Location and Type all Missing,
  while the response it was meant to complete stayed unlinked. A short
  message that is nothing but a listing reference, sent while that
  question is standing in the thread, now completes it: the journey
  item, its event, the client's timeline ask and the deal notes all run
  exactly as they would have on the first pass, with the client's own
  words recovered from the note already written. An unresolvable code
  says so instead of guessing. The question's copy also now invites the
  reply the agents were already giving ("Reply with the property name
  or code…, or forward a screenshot showing it").

- **The ladder no longer re-sends a shortlist the lead is already
  looking at.** A buyer answered a one-listing shortlist with "Looking
  for lesser dimensions" — feedback the matcher has no size facet for —
  so re-ranking produced the identical listing and the bot sent the
  same 70x60 plot again as "one that fits", four minutes after she
  asked for something smaller. The reply builder now checks the
  thread's recent bot messages: when every listing it would show
  already went out, it acknowledges the updated brief and asks the next
  open rung (or promises the watch) instead of repeating itself.

- **Merged contacts stayed visible on mobile.** Merging two duplicates
  soft-deletes the loser, and the web contact list has always hidden
  it — the mobile app never learned to, so a merged pair kept showing
  as two rows in Contacts (and inflating the tab counts), and the
  pickers on appointments, deals and shares could attach new work to
  the soft-deleted half. Every mobile contact list, count and picker
  now skips merge losers, and so do the HOT-lead surfaces on both
  platforms (the /today panel and the follow-up radar), where a loser
  that was HOT when it lost would otherwise draw follow-up cards for a
  thread the inbox no longer resolves.

- **The confidential-listing gate had two buttons with the same label,
  and the first one did nothing visible.** "Request full details"
  opened the form; a second button with identical wording inside it
  actually sent the request. A buyer tapped once, told the agent he had
  asked, and waited on a request that was never made. The form is now
  the gate — one tap sends it — and an incomplete form says what is
  missing instead of absorbing the tap.

- **An expired sandbox trial no longer blackholes a sender forever.**
  The shared sandbox number routes by sender: the first `#code` message
  writes a mapping, and every later message from that number resolves
  through it. The mapping never expired — the trial behind it did — so
  once a tenant's trial lapsed, every message routing through one of
  their mappings was dropped with no reply, no message row, and no trace
  on either side. A real number sat in that state for five weeks, still
  messaging, and it took the ingress logs to see it because the CRM held
  no evidence at all. A lapsed trial now releases its dead mapping, so
  the message falls through to whichever Official API account owns the
  number — and so does every message after it, without manual repair.
  The per-tenant message limit is unchanged: a live tenant over their
  cap is still capped.

- **A seller's floor stated as a close is now recognised.** An agent
  typing "This can be closed at 13 cr" about a listing advertised at 15
  scored nothing: the free gate in front of the price learner was
  written from how buyers ask ("is it negotiable?") rather than how
  agents answer, and "closed at" was not in its vocabulary. So the
  figure died in the bubble and the next buyer to ask whether there was
  room got "let me check with the team". The closing and taking family —
  closed/closing at, owner will take, seller is ok with, done at — now
  reaches the extraction, which still proposes rather than writes.
  "We can do 13" is deliberately excluded: an agent booking a site visit
  at 4 says the same words, and this gate runs on every outbound
  message.

- **The chatbot simulator no longer contradicts production.** It ran the
  qualification ladder directly, so it never knew about the messages the
  ladder now stands down for: typing "can I get photos" into it showed
  "What kind of property are you looking for?" — the exact reply the
  photo handling exists to prevent, demonstrated by the tool an agent
  would use to check the behaviour. Callback requests and listings named
  by number were mispreviewed the same way. The routing decision now
  lives in one place both the live handler and the simulator reach, and
  the simulator previews what each route actually sends.

- **A portal's "your listing is live" email can no longer become a
  lead.** The portals confirm every posting, review, go-live and refresh
  by email to the same mailbox as the leads, and none of those subjects
  matched a non-lead filter pattern — so they fell through to the lead
  parser, and Housing's publish confirmation quotes the agent's own
  registered phone number, ready to be filed as a buyer enquiry. The
  lifecycle subjects are now filtered, with the real emails preserved as
  redacted fixtures (`src/app/api/leads/email-webhook/__fixtures__/`)
  and a fixture-driven test so a re-worded portal template surfaces as a
  test failure. The samples also settle the identity question for the
  future sync consumer: 99acres names a `C`-prefixed code in prose,
  MagicBricks quotes its id only when posting (its refresh email carries
  dates but no id), and Housing lifecycle mail never quotes an id at
  all.

- **A sold listing stops generating outbound messages.** The owner
  digest, the agent reach digest and the deal-mode sweep all scanned
  `properties` with no filter on status. A listing that leaves the
  market keeps every row that references it — enquiries, deals, shares,
  showcase views — so a property marked Sold went on producing digests,
  and asked its former owner over WhatsApp whether they would like
  status updates about buyer interest in it. All three senders now skip
  listings that are Sold, Off Market, Archived or Rejected; Available
  and Under Contract still report, since a listing under offer is one an
  owner still wants to hear about. Reactive paths are unchanged — a sold
  property's owner can still request its documents, and the
  already-sold notification to interested buyers still goes out.

- **A short name no longer matches inside a longer one.** Name
  resolution scored a plain substring hit, so "Raj" matched
  "Kusumaraju" — an advocate's meeting was filed under an unrelated
  contact, and because the liaisons directory is only searched when no
  contact matched, the false hit also hid the advocate who should have
  been found. A fragment now has to begin a word and be at least three
  characters. Real partials still match: "Kumar" finds "Raj Kumar", and
  a property code still opens its label.

### Changed

- **A forwarded contact card goes to the contact flow, always.** WhatsApp
  tells us structurally that a message is a vCard, and the assistant was
  ignoring that and asking an AI to classify the flattened text instead —
  where a phonebook name like "Nadeem Koramangala 8th Block 2100 Sqft
  Corner" carries enough listing words to beat the person under the
  classifier's own precedence rule. A card now routes on its type: no
  classifier call, no listing draft, and the person lands in the
  purpose-built contact flow with duplicate warnings, enrichment of
  somebody already on file, and a Confirm step. The draft is built from
  the card itself rather than read by a model — name, tag and number are
  stated on it, and the role too when the phonebook name says "Owner" or
  "Broker" — so a card costs no AI credits at all, where it used to cost
  a classify plus a parse. A card arriving mid-listing sets the listing
  draft aside instead of being typed over it; a second card is
  reconciled against the draft in flight the way a second screenshot is.

### Added

- **A voice note can ask for more than one thing.** The scheduling
  parser used to be told to extract ONE request and returned one draft,
  so a note that said "send Sharan the update on the Kusumaraju meeting,
  the advocate is away a week so follow up after that" produced the
  follow-up task and silently dropped the update. It now returns every
  request it found and the WhatsApp assistant files each one, reporting
  them in a single confirmation card. A message carrying one request is
  answered exactly as it was before.

- **Telling a teammate something is now a thing you can ask for.**
  Alongside `schedule` and `task` there is a `notify` intent: "send
  Sharan the update on the site visit", "let Priya know it's off". It
  writes no calendar row — the update goes to that teammate's bell, their
  phone and their own WhatsApp at once, under the account's saved
  notification preferences. Assigning work and passing on news were
  previously the same field, `assignee_name`, which meant the only way to
  tell a colleague anything was to give them a job. A name that is not on
  the team is reported back rather than guessed at. The new
  **Teammate sends you an update** toggle is in Settings → Notifications
  on web and mobile.

- **Saying the same thing twice corrects it instead of duplicating it.**
  An agent dictates a note walking out of a meeting and again from the
  car, or repeats a job the next morning because they cannot remember
  whether it went in. Each pass used to insert another row. A request
  that restates an event or a to-do already on the books now updates it
  and says _Updated_ rather than _Added_. The rule is deliberately
  narrow, because merging two things that were never the same one loses
  a real appointment: the same IST day, wording that clears a two-thirds
  subject match, and no disagreement about who it is with. Two site
  visits with one buyer in a week stay two rows, an identically-titled
  visit with a different buyer stays its own, and another agent's
  matching task is never touched. A reschedule is unaffected — that is a
  quote-reply on the card, which names its target outright.

- **A forwarded contact card keeps its own name, and its person.** An
  agent's phonebook entry is rarely just a name — "Nadeem Koramangala
  8th Block 2100 Sqft Corner Property Owner Nassur" is a person, a
  property and a second name in one string. Forwarded as a card it
  becomes a listing draft, correctly, but the owner on that draft used
  to be whichever word the model picked out of the label: it chose
  "Nassur" and dropped the name the card leads with. The card states the
  name outright, so it is now read from the card rather than inferred,
  and split into name and Name Tag by the same deterministic rule the
  contact intake already uses — no AI call, and the listing fields are
  left exactly as parsed. The person is also filed as a contact the
  moment the card arrives, marked for review, instead of only when the
  listing draft is confirmed: a draft can sit unconfirmed for an hour,
  and cancelling it used to take the person with it. Somebody already on
  file is never renamed by a phonebook label.

- **Voice notes, understood and acted on.** A voice note sent to the
  WhatsApp assistant is now transcribed once and read as text by every
  path that already existed — so speaking a listing files a listing,
  speaking a contact files a contact, speaking _today_ returns your
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
  than leaving it unpinned. A pin sent _during_ an open draft already
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
  settings _editor_ is web-only for now — the message itself is at full
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

- **A confidential listing's own share link could not open it.** Share
  links name a listing by its property code, and the teaser reduction
  strips `property_code` — so the catalog had nothing to match the code
  against, the detail modal never opened, and the recipient of a link
  sent for that listing landed on the general grid with no route to
  "Request full details". The server now resolves the code to the row's
  id before handing it to the catalog, which fixes links already sent.

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
  _budget from_ bound admits contacts marked as having no budget
  constraint, a _budget up to_ bound does not, and the budget ladder
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
  as a _contact draft_ instead of an appointment: the scheduling gate
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
  bold instead of WhatsApp's. Send _help_ (or hi / menu / start) and
  you now get the real capability guide with worked examples: add a
  listing from text, an ad screenshot or a brochure PDF; add a contact
  or portal lead; the _today_ agenda, event and to-do commands and
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
  (1) tapping a button on an _earlier_ message (e.g. "List My
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
