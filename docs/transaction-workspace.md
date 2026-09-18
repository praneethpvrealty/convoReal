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
up Phase 2.

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
  client-side reduce). `/deals/[id]` carries six tabs: Overview,
  Timeline, Milestones, Tasks, Documents, Invoices. Same tabs on mobile.
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

## Out of scope for this phase

Stakeholder links, per-recipient visibility, WhatsApp update delivery
and publish-as-snapshot are Phase 2 and 3. The Copilot chunk
`deals.limit-stakeholder-links` says so to the user.

## Invariants

`FEATURE_MANIFEST.json` → `transaction-workspace` (TXW-001 … TXW-008).
Each names its executable regression cases.
