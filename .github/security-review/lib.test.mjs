import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  carriedFindings,
  checkConclusion,
  confinedRealPath,
  estimateCost,
  planModel,
  rereviewFiles,
  reviewBody,
  reviewFooter,
  splitByKind,
  summaryMarkdown,
  extractHandbookSections,
  findingKey,
  formatFinding,
  isReviewed,
  isTrustedReviewRun,
  markersIn,
  parseDiff,
  parseReviewResult,
  planComments,
  priorFindingsIn,
  safeRepoPath,
  selectFiles,
  truncateDiff,
} from './lib.mjs';

test('selectFiles keeps source files, deletions included, and drops tests and generated code', () => {
  const files = selectFiles(
    [
      'M\tsrc/app/api/contacts/route.ts',
      'A\tsrc/lib/copilot/knowledge-index.gen.ts',
      'D\tsrc/lib/old.ts',
      'M\tsrc/lib/thing.test.ts',
      'M\tpackage-lock.json',
      'M\tdocs/guide.md',
      'R100\tsrc/a.ts\tsrc/b.ts',
      'M\tsupabase/migrations/20261022000000_x.sql',
      'M\tgo-ingress/main.go',
      'M\tAGENTS.md',
      'M\tREADME.md',
    ].join('\n')
  );
  assert.deepEqual(files, [
    'src/app/api/contacts/route.ts',
    'src/lib/old.ts',
    'src/b.ts',
    'supabase/migrations/20261022000000_x.sql',
    'go-ingress/main.go',
    'AGENTS.md',
  ]);
  assert.equal(isReviewed('mobile/lib/api.ts'), true);
  assert.equal(isReviewed('public/guides/x.pdf'), false);
});

test('parseDiff indexes the right-side lines each file can be commented on', () => {
  const diff = [
    'diff --git a/src/x.ts b/src/x.ts',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -10,3 +10,4 @@ ctx',
    ' keep',
    '-gone',
    '+added one',
    '+added two',
    ' tail',
    'diff --git a/src/new.ts b/src/new.ts',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    'diff --git a/src/del.ts b/src/del.ts',
    '--- a/src/del.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
  ].join('\n');
  const index = parseDiff(diff);
  assert.deepEqual(
    [...index.get('src/x.ts')].sort((a, b) => a - b),
    [10, 11, 12, 13]
  );
  assert.deepEqual([...index.get('src/new.ts')], [1, 2]);
  assert.equal(index.has('src/del.ts'), false);
});

test('planComments anchors findings inside the diff and keeps the rest for the body', () => {
  const index = parseDiff(
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n line\n+new\n'
  );
  const inDiff = {
    path: 'a.ts',
    line: 2,
    severity: 'high',
    title: 'Check the account',
    detail: 'd',
    recommendation: 'r',
  };
  const outside = {
    path: 'a.ts',
    line: 40,
    severity: 'low',
    title: 'Elsewhere',
    detail: 'd',
    recommendation: 'r',
  };
  const repeated = { ...inDiff };
  const { inline, outOfDiff, alreadyPosted, fresh } = planComments(
    [inDiff, outside, repeated],
    index,
    new Set()
  );
  assert.equal(inline.length, 1);
  assert.equal(inline[0].side, 'RIGHT');
  assert.ok(inline[0].body.includes(findingKey(inDiff)));
  assert.deepEqual(outOfDiff, [outside]);
  assert.equal(alreadyPosted.length, 0);
  assert.deepEqual(fresh, [inDiff, outside]);

  const second = planComments(
    [inDiff, outside],
    index,
    new Set([findingKey(inDiff)])
  );
  assert.equal(second.inline.length, 0);
  assert.deepEqual(second.alreadyPosted, [inDiff]);
  assert.deepEqual(second.fresh, [outside]);
});

test('findingKey is stable across wording noise and read back from a posted body', () => {
  const a = findingKey({ path: 'a.ts', title: 'Check the Account!' });
  const b = findingKey({ path: 'a.ts', title: 'check   the account' });
  assert.equal(a, b);
  assert.notEqual(a, findingKey({ path: 'b.ts', title: 'check the account' }));
  const body = formatFinding({
    path: 'a.ts',
    title: 'Check the account',
    severity: 'medium',
    detail: 'x',
    recommendation: 'y',
  });
  assert.deepEqual([...markersIn(body)], [a]);
});

