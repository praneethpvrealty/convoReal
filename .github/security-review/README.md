# Claude review

`review.mjs` reviews one pull request with Claude for security defects and
for correctness, and posts the result back on GitHub: one review with an
inline comment per finding, each labelled `[security]` or `[code]`, and two
check runs named **Claude Security Review** and **Claude Code Review**. It
runs from `.github/workflows/security-review.yml` whenever a pull request
against `main` or `release/**` opens ready, leaves draft or receives a push.

It calls the Claude API directly through `@anthropic-ai/sdk` rather than
the Claude Code GitHub Action, so its usage draws on the API credits a Max
or Team plan includes. Runs started by the Claude Code GitHub Action count
as Claude Code usage, which those credits do not cover.

The workflow uses `pull_request_target`, so the reviewer, its dependencies
and its tests always come from the base branch, and the pull request under
review is checked out into `head/` where it is only read. A PR therefore
cannot change what the checks report about itself, and the handbook text in
the system prompt is read from the base commit, not the head. The cost is
that a change to the reviewer is not exercised by its own PR: test it with
`workflow_dispatch` on the branch that carries it, with the PR's number.

How a review runs:

1. The diff between the merge base and the head is built for the source
   files the change touches, deletions included. Tests, generated files,
   lockfiles, docs other than `AGENTS.md` and `public/` are left out.
2. A model is picked from the diff (`planModel` in `lib.mjs`):
   - **deep** → `claude-opus-5-5` when any file matches a sensitive path
     (auth, Supabase clients, the v1 helpers, the proxy, migrations, public,
     v1, Den, buyer, auth, billing, credits, admin and WhatsApp routes, any
     webhook or cron route, WhatsApp webhook and
     crypto code, billing and credits, the Go ingress, the queue worker,
     `.github/`, deployment config), when the diff itself touches auth,
     policy or secret code (`SECURITY DEFINER`, `service_role`, a policy
     statement, `is_account_member`/`is_account_writer`, the auth wrappers,
     the server-only secrets), when the diff exceeds 40k characters, or when
     more than 15 files change;
   - **light** → `claude-haiku-5-5` for a diff under 3k characters across at
     most three files with no route, page, layout or sensitive path and no
     `supabaseAdmin(` call; a service-role query holds a small diff at the
     standard tier instead;
   - **standard** → `claude-sonnet-5-5` for everything else.
     `workflow_dispatch` takes a `model` input (`auto`, `opus`, `sonnet`,
     `haiku`) that overrides the choice, as does `REVIEW_MODEL` in the
     environment.
   - **rereview** → `claude-sonnet-5-5` when the pull request already carries
     a completed review. Every run uploads its findings as the
     `claude-review-result` workflow artifact (`review-result.json`, 30
     days). The script walks the PR's commits from the newest backwards (at
     most 30) for one with a successful `security-review.yml` run started by
     `pull_request_target` or `workflow_dispatch`, downloads that run's
     artifact (unpacked in memory through `funzip`, never written to disk)
     and accepts it only if it names this PR and that head. Check
     runs, comments and statuses are not consulted for this: a same-repo PR
     workflow can post those, but it cannot produce a run of this workflow
     or attach an artifact to one. It then reviews only the PR's files that
     changed between that commit and the head. The diff it shows is those
     files' full pull-request diff, and the other files are listed so the
     model can read them. The deep triggers still apply to that delta: a fix
     that touches a migration or auth code goes to Opus. Findings from the
     prior result in files this push did not change, and that are still in
     the PR, are carried over: they count toward the check conclusion and
     are listed in the summary, so a high in an untouched file keeps the
     check red until a push changes that file. When no reviewed file
     changed (a merge of the base branch, a test-only push), the carried
     findings alone decide the checks and no model is called.
     `REVIEW_SCOPE=full` forces a full review. A `workflow_dispatch` run
     defaults to `full`; pass `scope=auto` to exercise the re-review path by
     hand.
3. Claude reads the diff with the handbook's engineering and security
   sections from the base commit's `AGENTS.md`, then reads files and
   searches the head checkout with two read-only tools to confirm who calls
   the changed code, what guards it and what its other callers expect. The
   correctness pass also reads the `FEATURE_MANIFEST.json` entries of the
   features the change touches.
4. It submits both kinds of finding through one structured tool call. Each
   finding names a kind, a file, a line, a severity, the concrete path to
   the harm or wrong result, and the smallest fix.
5. Findings on lines inside the diff become inline review comments; the
   rest go in the review body. A finding already posted on an earlier
   commit is not repeated: every comment carries a hidden key the next run
   reads back.
6. Each check run concludes `success` with no findings of its kind,
   `neutral` with only low or medium ones, and `failure` with a high or
   critical one. The checks are not in the required `CI` gate; the handbook
   makes a finding a merge blocker until it is fixed or answered on its
   thread. The summary of each check names the model, the tier and why it
   was chosen, the token usage and the estimated cost of the run, so the
   month's spend can be read off the check runs.

Secrets and limits:

- `ANTHROPIC_API_KEY` is a repository secret from the Console organisation
  linked to the plan. The script never prints it.
- `GITHUB_TOKEN` needs `pull-requests: write` and `checks: write`. Pull
  requests from forks are skipped because they cannot read the secret, and
  a `workflow_dispatch` run refuses a fork's head for the same reason.
  A release PR is reviewed like any other, on its combined diff: that is
  where a conflict fix or a push straight to the release branch, which no
  member PR covered, first shows up.
- `read_file` resolves symlinks and refuses any path that lands outside the
  checkout or inside `.git` or `node_modules`, so a committed symlink cannot
  hand the model the runner's environment or the checkout's credentials.
  Both checkouts run with `persist-credentials: false`, so neither holds a
  token while the model reads it.
- Deleted source files stay in the diff: removing an authorization wrapper
  or a webhook check is exactly the change the review exists to catch.
  Findings on a deleted file go in the review body, since no line of it
  remains to comment on.
- `REVIEW_MODEL` (default `auto`), `REVIEW_SCOPE` (default `auto`),
  `REVIEW_RESULT_PATH` (default `review-result.json`), `REVIEW_MAX_TURNS`
  (default 40) and `REVIEW_MAX_DIFF_CHARS` (default 160000) bound a run.
  The token needs `actions: read` to list runs and download the artifact. Tool output is
  clipped, file reads are capped at 400 lines, and the system prompt and
  the growing conversation are cached across turns, so each tool round
  pays cache-read prices for everything it has already sent. Opus and Sonnet runs enable the server-side refusal
  fallback; Haiku has none.
- Cap the organisation's spend from the Console with a workspace limit so a
  runaway month stops at the credit, never at a card.

Run `npm test` in this directory for the pure helpers; `node --test` also
runs in the workflow before every review.
