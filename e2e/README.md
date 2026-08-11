# Browser harness

Drives the real app in Chromium against a throwaway account, so a UI
change can be checked by looking at it rather than by reasoning about
the component.

Deliberately not wired into CI: it needs live Supabase credentials and a
running dev server, and its job is to answer "does this screen actually
do the thing" during development, not to gate merges.

## One-time setup

```bash
npx tsx --env-file=.env.local e2e/provision.ts   # mints a beta invite, creates the account, seeds listings
```

Reads Supabase credentials from `.env.local`, so pass `--env-file` unless
they are already exported. Writes `.env.e2e.local` (gitignored) with the
credentials it generates. Re-running it deletes the previous test user and
starts clean — a lost password is recovered by re-running, not by hunting
for the old one.

The account it creates has a pre-confirmed phone and the setup wizard
dismissed. Both are load-bearing: without them every screen redirects to
`/verify-phone` or renders behind the onboarding modal.

## Running

```bash
npm run dev &                # the harness expects http://localhost:3000
npx tsx e2e/drive.ts         # logs in, walks the screens, writes screenshots to e2e/shots/
```

Chromium is launched with `--no-proxy-server`: it otherwise inherits
`HTTPS_PROXY` and fails Supabase with `ERR_CONNECTION_RESET`. Direct egress
is transparently TLS-intercepted by a CA Chromium does not carry, which is
what `ignoreHTTPSErrors` covers.

A run that ends in `ERR_ABORTED` lines is normal — those are in-flight
requests cancelled by the next `page.goto`, not failures.

The walk covers the eight sections that own a screen, then the eight paths
that do not: `/radar`, `/today`, `/pulse`, `/agents`, `/requirements`,
`/pipelines`, `/flows` and `/ads` each replace themselves with a tab of
another section. Those are checked against the URL they land on, so a shim
that quietly stops redirecting fails rather than screenshotting a page that
looks fine.

Every screen is checked for a non-blank `<main>` and for a top bar naming
the right section — the two failures a screenshot harness otherwise records
without noticing.

## Multi-language suites

Three assertion suites alongside the screenshot walk above, for the parts
of the language work whose failure modes only show in a browser: what the
chrome renders, what the tab counts claim, and what the submit route
refuses. They assert rather than photograph, so they exit non-zero.

```bash
npm run dev                       # in one shell
npm run test:e2e                  # in another
```

| File | Covers |
|------|--------|
| `language-switcher.mjs` | All seven languages, the two-language cap, the header toggle, persistence to `profiles` and across a reload. |
| `template-languages.mjs` | Per-language template tabs and their `n/7` counts; the language-usage card and its API. Read-only. |
| `translation-review-gate.mjs` | Draft → review → submit, both refusals, and that rewording withdraws a sign-off. Creates rows, deletes them in `finally`. |

Unlike `drive.ts` these read `E2E_EMAIL` / `E2E_PASSWORD` from `.env.local`
rather than `.env.e2e.local`, so they can be pointed at any account. The
agent needs `org_manager` for the two template suites.

`WHATSAPP_TEMPLATES_DRY_RUN=true` is **required**: the gate suite submits
one reviewed template, and without it that reaches Meta for real — which
reserves the template name for four weeks (AGENTS.md §2.7).

Expected analytics numbers are recomputed from base tables in
`support/db.mjs` rather than hardcoded, so the suites track a live account
and still fail when the SQL aggregate drifts from the data it summarises.
That is what caught the `template_language_coverage` phantom-row count
fixed in migration 250.

Point these at a throwaway account (`provision.ts`) where you can. Run
against a live one they will still clean up after themselves, but the
review-gate suite writes and deletes `message_templates` rows, and a
concurrent user drafting a translation at the same moment would have it
deleted by the cleanup.