test('checkConclusion fails on high or critical and stays neutral below', () => {
  assert.equal(checkConclusion([]), 'success');
  assert.equal(
    checkConclusion([{ severity: 'low' }, { severity: 'medium' }]),
    'neutral'
  );
  assert.equal(
    checkConclusion([{ severity: 'low' }, { severity: 'high' }]),
    'failure'
  );
  assert.equal(checkConclusion([{ severity: 'nonsense' }]), 'neutral');
});

test('safeRepoPath confines reads to the checkout', () => {
  const root = path.resolve('/repo');
  assert.equal(safeRepoPath(root, 'src/a.ts'), path.join(root, 'src/a.ts'));
  assert.equal(safeRepoPath(root, '../etc/passwd'), null);
  assert.equal(safeRepoPath(root, '/etc/passwd'), null);
  assert.equal(safeRepoPath(root, 'node_modules/x/index.js'), null);
  assert.equal(safeRepoPath(root, '.git/config'), null);
});

test('confinedRealPath refuses a symlink that leaves the checkout', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'security-review-'));
  const root = path.join(base, 'repo');
  const outside = path.join(base, 'outside.txt');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, '.git'));
  writeFileSync(outside, 'secret');
  writeFileSync(path.join(root, 'src', 'a.ts'), 'export {}');
  writeFileSync(path.join(root, '.git', 'config'), '[core]');
  symlinkSync(outside, path.join(root, 'src', 'escape.ts'));
  symlinkSync(base, path.join(root, 'src', 'up'));
  symlinkSync(path.join(root, '.git'), path.join(root, 'src', 'dotgit'));
  assert.equal(
    confinedRealPath(root, 'src/a.ts'),
    path.join(realpathSync(root), 'src', 'a.ts')
  );
  assert.equal(confinedRealPath(root, 'src/escape.ts'), null);
  assert.equal(confinedRealPath(root, 'src/up/outside.txt'), null);
  assert.equal(confinedRealPath(root, 'src/dotgit/config'), null);
  assert.equal(confinedRealPath(root, 'src/missing.ts'), null);
});

test('truncateDiff cuts on a file boundary and says so', () => {
  const diff = `${'diff --git a/a b/a\n+x\n'.repeat(50)}`;
  const { text, truncated } = truncateDiff(diff, 400);
  assert.equal(truncated, true);
  assert.ok(text.includes('[diff truncated'));
  assert.ok(text.length < diff.length);
  assert.equal(truncateDiff('short', 400).truncated, false);
});

test('extractHandbookSections pulls the engineering and security rules of AGENTS.md', () => {
  const md = [
    '# Handbook',
    '## 1. What this is',
    'intro',
    '### 2.1 Read first',
    'read first',
    '### 2.5 Security rules',
    'never log secrets',
    '### 2.6 Database rules',
    'rls',
    '### 2.8 Parity',
    'parity',
    '## 3. Tech stack',
    'stack',
    '## 10. API route patterns',
    'routes',
    '## 11. UI',
    'ui',
    '## 12. Testing',
    'tests',
    '## 13. Deployment',
    'deploy',
  ].join('\n');
  const out = extractHandbookSections(md);
  for (const kept of [
    'read first',
    'never log secrets',
    'rls',
    'parity',
    'routes',
    'tests',
  ]) {
    assert.ok(out.includes(kept), kept);
  }
  for (const dropped of ['intro', 'stack', 'ui', 'deploy']) {
    assert.ok(!out.includes(dropped), dropped);
  }
});

