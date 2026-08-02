# Contributing to ConvoReal

ConvoReal is a self-hostable WhatsApp deal engine for real-estate
brokerages. This file covers how to get it running locally, what a change
needs before it's reviewable, and where the rules live.

Read [`AGENTS.md`](./AGENTS.md) first if you're touching code — it is the
source of truth for architecture, conventions, and the non-negotiable
security and multi-tenancy rules. This file only covers process.

## Run it locally

```bash
git clone https://github.com/praneethpvrealty/convoReal.git
cd convoReal

cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Full setup (Supabase migrations, WhatsApp Business API, deploy) lives in
[`docs/`](./docs/README.md). The mobile app has its own dependency tree and
its own [`mobile/AGENTS.md`](./mobile/AGENTS.md) — read that before touching
anything under `mobile/`.

## Reporting bugs

File a
[bug report](https://github.com/praneethpvrealty/convoReal/issues/new?template=bug_report.yml).
Including the commit SHA, the runtime (Vercel / self-hosted / local), and
logs will get to a fix fastest.

## Reporting security issues

**Do not file security issues publicly.** Follow the private flow in
[SECURITY.md](./.github/SECURITY.md).

## Pull requests

- Branch off the latest `main` (don't push to a merged branch — commits
  end up orphaned).
- Run `npm run typecheck`, `npm run lint`, and `npm test` locally first.
- Fill in the PR template, especially the **Test plan**.
- One logical change per PR.
- Commit-message first line is imperative + terse; the body explains
  the *why*, the diff shows the *what*.

Changes that need extra care in review:

- **Anything touching `handle_new_user()`, RLS policies, or `account_id`
  scoping.** Tenant isolation is the security model; a mistake there is not
  a bug, it's a breach.
- **New tables.** They need `account_id`, RLS, the `set_updated_at` trigger,
  and policies via `is_account_member()`. See `AGENTS.md` §2.6 and §7.2.
- **New dependencies.** The stack table in `AGENTS.md` §2.3 is deliberately
  closed. Extend an existing pattern before adding a library.

## Dev-loop reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Turbopack dev server on port 3000. |
| `npm run build` | Production build. Next also runs its own typecheck here. |
| `npm run typecheck` | `tsc --noEmit`. Fast TS-only pass. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest unit tests. No network, dummy secrets. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier in check-only mode. |

CI (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test`, and
`build` for the web app, plus `lint`, `typecheck`, `test` for `mobile/`.
Run the same commands locally before pushing.

## Licensing

ConvoReal is MIT ([`LICENSE`](./LICENSE)). Contributions are assumed to be
MIT too.

If you self-host and put a deployment in front of users, rebrand it — swap
the name, favicon, and URLs for your own. Keep the `LICENSE` file: that's
how the MIT permissions travel with the code, and the copyright notices in
it must stay intact.
