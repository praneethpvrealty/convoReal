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
