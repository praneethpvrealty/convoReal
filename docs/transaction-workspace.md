# Transaction Workspace

The closing record for a deal. Once a buyer is commercially active, the
agent converts their Journey into a transaction and runs the close from
one place: overview and internal financials, an immutable timeline, a
milestone checklist, tasks, the private document folder with a
lifecycle, and invoices. Web and mobile are two surfaces of the same
feature (root `AGENTS.md` §2.8).

This document records the decisions Phase 1 was built on. It is the
reference for Help, for Copilot (the `deals.*` chunks in
`src/lib/copilot/chunks.ts` are written from it), and for whoever picks
up the next phase.

## Decisions

| Decision                                                                 | Why                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product name: Transaction Workspace.** Code identifiers stay `deal_*`. | `deal_rooms` (migration 136) is already the Owners Den bid room, so "Deal Room" was taken twice over. The house precedent is Portfolio/`den_*`: brand the surface, leave the identifiers.                                                                                                                                                                  |
| **Journey is pre-commercial; Deal is the closing record.**               | Journey tracks the contact × property matrix while a buyer is still considering. A deal is one property, one buyer, one close. Neither replaces the other.                                                                                                                                                                                                 |
| **`deals.source_journey_item_id` preserves provenance.**                 | Conversion is idempotent per journey item (unique partial index). The journey keeps its own history; the deal points back.                                                                                                                                                                                                                                 |
| **`deals.deal_group_id`; no parent/child deals.**                        | Adithi buying Sites #19 and #20 is two deals with two sellers. A `deal_groups` row bundles them for combined progress. Each keeps its own milestones, documents and terms.                                                                                                                                                                                 |
| **Stage changes are completely separate from milestone completion.**     | `pipeline_stages` says where the card sits; `deal_milestones` says what has been done. Completing a milestone never moves the card; moving the card never ticks a milestone. Stage moves already carry side effects (`sync_deal_brokerage_paid_at`, property status sync) and milestones must not be wired into that path. Pinned by `milestones.test.ts`. |
| **Financials are internal-only and deny-listed.**                        | `INTERNAL_ONLY_DEAL_FIELDS` in `src/lib/deals/financials.ts` never leaves the account: not through `/api/v1`, not a public route, not a stakeholder link. `financials.test.ts` scans those sources. Agreed and registered consideration are recorded, never computed, never compared.                                                                      |
| **Token money has one source of truth.**                                 | A deal that closes a Den room (`deal_room_id` set) derives its token from `token_escrows` and refuses the `token_*` columns (409). Any other deal records token/advance directly.                                                                                                                                                                          |
| **`deal_events` is immutable in the database.**                          | SELECT/INSERT grants only, an INSERT policy that pins `actor_id` to the caller, and a trigger that refuses UPDATE and DELETE from every role — including `service_role` — except the cascade from a deleted deal. `journey_events` shipped with a `FOR ALL` policy and is the mistake this avoids.                                                         |
| **Document lifecycle: forward only; supersede, never delete.**           | `draft → reviewed → approved → executed`. Approved and executed papers are superseded by a newer upload and kept, marked. Unlabelled (`NULL`) means filed before the lifecycle existed. Expiry is a date the workspace surfaces; it does not act on it.                                                                                                    |
| **Bundle isolation is tested now, wired later.**                         | `src/lib/deals/visibility.ts` is the one resolver every external representation must pass through. Phase 1 has no external surface; the cross-seller test exists so Phase 2 can only read through it.                                                                                                                                                      |
| **Sensitive-link OTP is reserved for a per-token challenge.**            | Den and buyer verification create `auth.users` rows — exactly the persona cost Phase 2 avoids. A stakeholder link that needs OTP gets a lightweight challenge bound to the token, never a Supabase Auth user.                                                                                                                                              |

## What Phase 1 ships

