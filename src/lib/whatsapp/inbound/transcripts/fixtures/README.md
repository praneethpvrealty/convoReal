# Transcript fixtures

One JSON file per real bot thread worth remembering, as the lead read it.

- `transcript` — the bubbles in order (`sender`, `kind`, `text`, optional
  `templateName` and `at`), copied from the inbox with names changed and
  phone numbers and emails left out.
- `context.contactCreatedAt` — when the lead was created; the rules read a
  lead younger than a week as answering their own enquiry.
- `expectedViolations` — the rule ids `checkTranscript` must report for this
  thread, exactly. A thread that was wrong when it happened keeps its
  violations on record; a thread that was fixed, or was always right, has
  `[]`.

`transcript-fixtures.test.ts` runs every file here through the rules in
`../transcript-rules.ts`. Add a file when a thread is thumbed down in
Admin → Bot replies ("Copy as fixture"), with the violations the rules find;
the replay harness (`../portal-lead.transcript.test.ts`) is where the fixed
behaviour is then proven.
