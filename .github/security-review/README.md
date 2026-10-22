# Claude security review

`review.mjs` reviews one pull request for security defects with Claude and
posts the result back on GitHub: one review with an inline comment per
finding, and a check run named **Claude Security Review**. It runs from
`.github/workflows/security-review.yml` whenever a pull request against
`main` or `release/**` opens ready, leaves draft or receives a push.

The workflow uses `pull_request_target`, so the reviewer, its dependencies
and its tests always come from the base branch, and the pull request under
review is checked out into `head/` where it is only read. A PR therefore
cannot change what the check reports about itself, and the handbook text in
the system prompt is read from the base commit, not the head. The cost is
that a change to the reviewer is not exercised by its own PR: test it with
`workflow_dispatch` on the branch that carries it, with the PR's number.

It calls the Claude API directly through `@anthropic-ai/sdk` rather than
the Claude Code GitHub Action, so its usage draws on the API credits a Max
or Team plan includes. Runs started by the Claude Code GitHub Action count
as Claude Code usage, which those credits do not cover.

How a review runs:

1. The diff between the merge base and the head is built for the source
   files the change touches. Tests, generated files, lockfiles, docs and
   `public/` are left out.
2. Claude reads the diff with the handbook's security sections from the
   base commit's `AGENTS.md`, then reads files and searches the head
   checkout with two read-only tools to confirm who calls the changed code
   and what guards it. An edit to `AGENTS.md` is always part of the diff.
3. It submits findings through one structured tool call. Each finding names
   a file, a line, a severity, the concrete path to the harm and the
   smallest fix.
4. Findings on lines inside the diff become inline review comments; the
   rest go in the review body. A finding already posted on an earlier
   commit is not repeated: every comment carries a hidden key the next run
   reads back.
5. The check run concludes `success` with no findings, `neutral` with only
   low or medium ones, and `failure` with a high or critical one. The check
   is not in the required `CI` gate; the handbook makes a finding a merge
   blocker until it is fixed or answered on its thread.

Secrets and limits:

- `ANTHROPIC_API_KEY` is a repository secret from the Console organisation
  linked to the plan. The script never prints it.
- `GITHUB_TOKEN` needs `pull-requests: write` and `checks: write`. Pull
  requests from forks are skipped because they cannot read the secret, and
  a `workflow_dispatch` run refuses a fork's head for the same reason.
- `read_file` resolves symlinks and refuses any path that lands outside the
  checkout or inside `.git` or `node_modules`, so a committed symlink cannot
  hand the model the runner's environment or the checkout's credentials.
  Both checkouts run with `persist-credentials: false`, so neither holds a
  token while the model reads it.
- Deleted source files stay in the diff: removing an authorization wrapper
  or a webhook check is exactly the change the review exists to catch.
  Findings on a deleted file go in the review body, since no line of it
  remains to comment on.
- `SECURITY_REVIEW_MODEL` (default `claude-opus-5-5`),
  `SECURITY_REVIEW_MAX_TURNS` (default 30) and
  `SECURITY_REVIEW_MAX_DIFF_CHARS` (default 160000) bound a run. Tool
  output is clipped, file reads are capped at 400 lines, and the system
  prompt is cached across turns.
- Cap the organisation's spend from the Console with a workspace limit so a
  runaway month stops at the credit, never at a card.

Run `npm test` in this directory for the pure helpers; `node --test` also
runs in the workflow before every review.