test('planModel picks the tier from sensitive paths and diff size', () => {
  const small = planModel({
    files: ['src/components/inventory/property-card.tsx'],
    diffChars: 800,
  });
  assert.equal(small.tier, 'light');
  assert.equal(small.model, 'claude-haiku-5-5');

  const routine = planModel({
    files: ['src/components/inbox/thread.tsx', 'src/lib/contacts/format.ts'],
    diffChars: 12_000,
  });
  assert.equal(routine.tier, 'standard');
  assert.equal(routine.model, 'claude-sonnet-5-5');

  const route = planModel({
    files: ['src/app/api/contacts/route.ts'],
    diffChars: 400,
  });
  assert.equal(route.tier, 'standard');

  const sensitive = planModel({
    files: ['src/lib/auth/account.ts', 'src/components/x.tsx'],
    diffChars: 500,
  });
  assert.equal(sensitive.tier, 'deep');
  assert.equal(sensitive.model, 'claude-opus-5-5');
  assert.match(sensitive.reasons[0], /sensitive path/);

  const migration = planModel({
    files: ['supabase/migrations/20261023000000_x.sql'],
    diffChars: 200,
  });
  assert.equal(migration.tier, 'deep');

  for (const file of [
    'src/lib/v1/query.ts',
    'src/app/api/appointments/cron/route.ts',
    'src/app/api/leads/email-webhook/route.ts',
    'src/app/api/auth/sms-hook/route.ts',
    'src/app/api/billing/credits/buy/route.ts',
    'src/app/api/whatsapp/templates/sync/route.ts',
  ]) {
    assert.equal(
      planModel({ files: [file], diffChars: 200 }).tier,
      'deep',
      file
    );
  }

  const serviceRole = planModel({
    files: ['src/lib/deals/delete-deal.ts'],
    diffChars: 900,
    diffText: '+  const db = supabaseAdmin();\n',
  });
  assert.equal(serviceRole.tier, 'standard');
  assert.match(serviceRole.reasons[0], /service-role query/);

  for (const text of [
    '+  SECURITY DEFINER\n',
    '+  return requirePlatformAdmin(req);\n',
    "+  USING (is_account_writer(account_id, 'agent'))\n",
    '+  const key = process.env.ENCRYPTION_KEY;\n',
  ]) {
    const plan = planModel({
      files: ['src/lib/deals/delete-deal.ts'],
      diffChars: 900,
      diffText: text,
    });
    assert.equal(plan.tier, 'deep', text);
    assert.match(plan.reasons[0], /auth, policy or secret/);
  }

  const large = planModel({
    files: Array.from({ length: 20 }, (_, i) => `src/lib/x/${i}.ts`),
    diffChars: 9_000,
  });
  assert.equal(large.tier, 'deep');

  const forced = planModel({
    files: ['src/a.ts'],
    diffChars: 10,
    override: 'opus',
  });
  assert.equal(forced.tier, 'forced');
  assert.equal(forced.model, 'claude-opus-5-5');
  assert.equal(
    planModel({ files: ['src/a.ts'], diffChars: 10, override: 'auto' }).tier,
    'light'
  );
});

test('a re-review runs on Sonnet unless the changed files hit a deep trigger', () => {
  const sha = 'abc1234def5678';
  const routine = planModel({
    files: ['src/lib/showcase/property-qa.ts', 'src/lib/ai/lead-question.ts'],
    diffChars: 30_000,
    rereviewOf: sha,
  });
  assert.equal(routine.tier, 'rereview');
  assert.equal(routine.model, 'claude-sonnet-5-5');
  assert.deepEqual(routine.reasons, [
    're-review of 2 files changed since abc1234',
  ]);

  const tiny = planModel({
    files: ['src/lib/showcase/property-qa.ts'],
    diffChars: 500,
    rereviewOf: sha,
  });
  assert.equal(tiny.tier, 'rereview');

  const sensitive = planModel({
    files: ['supabase/migrations/20261024000000_x.sql'],
    diffChars: 500,
    rereviewOf: sha,
  });
  assert.equal(sensitive.tier, 'deep');
  assert.equal(sensitive.model, 'claude-opus-5-5');
  assert.match(sensitive.reasons[0], /re-review of 1 file/);
  assert.match(sensitive.reasons[1], /sensitive path/);

  const policy = planModel({
    files: ['src/lib/deals/x.ts'],
    diffChars: 500,
    diffText: '+  SECURITY DEFINER\n',
    rereviewOf: sha,
  });
  assert.equal(policy.tier, 'deep');

  const forced = planModel({
    files: ['src/lib/deals/x.ts'],
    diffChars: 500,
    override: 'haiku',
    rereviewOf: sha,
  });
  assert.equal(forced.tier, 'forced');
  assert.equal(forced.model, 'claude-haiku-5-5');
});

