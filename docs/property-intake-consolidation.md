# Property intake — every way a listing gets in, and the one to point people at

Six things can create a property in ConvoReal. They were built for
different people at different times and nobody had written down which is
which, so this is the audit and the answer.

## The six paths

| #   | Path                    | Who uses it                                           | Entry point                                                                           | What it accepts                                                                   | Where it lands                                                                                                                                              |
| --- | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Public listing page** | Owners and outside agents, no account                 | `/list?ref=<account>` → `POST /api/public/list-property`                              | Free text, up to 15 photos, one PDF brochure, name                                | Stashed with a code → owner sends the code on WhatsApp → `listing-verification.ts` parses it → property in **Pending Review**, `listing_source: web_lister` |
| 2   | **WhatsApp intake**     | Owners and agents already messaging the office number | Inbound message on the business number → `chatbot-engine.ts`                          | Free text, images, PDFs, voice notes, spread across as many messages as they like | Draft session, corrected conversationally, then a property, `listing_source: whatsapp_lister`                                                               |
| 3   | **Dashboard form**      | The brokerage's own team                              | Inventory → Add Property                                                              | 50+ typed fields, uploads, AI description                                         | Property, live immediately                                                                                                                                  |
| 4   | **Portal import**       | The brokerage's own team                              | Chrome extension harvests 99acres / MagicBricks / Housing → `POST /api/portal-import` | Whatever the portal dashboard shows                                               | Staged in `portal_import_items`, matched against existing inventory, committed on review                                                                    |
| 5   | **Shared-link import**  | A partner brokerage on ConvoReal                      | Inventory → Import shared → `POST /api/inventory/import-shared`                       | Another account's share link                                                      | Copy of that listing                                                                                                                                        |
| 6   | **API / MCP**           | Integrations                                          | `/api/v1/properties` with an account API key                                          | Structured JSON                                                                   | Property                                                                                                                                                    |

## The recommendation: path 1 is the one to hand out

For anyone **outside** the brokerage — an owner, a channel partner, an
agent sitting on a brochure — path 1 is the only one that is complete on
its own, and the other outside path (2) is a worse version of it:

- **It takes the deck.** A commercial listing arrives as a PDF, and the
  verification parse reads the deck itself — floor plans, rent rolls,
  photos. WhatsApp intake takes a PDF too, but a lister has to know to
  send it.
- **It costs nothing until a human is verified.** No AI runs until the
  code comes back on WhatsApp, so a bot filling the form burns no
  credits.
- **It proves the phone number** before creating anything, which is what
  makes the owner reachable afterwards.
- **It ends up on the office number anyway.** The verification message
  opens the 24-hour window and creates the shared thread — the same
  place path 2 starts from, reached with less typing.
- **It lands in Pending Review**, so nothing enters live inventory
  unread.

Paths 3–6 are for people who already have an account and are not going
away: they are the team's own tools, not intake surfaces to consolidate.

## What was consolidated

- `src/lib/inventory/listing-intake.ts` is now the one builder for the
  page's URL (`publicListingIntakeUrl`). It carries the account's
  showcase subdomain, so a brokerage's link is on its own domain, and it
  always carries `?ref=` because the page resolves the account from the
  query string rather than the host.
- `GET /api/owners/details-request/settings` returns that link as
  `listing_link`, so the web dialog and the mobile sheet cannot assemble
  different URLs. It is null when the account has no public WhatsApp
  number, since there would be nothing to verify a submission against.
- The **Ask for property details** message (`src/lib/owners/details-request.ts`)
  now offers both routes — the office number _and_ the page — and says
  what the sender gets for answering. `{{listing_link}}` is a placeholder
  an account can move around in its own wording.
- That message is reachable from the contact row menu on both surfaces,
  not only from the contact page.

## Deliberately not consolidated

- **Portal import** stays separate. It is a reconciliation tool, not an
  intake form: its whole job is matching a portal listing back to
  inventory that already exists, and routing it through `/list` would
  create duplicates rather than links.
- **WhatsApp intake** stays. An owner who simply starts typing on the
  business number must not be told to go and fill a form; the funnel
  meets people where they are. It is the fallback, not the front door.