- **Conversion** — `POST /api/journey/convert-to-deal`. Picks the account's
  first pipeline (seeding the default board service-side, pinned to the
  caller's account, if none exists — creating a board is an admin write
  under RLS and an agent's first conversion must not be blocked on it),
  lands a closing-stage journey on the board's negotiation/token stage
  and any other on the first _active_ stage (terminal stages are
  skipped whatever the board order), creates
  the deal with the property price as value, instantiates the standard
  milestones, writes `converted_from_journey` on the deal timeline and
  `converted_to_deal` on the journey (best-effort until the second
  migration is applied), and syncs the property status as the pipeline
  would. Web: the journey item sheet. Mobile: the briefcase on a journey
  branch row.
- **Index and detail** — `/deals` lists every transaction with milestone
  progress from `transaction_workspace_index()` (SQL aggregate, no
  client-side reduce). Rows are headed by buyer and property
  (`src/lib/deals/index-row.ts`, mirrored on mobile); the deal's own
  title drops to a second line unless it already is that headline. `/deals/[id]` carries six tabs: Overview,
  Timeline, Milestones, Tasks, Documents, Invoices. Same tabs on mobile.
  Records lists closing records only: `ensureClosingRecord()` in
  `src/lib/deals/closing-record.ts` seeds the standard milestones the
  first time a deal enters a capture stage (`startsClosingRecord`,
  Negotiation/Token or later, never Closed Lost), and every stage move,
  from the board, the header picker or mobile, goes through the deal
  route so the rule cannot be bypassed.
  The stage chip in the header is a stage picker for editors; it goes
  through `PATCH /api/deals/[id]`, the same call the board makes, so
  the deal status and the property status follow the stage identically.
  Like the board, it pauses for brokerage before a capture stage
  (`needsBrokerageCapture`), and the route computes the amount from the
  deal value so no surface stores a figure of its own.
- **Financials** — `GET/PATCH /api/deals/[id]/financials`. Record-keeping
  only; no ledgering, reconciliation, tax computation or reports.
- **Timeline** — `GET /api/deals/[id]/events`; `POST` writes an internal
  note. Every other event is recorded by the route that did the work.
  Stage moves are recorded by a database trigger so kanban drags that
  never touch an API route still appear.
- **Milestones** — `GET/POST /api/deals/[id]/milestones`,
  `PATCH/DELETE /api/deals/[id]/milestones/[milestoneId]`. Standard
  checklist from `DEAL_MILESTONE_TEMPLATES`; custom milestones per deal.
  A standard milestone is skipped, not deleted.
- **Tasks** — `todos.deal_id`. The existing `/api/todos` routes accept
  and filter by `deal_id`; the tasks also appear in Calendar and Today.
- **Documents** — `PATCH /api/deals/[id]/documents/[docId]` for status,
  expiry and supersession. `DELETE` refuses approved and executed papers
  (409 `DOCUMENT_LOCKED`).
- **Bundles** — `POST /api/deal-groups`, `GET /api/deal-groups/[id]`.

## Migrations

| File                                                    | Applied                   | Contents                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260918010000_transaction_workspace.sql`              | at push (purely additive) | `deal_groups`, `deal_events`, `deal_milestones`; new nullable columns on `deals`, `todos`, `deal_documents`; `transaction_workspace_index()`.               |
| `20260918010100_transaction_workspace_stage_events.sql` | after merge               | Trigger on `deals` recording `stage_changed`; `journey_events` CHECK widened with `converted_to_deal`. Changes production behaviour, so it waits for green. |

## Phase 2 — controlled collaboration

The people outside the brokerage see their side of the deal without
ever getting a login.

| Decision                                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A stakeholder is a name, a role and a side.** `deal_stakeholders` holds buyer, seller, advocate, banker, broker, witness or other, on the buyer, seller or internal side, optionally linked to a contact.                                                                                                                                                                                       | Roles describe the person; the side decides what they see. An advocate can act for either side, so the form asks. Internal-side people use the workspace itself and never get a link.                                                                                                                                         |
| **Links are per stakeholder, hashed, capped, revocable and logged.** `deal_share_links` stores only the SHA-256 of the token (as `account_invitations` does), expiry is 24 hours, 7 or 30 days and never more, revocation is a timestamp so the access log survives, and every open, code send, code check and document fetch is a row in `deal_share_access_log` with the client address hashed. | A database read never yields a usable URL; a lost phone is bounded by the expiry; the agent can see exactly who opened what.                                                                                                                                                                                                  |
| **One resolver, one payload builder.** `src/lib/deals/external-view.ts` is the only code that builds an external representation, and it does so through `src/lib/deals/visibility.ts`. `external-view.test.ts` scans every route under `src/app/api/public/deal-share` and fails if one names a financial column, builds its own payload, or touches Supabase Auth.                               | Phase 1 wrote the cross-seller bundle test before any external surface existed; Phase 2 is the first consumer, and the test now guards a real door.                                                                                                                                                                           |
| **Visibility lives on the row.** `deal_events`, `deal_milestones` and `deal_documents` each carry `visibility` (internal, buyer side, seller side, all stakeholders), default internal. An event's visibility is fixed at insert because the table is immutable; a note's is chosen when it is written.                                                                                           | Nothing filed before Phase 2 leaks by default, and "who can see this" is answered on the thing itself, not in a side table. "Selected people" is not modelled; a link's side is the unit.                                                                                                                                     |
| **Bundles: the same person sees their siblings.** On a bundled deal the view includes sibling deals only where a stakeholder on that sibling is the same person (same contact, else same phone, else same email) on the same side.                                                                                                                                                                | Adithi on Sites #19 and #20 sees both; each seller sees one. The party id on a sibling is the matching stakeholder row there, never the primary deal's.                                                                                                                                                                       |
| **OTP is a per-token challenge, never an account.** A sensitive link sets `otp_required`. The public route emails a six-digit code (Resend), stores only an HMAC of it bound to the link, allows five attempts in ten minutes, and on success returns a signed unlock for that link that lives thirty minutes in the stakeholder's browser session.                                               | Den and buyer verification create `auth.users` rows — the persona cost Phase 2 exists to avoid. The unlock is the whole of the stakeholder's identity and dies with the link. WhatsApp OTP delivery waits for Phase 3's template work; a stakeholder with no email cannot be given a code-protected link, and the UI says so. |
| **Documents are re-checked at the byte boundary and photos are watermarked.** The document route re-validates the link, the unlock and the document's visibility with the same rule the view used, then streams a photo through `watermarkImage` with the stakeholder's name burned in.                                                                                                           | The view is a render; the bytes are the asset.                                                                                                                                                                                                                                                                                |
| **PDFs are not stamped.** A PDF is handed over through a sixty-second signed URL, unwatermarked, and the fetch is logged.                                                                                                                                                                                                                                                                         | Nothing in the stack can write into an existing PDF — the invoice renderer builds PDFs from scratch and there is no PDF library in the dependency tree. Adding one is a dependency decision, recorded in `FEATURE_ROADMAP.md`, not something to slip into a feature PR.                                                       |
| **The link is handed over by the agent, never sent by the app.** Web offers Copy and a `wa.me` handoff with a prefilled message; mobile offers Copy and the system share sheet.                                                                                                                                                                                                                   | Sending through the Engine number is Phase 3 and runs into the template-category rules; an agent-initiated message from their own WhatsApp does not.                                                                                                                                                                          |

Surfaces: the Stakeholders tab on web and mobile (add, share link with
expiry and code toggle, copy or hand over, revoke, per-link access
log), visibility pickers on notes, milestones and documents on both,
and the public portal at `/deal/[token]` (a browser-bound surface per
§2.8) with the code gate.

Migrations: `20260918030000_transaction_workspace_stakeholders.sql`
(additive, applied at push) and
`20260918030100_transaction_workspace_share_events.sql` (widens the
`deal_events` CHECK with the stakeholder and link event types; held to
merge, and the routes that write those types treat a refused insert as
best-effort until it lands).

## Phase 3 — publishing updates

An update is what one side of the deal is told, in a fixed format, at a
moment the agent chooses. It is composed from the milestones and
timeline entries that side may already see, previewed per recipient,
and published as a durable snapshot.

| Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A published update is a durable snapshot.** `deal_updates` is insert-only in the database, exactly as `deal_events` is: SELECT/INSERT grants, an INSERT policy pinning `published_by` to the caller, and a trigger refusing UPDATE and DELETE except the cascade from a deleted deal. The headline, message and quoted items are frozen in `snapshot`. A correction is a new update naming `supersedes_update_id`; the original stays, marked.                                                                                          | What a buyer was told on the 18th must read the same on the 30th whatever the checklist looks like by then. A record that can be edited after the fact is not a record.                                                                                                                                                                     |
| **An update never quotes what its audience may not see.** `snapshotItemAllowed` in `src/lib/deals/updates.ts`: every side that will read the update must already be allowed to see the item, so a buyer-side update quotes buyer-side and shared items and an update to both sides quotes only shared ones. The composer offers nothing else; the route refuses anything else. An update itself is never `internal`.                                                                                                                      | The visibility resolver is the boundary. Publishing is not a second door around it.                                                                                                                                                                                                                                                         |
| **Three channels, one text.** `renderUpdateNotice` produces the notice once. The business number sends it free-form inside the recipient's 24-hour window; outside it, only the approved `purchase_progress_notice` template is honest, and only to the buyer whose purchase it is, with the headline as the current step — the private link then follows the moment they tap a reply, which reopens the window. Personal WhatsApp is a `wa.me` handoff the app never sends. "Link only" mints the link and leaves delivery to the agent. | AGENTS.md §2.7: a wrong template is worse than no message, and every template name is spent once. No new template is submitted for Phase 3; the seller side outside its window is told to use the agent's own phone. The tap handler runs ahead of the closing-nudge handler so a buyer's reply to a notice is not filed as a stall answer. |
| **Sent, opened and acknowledged are three facts.** Each is a timestamp on `deal_update_recipients`, never inferred from another: sent is the Engine's send or the agent confirming a handoff, opened is the recipient's link resolving with the update named (`?u=`), acknowledged is their tap on the portal or their reply to the template. `recipientStage` picks the one to lead with; the row keeps all three.                                                                                                                       | A notice that was sent is not one that was read, and one that was read is not one the buyer agreed with. Collapsing them is how a broker ends up certain a client "knew".                                                                                                                                                                   |
| **Per-recipient links, minted at publish.** Every recipient gets a fresh `deal_share_links` row addressed with the update id, so an open is attributable to that person and that update. The plaintext is returned once, in the publish response, for the handoff channels. The template path mints its link at tap time, since the template cannot carry a URL and a link nobody was sent should not exist.                                                                                                                              | Same token rules as Phase 2, TXW-009: hashed at rest, expiring, revocable, logged.                                                                                                                                                                                                                                                          |

Surfaces: the Updates tab on web and mobile (compose, quote milestones
and entries, choose audience and recipients with a channel each, preview
per recipient, publish, hand over pending links, mark them sent, correct
a published update) and the public portal, which shows the updates for
the reader's side newest first with an Acknowledge action per update.

Routes: `GET/POST /api/deals/[id]/updates`,
`POST /api/deals/[id]/updates/preview`,
`PATCH /api/deals/[id]/updates/[updateId]/recipients/[recipientId]`
(`{ status: 'sent' }` for a handoff), and public
`POST /api/public/deal-share/[token]/updates/[updateId]/ack`.

Migrations: `20260918050000_transaction_workspace_updates.sql`
(additive, applied at push) and
`20260918050100_transaction_workspace_update_events.sql` (widens the
`deal_events` CHECK with `update_published` and `update_acknowledged`;
held to merge, best-effort writes until then).

## Phase 4 — bundles on screen and date reminders

Two gaps the first three phases left: `POST /api/deal-groups` existed
with no screen calling it, and a milestone's target date and a deal's
expected close date were stored and shown on the record while nothing
watched them.

| Decision                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The bundle picker lives in the record header.** A deal with no bundle shows Bundle; a bundled deal shows its bundle's name, which opens the members with their combined progress. `src/lib/deals/bundles.ts` (mirrored in `mobile/lib/deal-workspace.ts`) orders the same buyer's deals first, pre-ticks them, proposes the name and holds the route's limits. | The bundle is almost always one buyer's other purchases, so the picker should already be right when it opens. The route stays the only writer; the picker adds nothing it does not already check.                                                                                                       |
| **A deadline is a date the record already carries.** Milestone `target_date` and `deals.expected_close_date`, on a live deal, within a horizon. No new column, no new object.                                                                                                                                                                             | The agent set those dates on purpose. The gap was that nothing read them back.                                                                                                                                                                                                                             |
| **One SQL rule, two functions.** `deal_deadlines_for_account` (service role) and `deal_deadlines` (members, guarded by `is_account_member`), migration `20260924103000`. "Today" is passed in.                                                                                                                                                             | The digest runs as the service role and gets nothing from a guarded function; the screens run as members and must not read the unguarded one. The same split as `journey_stages_for_account`. The database does not know whose calendar it is: the digest's day is IST, the browser's is its own.        |
| **Three readers, no fourth copy.** Focus (`/api/focus`, web tab and mobile screen), the web Today page, and the agent task digest all read the function; `mobile-parity.test.ts` fails if any of them queries `deal_milestones` directly.                                                                                                                 | Three surfaces that compute "due" three ways will disagree on the day it matters.                                                                                                                                                                                                                         |
| **The digest reminds over a shorter window than the screens show.** Screens look 14 days ahead; the digest, which repeats up to three times a day, reminds 3 days ahead and about overdue dates, and only about the deal's assigned agent's deals (or unassigned deals they opened, the rule it already applies to to-dos).                                | A date a fortnight out repeated forty times is a reminder nobody reads. The digest already carries the ledger, the per-agent schedule, quiet hours and the channel preferences; a second reminder path would have to repeat all of it.                                                                     |
| **Nothing acts on a date.** A passed deadline is shown, not moved, completed or escalated.                                                                                                                                                                                                                                                                  | TXW-003: milestones and stages are independent, and a date is not evidence that the work was done.                                                                                                                                                                                                       |

Surfaces: the Bundle chip and sheet on the record header (web and
mobile); the Deal deadlines card on Focus (web and mobile) and section
on Today (web); the Deal deadlines block in the agent task digest.

Migration: `20260924103000_deal_deadlines.sql` (purely additive: two
functions and two partial indexes; applied at push).

## Out of scope after Phase 3

"Selected people" visibility (a link's side is still the unit), PDF
watermarking (a dependency decision), WhatsApp OTP delivery (needs an
AUTHENTICATION-category template that does not exist and would spend a
name), and any new WhatsApp template for seller-side notices.

## One Deals surface

Board (the pipeline Kanban), Journey (the buyer mind map) and Records
(the closing-record index) are three views of the same `deals` rows,
served from `/deals?view=board|journey|records`
(`src/app/(dashboard)/deals/deals-content.tsx`). `/pipelines`,
`/journey` and `/automations?tab=pipelines` are redirect shims that
carry their query across (`src/lib/deals/routes.ts`); Automations keeps
Flows and Analytics only. Mobile mirrors it with Board and Records
segments on the Deals screen and a Journey button in its header.

## One stage vocabulary

`journey_stages.pipeline_stage_id` links every journey stage to a
pipeline stage. `sync_journey_stages_from_pipeline(account, pipeline)`
(`20260919120000_journey_stages_mirror_pipeline.sql`) upserts one
journey stage per stage of the account's default pipeline, creating the
default board when there is none, and both surfaces read stages through
it; `journey_stages_for_account` is the unguarded twin for the service
role. The kind (prospecting, closing, won, lost) comes from the stage
name by the same words as `journeyStageKindForPipelineStage`. Two
triggers keep a converted deal and its journey item on one stage from
either side. Every journey move — the web journey and the mobile
journey through `POST /api/journey/move`, the WhatsApp closing card's
advance button directly — runs `moveJourneyItem`
(`src/lib/journey/move.ts`): when the target mirrors a pipeline stage,
the item's deal follows through `applyDealStageMove`
(`src/lib/deals/stage-move.ts`), the same logic the deal PATCH runs for
the board — brokerage capture (a 409 `BROKERAGE_REQUIRED` pauses the
move for the same prompt on web and mobile; the closing card cannot
prompt, so its record opens unpriced), closing record, property status
— and a move into a closing or won stage opens the deal on that very
stage through `convertJourneyItemToDeal`. What must exist before
either side moves is written first (`prepareDealStageMove`: brokerage
and closing record, both idempotent; or the new deal on the target
stage), then the journey item's own update moves a converted deal
through the trigger in the same statement, the requested journey event
is written once with its actor and reason, and a freshly opened deal is
removed again if the item update fails. The board's deal PATCH follows
the same order, so a deal never moves without its record. A deal on a
pipeline other
than the mirrored one keeps its own stage, in the move function and in
the journey→deal trigger (`…120050`, which also confines the deal→journey
trigger to the deal's own account). The journey's own stage editor is
gone; the Board's pipeline settings are the one editor, and the
journey's "Stages follow the Board" button opens them. A pipeline stage
cannot be deleted while journey items sit on or plan for its mirror
(`…120200`, a BEFORE DELETE guard; the settings dialog checks first); a
mirror with no items goes with its stage, and a stage note keeps its
own name and colour snapshot. Every reader that picks a "next stage"
(`client-response.ts`, `closing-nudges.ts`, `past-enquiry.ts`,
`focus/queries.ts`, mobile `today.ts`) reads mirrored rows only. The
held backfill (`…120100`) aligns converted items to their deals within
the account (one on another board lands on the mirrored stage of the
same kind), re-points the rest by stage kind, skips an account whose
pipeline has no stages, and then removes every legacy stage, so no
unlinked stage is left for a lookup to find.

## Invariants

`FEATURE_MANIFEST.json` → `transaction-workspace` (TXW-001 … TXW-018).
Each names its executable regression cases.