test('rereviewFiles keeps the pull request files that changed since the last review', () => {
  assert.deepEqual(
    rereviewFiles(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      ['src/c.ts', 'src/a.ts', 'src/unrelated.ts']
    ),
    ['src/a.ts', 'src/c.ts']
  );
  assert.deepEqual(rereviewFiles(['src/a.ts'], []), []);
});

test('only a successful base-branch run of the reviewer workflow counts as a prior review', () => {
  const run = {
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request_target',
    path: '.github/workflows/security-review.yml',
  };
  assert.equal(isTrustedReviewRun(run), true);
  assert.equal(
    isTrustedReviewRun({ ...run, event: 'workflow_dispatch' }),
    false
  );
  assert.equal(isTrustedReviewRun({ ...run, event: 'pull_request' }), false);
  assert.equal(isTrustedReviewRun({ ...run, conclusion: 'skipped' }), false);
  assert.equal(
    isTrustedReviewRun({ ...run, path: '.github/workflows/ci.yml' }),
    false
  );
  assert.equal(
    isTrustedReviewRun({ status: 'in_progress', conclusion: null }),
    false
  );
  assert.equal(isTrustedReviewRun(undefined), false);
});

test('parseReviewResult accepts only this pull request and head', () => {
  const result = JSON.stringify({
    pr: 42,
    headSha: 'abc',
    findings: [
      { kind: 'code', path: 'src/a.ts', line: 3, severity: 'high', title: 'A' },
      {
        kind: 'nonsense',
        path: 'src/b.ts',
        line: 'x',
        severity: 'odd',
        title: 'B',
      },
      { path: 7 },
    ],
  });
  assert.deepEqual(
    parseReviewResult(result, { prNumber: 42, headSha: 'abc' }),
    {
      files: [],
      findings: [
        {
          kind: 'code',
          path: 'src/a.ts',
          line: 3,
          severity: 'high',
          title: 'A',
        },
        {
          kind: 'security',
          path: 'src/b.ts',
          line: 0,
          severity: 'medium',
          title: 'B',
        },
      ],
    }
  );
  assert.deepEqual(
    parseReviewResult(
      JSON.stringify({
        pr: 42,
        headSha: 'abc',
        files: ['src/a.ts', 3],
        findings: [],
      }),
      { prNumber: 42, headSha: 'abc' }
    ),
    { files: ['src/a.ts'], findings: [] }
  );
  assert.equal(
    parseReviewResult(result, { prNumber: 41, headSha: 'abc' }),
    null
  );
  assert.equal(
    parseReviewResult(result, { prNumber: 42, headSha: 'abd' }),
    null
  );
  assert.equal(
    parseReviewResult('not json', { prNumber: 42, headSha: 'abc' }),
    null
  );
  assert.equal(
    parseReviewResult('{"pr":42,"headSha":"abc"}', {
      prNumber: 42,
      headSha: 'abc',
    }),
    null
  );
});

