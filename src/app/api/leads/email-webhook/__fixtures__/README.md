# Portal email samples

Real mail from the portals, kept so the parsers can be built and tested
against shapes we have actually received rather than shapes we imagined.
Every parser bug found so far came from a real email disagreeing with an
assumption:

- 99acres labels nothing — its ad id sits in bare parentheses mid-prose,
  so the labelled-id patterns never fired and **every** 99acres lead
  arrived unmappable.
- Housing's listing URLs carry a slug, while its lead emails quote a
  numeric Property ID. Reading the slug as the ad id produced a mapping
  that silently matched nothing.
- No portal writes the bare property type straight after "N BHK", so the
  bedroom count was dropped on exactly the house and villa enquiries
  where it sharpens a match.

None of those were findable without the real text.

## Redact before adding a sample — this repository is public

A portal email contains a real person's name, phone number and email
address. Replace them; keep everything else byte-for-byte, because the
punctuation and the wrapping are what the parsers actually read.

- names → `Test Buyer`, `Test Owner`
- phone numbers → keep the shape, change the digits: `+91-9000000000`,
  `9000000000`. The parser cares about the format, never the value.
- email addresses → `buyer@example.com`
- **do not** redact ad ids, prices, areas, localities, project names,
  subjects, senders or dates — those are the payload under test.

If a sample cannot be usefully redacted, describe it in an issue instead
of committing it.

## What to capture

One file per case, named `<portal>-<case>.txt`, holding the subject on
the first line, a blank line, then the body as plain text (or the raw
MIME if that is what arrived — `parseMimeEmail()` handles both). Add the
`From:` line if it is not obvious.

Lead emails — the enquiry path, already partly covered:

| | 99acres | MagicBricks | Housing |
|---|---|---|---|
| enquiry, buyer named | | ✅ `route.test.ts` | |
| enquiry, name masked by the portal | | | ✅ `route.test.ts` |
| enquiry quoting an ad id | ✅ | ✅ | ✅ |
| enquiry with no ad id at all | | | |
| enquiry on a *project*, not a listing | | | |
| owner/broker enquiry rather than a buyer | | | |
| enquiry forwarded by the agent, not direct | | | |

Listing-lifecycle emails — the reason for this folder. These arrive
today and `checkIsNonLeadEmail()` discards them as "not a lead", which
is right for lead ingestion and is exactly what a portal-sync consumer
needs. (Until Aug 2026 they were **not** discarded — no filter pattern
matched them, so they fell through to the lead parser, and Housing's
publish confirmation quotes the agent's own registered phone number,
ready to be filed as a buyer. The lifecycle patterns in
`checkIsNonLeadEmail()` and the fixture-driven test in `route.test.ts`
are what now stop that.)

| | 99acres | MagicBricks | Housing |
|---|---|---|---|
| listing posted / went live | ✅ `99acres-posted-live.txt` | ✅ `magicbricks-posted-screening.txt` | ✅ `housing-publish-received.txt`, `housing-live.txt` |
| listing edited (price, area, description) | | | |
| listing expiring soon | | | |
| listing expired / taken down | | | |
| listing rejected or needs attention | | | |
| paid boost / refresh applied | | ✅ `magicbricks-refreshed.txt` | |
| weekly performance digest | | | |

What the collected samples establish about identity — the thing a sync
consumer has to resolve before it can update anything:

- **99acres names its code in prose**, `C93313942` — with a `C` prefix
  that lead emails' bare numeric ids do not carry. Whether the buyer-side
  id is the same number without the prefix is unconfirmed; do not assume
  it when building the consumer.
- **MagicBricks quotes the id only when posting** (subject *and* body).
  Its refresh confirmation carries **no id at all** — just the snapshot
  (type, area, price, locality) plus `Refreshed Date` / `Expiring On`.
  Resolving a refresh to a `property_portal_listings` row means matching
  the snapshot, exactly the job `listing-matcher.ts` already does.
  The refresh email is also the only source of a **fresh `expires_on`**
  (13 Aug → 13 Oct: 60 days), which the drift checks (migration 267)
  otherwise see go stale.
- **Housing lifecycle mail never quotes an id** — not when the publish
  request is received, not when the listing goes live. Only the snapshot
  and the `Manage Listing` link (whose URL carries the slug, per the
  lead-email note above). Same resolution problem as the MagicBricks
  refresh.

These lifecycle samples were transcribed from the agent's mailbox
(screenshots/screen recording), redacted per the rules above. Structure
and wording are verbatim; whitespace is approximate. Before a parser is
built against one, replace it with the raw text via Gmail's
"Show original" so the wrapping is real — the lead samples already in
`route.test.ts` went through that upgrade.

Each filled row is a signal that could keep `property_portal_listings`
current without any portal API — see Milestone 4 in
`FEATURE_ROADMAP.md`.

## Using them

Fixtures are plain text, so a test reads one and asserts on the parse:

```ts
const raw = readFileSync(join(__dirname, '__fixtures__/99acres-expired.txt'), 'utf8');
const [subject, ...rest] = raw.split('\n');
expect(parsePortalLead(subject, rest.join('\n'), '', from)).toMatchObject({ ... });
```

Keep the assertions about *what was extracted*, not about the file's
bytes — a portal re-wording its template should fail a parse assertion,
not a snapshot diff.
