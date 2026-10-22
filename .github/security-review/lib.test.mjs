import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import {
  checkConclusion,
  extractHandbookSections,
  findingKey,
  formatFinding,
  isReviewed,
  markersIn,
  parseDiff,
  planComments,
  safeRepoPath,
  selectFiles,
  truncateDiff,
} from './lib.mjs';

test('selectFiles keeps source files and drops deletions, tests and generated code', () => {
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
    ].join('\n')
  );
  assert.deepEqual(files, [
    'src/app/api/contacts/route.ts',
    'src/b.ts',
    'supabase/migrations/20261022000000_x.sql',
    'go-ingress/main.go',
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
});

test('truncateDiff cuts on a file boundary and says so', () => {
  const diff = `${'diff --git a/a b/a\n+x\n'.repeat(50)}`;
  const { text, truncated } = truncateDiff(diff, 400);
  assert.equal(truncated, true);
  assert.ok(text.includes('[diff truncated'));
  assert.ok(text.length < diff.length);
  assert.equal(truncateDiff('short', 400).truncated, false);
});

test('extractHandbookSections pulls the security sections of AGENTS.md', () => {
  const md = [
    '# Handbook',
    '### 2.4 Files',
    'files',
    '### 2.5 Security rules',
    'never log secrets',
    '### 2.6 Database rules',
    'rls',
    '### 2.8 Parity',
    'parity',
    '## 10. API route patterns',
    'routes',
    '## 11. UI',
    'ui',
  ].join('\n');
  const out = extractHandbookSections(md);
  assert.ok(out.includes('never log secrets'));
  assert.ok(out.includes('rls'));
  assert.ok(out.includes('routes'));
  assert.ok(!out.includes('parity'));
  assert.ok(!out.includes('ui'));
});