test('a re-review carries earlier findings unless their file was re-reviewed or left the pull request', () => {
  const prior = [
    {
      kind: 'security',
      path: 'src/a.ts',
      line: 12,
      severity: 'high',
      title: 'Check the account',
    },
    {
      kind: 'code',
      path: 'src/b.ts',
      line: 0,
      severity: 'low',
      title: 'Log the failure',
    },
    {
      kind: 'code',
      path: 'src/c.ts',
      line: 3,
      severity: 'medium',
      title: 'Await the send',
    },
    {
      kind: 'code',
      path: 'src/gone.ts',
      line: 1,
      severity: 'high',
      title: 'Reverted file',
    },
    {
      kind: 'code',
      path: 'src/caller.ts',
      line: 9,
      severity: 'high',
      title: 'Caller now breaks',
    },
  ];
  const priorFiles = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gone.ts'];
  const fresh = [
    {
      kind: 'code',
      path: 'src/c.ts',
      line: 3,
      severity: 'medium',
      title: 'Await the send',
    },
  ];
  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
  const carried = carriedFindings(prior, {
    scope: ['src/b.ts'],
    fresh,
    files,
    priorFiles,
  });
  assert.deepEqual(
    carried.map((f) => f.path),
    ['src/a.ts', 'src/caller.ts']
  );
  assert.equal(checkConclusion([...fresh, ...carried]), 'failure');
  assert.equal(checkConclusion(fresh), 'neutral');
  assert.deepEqual(
    carriedFindings(prior, { scope: [], fresh: [], files, priorFiles }).map(
      (f) => f.path
    ),
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/caller.ts']
  );
  assert.deepEqual(
    carriedFindings(prior, { scope: [], fresh: [], files, priorFiles: [] }).map(
      (f) => f.path
    ),
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gone.ts', 'src/caller.ts']
  );
  assert.deepEqual(
    carriedFindings(undefined, { scope: [], fresh: [], files, priorFiles }),
    []
  );
  assert.deepEqual(
    priorFindingsIn(prior, ['src/b.ts', 'src/c.ts']).map((f) => f.title),
    ['Log the failure', 'Await the send']
  );

  const next = summaryMarkdown({
    findings: fresh,
    kind: 'code',
    summary: '',
    model: 'claude-sonnet-5-5',
    plan: { tier: 'rereview', reasons: ['x'] },
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
    carried,
    carriedFrom: 'abc1234def',
  });
  assert.match(next, /2 findings carried over from abc1234/);
  assert.match(next, /src\/a\.ts:12/);
  const quiet = summaryMarkdown({
    findings: [],
    kind: 'code',
    summary: 'stands',
    carried,
  });
  assert.match(quiet, /No code findings in this change/);
  assert.doesNotMatch(quiet, /Reviewed by/);
});

test('estimateCost prices usage per model and reviewFooter reports it', () => {
  const usage = {
    input: 30_000,
    cacheCreation: 0,
    cacheRead: 0,
    output: 4_000,
  };
  assert.equal(estimateCost('claude-opus-5-5', usage).toFixed(2), '0.20');
  assert.equal(estimateCost('claude-sonnet-5-5', usage).toFixed(2), '0.10');
  assert.equal(estimateCost('unknown-model', usage), null);
  const cached = { ...usage, cacheRead: 100_000 };
  assert.equal(estimateCost('claude-sonnet-5-5', cached).toFixed(2), '0.11');
  assert.equal(estimateCost('claude-opus-5-5', cached).toFixed(2), '0.22');
  const footer = reviewFooter({
    model: 'claude-sonnet-5-5',
    plan: { tier: 'standard', reasons: ['12k-char diff'] },
    usage,
  });
  assert.match(footer, /standard tier: 12k-char diff/);
  assert.match(footer, /≈ \$0\.10/);
});

test('findings are split by kind and formatted with their kind', () => {
  const findings = [
    { kind: 'security', path: 'a.ts', line: 1, severity: 'high', title: 'A' },
    { kind: 'code', path: 'b.ts', line: 2, severity: 'medium', title: 'B' },
    { path: 'c.ts', line: 3, severity: 'low', title: 'C' },
  ];
  const { security, code } = splitByKind(findings);
  assert.deepEqual(
    security.map((f) => f.title),
    ['A', 'C']
  );
  assert.deepEqual(
    code.map((f) => f.title),
    ['B']
  );
  assert.match(formatFinding(findings[1]), /MEDIUM · \[code\] B/);
  assert.match(
    reviewBody({ findings, outOfDiff: [], summary: '' }),
    /2 security and 1 code findings/
  );
  assert.ok(
    markersIn('<!-- claude-security-review:0123456789abcdef -->').has(
      '0123456789abcdef'
    )
  );
  assert.ok(
    markersIn('<!-- claude-review:0123456789abcdef -->').has('0123456789abcdef')
  );
});
