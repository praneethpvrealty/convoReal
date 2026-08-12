# Relicensing plan: MIT → proprietary

**Status: draft. Nothing here is in force.** The licence governing ConvoReal
today is [MIT](../LICENSE). The proposed replacement is
[`LICENSE.proposed`](../LICENSE.proposed).

**This is not legal advice.** It is an engineering plan for a legal decision.
Have a solicitor read the licence and this plan before acting on either — the
consent question in §2 in particular.

---

## 1. The goal

Stop third parties forking, hosting or rebranding the codebase. Keep selling
ConvoReal as a hosted service.

`LICENSE.proposed` is an all-rights-reserved proprietary licence. It is
deliberately stricter than a source-available licence such as BUSL-1.1 or the
Elastic License, which permit reading and self-hosting for non-competing use and
would not meet the goal as stated.

---

## 2. Blockers — read before touching `LICENSE`

### 2.1 ConvoReal is a downstream fork of somebody else's MIT project

This is the constraint that decides the whole question, so read it first.

`LICENSE` names **Arnas Donauskas** and **Praneeth Kumar S**. That second name is
not a co-worker — it is the author of the upstream project this codebase was
forked from. The repository still records the relationship:

- `docs/crm-to-engine-rename-audit.md` refers to
  `github.com/ArnasDon/wacrm/pull/…` as "upstream fork PRs and issues", and to
  `AGENTS.md` having said "originally forked from the `wacrm` template".
- `docs/rename-external-checklist.md` carries the same lineage.

What follows from that:

- **You cannot relicense the upstream code.** Only its copyright holder can.
  Praneeth Kumar S can license *his own* contributions however he likes; he
  cannot put Arnas Donauskas's code under a proprietary licence.
- **The MIT notice has to stay.** MIT's one substantive condition is that the
  copyright notice and permission notice be retained in all copies and
  substantial portions. A proprietary release that strips it is a licence breach,
  not a relicensing.
- **Consent does not fully solve it either.** Even with written agreement from
  Arnas Donauskas, the versions of `wacrm` already published under MIT stay MIT
  forever (§2.2). Agreement only covers future distribution of his code.

**Realistic options, roughly in order of practicality:**

1. **Dual-notice.** Keep the MIT notice for the upstream base, and apply a
   proprietary licence to your own additions. This is what most
   open-source-fork-goes-commercial projects actually do. It does *not* stop
   someone forking the upstream `wacrm` project — but it does cover the
   substantial work built on top, which is where the value now is.
2. **Copyright assignment.** Negotiate a written assignment or a commercial
   relicensing grant from Arnas Donauskas for the upstream portions. Cleanest
   outcome, requires his cooperation.
3. **Clean-room replacement.** Identify and rewrite everything originating
   upstream. Given how much of the codebase this is likely to be, treat this as
   theoretical.

`LICENSE.proposed` as drafted asserts all rights over the whole work, which is
accurate only under option 2. Under option 1 it needs the upstream MIT notice
retained alongside it — see its §10.

**Do not apply anything here until a solicitor has looked at the fork
relationship.** This is the part where getting it wrong creates liability rather
than protection.

To see the split for yourself, fetch the full history first — the working clone
is shallow, so contributor counts taken from it are meaningless:

```bash
git fetch --unshallow
git shortlog -sne --all
```

### 2.2 MIT cannot be revoked for what is already out

MIT is a perpetual, irrevocable grant. Everyone who has obtained a copy under it
keeps MIT rights **to that code, permanently**. Relicensing binds only versions
distributed afterwards.

The repository is public today, so copies almost certainly exist. Relicensing
protects future work. It does not retrieve the past.

### 2.3 Making the repository private does not undo any of this

Worth being exact, because it is the most common misunderstanding:

| Making the repo private… | Effect |
|---|---|
| Stops *new* people reading the code | Yes |
| Revokes MIT rights already granted | **No** — see §2.2 |
| Deletes or reclaims existing forks | **No.** GitHub detaches public forks into a new network; they stay public and stay forked |
| Changes the licence | **No.** Visibility and licence are unrelated |

Private + MIT means: fewer people can get a copy, and everyone who already has
one may still fork, host and rebrand it.

### 2.4 Third-party dependencies are unaffected

The Software incorporates open-source components under their own licences.
Relicensing ConvoReal changes nothing about them, and `LICENSE.proposed` §10
says so explicitly.

---

## 3. The file sweep

Six places currently advertise the MIT/self-host/fork position. They must change
**with** the licence, in one commit — never before it, or the repo contradicts
itself in the other direction.

| File | What it says now | Change to |
|---|---|---|
| `LICENSE` | MIT licence text | Contents of `LICENSE.proposed` |
| `README.md:3` | "**Self-hostable** WhatsApp Engine…" | Drop "Self-hostable" |
| `README.md:5` | `[![License: MIT]…]` badge | Proprietary badge, or remove |
| `README.md` §License | `See [LICENSE](./LICENSE).` | Already neutral — no change needed |
| `package.json:6` | `"license": "MIT"` | `"license": "UNLICENSED"` and add `"private": true` |
| `package.json:25-26` | keywords `"self-hosted"`, `"template"` | Remove both |
| `.github/pull_request_template.md:1-8` | "this is a template… most changes belong in **your fork**" | Rewrite for internal contributors |
| `CONTRIBUTING.md:3` | "a **self-hostable** WhatsApp deal engine" | Drop "self-hostable"; rewrite the fork/PR guidance |

`"license": "UNLICENSED"` with `"private": true` is the npm convention for a
package that must never be published. `package.json` already has
`"private": true`, so only the `license` field and the keywords need editing.

Also consider:

- `README.md` "Deploy your own" / quick-start sections, if they read as an
  invitation to run your own instance.
- The `.github/ISSUE_TEMPLATE` files, if they assume outside contributors.
- Any published npm package or Docker image built from this repo.

---

## 4. Applying it

Only after §2.1 is resolved:

```bash
git checkout -b chore/relicense
git mv LICENSE.proposed LICENSE          # replaces the MIT text
# then make every edit in the §3 table in the SAME commit
npm run typecheck && npm run lint && npm test
```

Commit message should record **who consented and when** — that record is the
thing you will want years later, not the diff.

Then, separately:

1. Make the repository private (GitHub → Settings → General → Danger Zone →
   Change repository visibility). See §2.3 for what this does and does not
   achieve, and §5 for the operational fallout.
2. Add a `NOTICE` or `THIRD_PARTY_LICENSES` file if you do not already ship one.

---

## 5. Operational fallout of going private

Check each before flipping the switch:

- **GitHub Actions minutes** stop being free. Public repositories get unlimited
  Actions; private ones draw on the account's monthly quota. CI runs on every
  PR here, so confirm the plan's allowance covers it.
- **Vercel** keeps deploying via the GitHub App, but confirm the integration
  still has repository access afterwards.
- **Existing forks** survive and stay public (§2.3).
- **Stars, watchers and public issue history** become invisible to outsiders.
- **Anything depending on raw.githubusercontent.com URLs** from this repo will
  start returning 404.

---

## 6. What this does not change about monetisation

Under MIT you could only sell the hosted service, because anyone could run the
software themselves. A proprietary licence makes selling the software itself
possible — direct licensing, on-premise deals, white-label agreements.

It also removes whatever adoption the open licence was buying you. That trade is
the actual decision; the file edits above are the easy part.
