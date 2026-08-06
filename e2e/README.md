# Browser harness

Drives the real app in Chromium against a throwaway account, so a UI
change can be checked by looking at it rather than by reasoning about
the component.

Deliberately not wired into CI: it needs live Supabase credentials and a
running dev server, and its job is to answer "does this screen actually
do the thing" during development, not to gate merges.

## One-time setup

```bash
npx tsx e2e/provision.ts     # mints a beta invite, creates the account, seeds listings
```

Writes `.env.e2e.local` (gitignored) with the credentials. Re-running it
deletes the previous test user and starts clean.

## Running

```bash
npm run dev &                # the harness expects http://localhost:3000
npx tsx e2e/drive.ts         # logs in, walks the screens, writes screenshots to e2e/shots/
```
