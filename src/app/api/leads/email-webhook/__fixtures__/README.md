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

Listing-lifecycle emails — **the gap**, and the reason for this folder.
These arrive today and `checkIsNonLeadEmail()` (`route.ts:167`) discards
them as "not a lead", which is right for lead ingestion and is exactly
what a portal-sync consumer needs:

| | 99acres | MagicBricks | Housing |
|---|---|---|---|
| listing posted / went live | | | |
| listing edited (price, area, description) | | | |
| listing expiring soon | | | |
| listing expired / taken down | | | |
| listing rejected or needs attention | | | |
| paid boost applied or lapsed | | | |
| weekly performance digest | | | |

The lifecycle table is the one worth filling first. Each row is a signal
that could keep `property_portal_listings` current without any portal
API — see Milestone 4 in `FEATURE_ROADMAP.md`.

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
