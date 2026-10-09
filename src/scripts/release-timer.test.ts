import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_UPDATE_PENDING_LABEL,
  RELEASE_WINDOW_MINUTES,
  REVIEW_SETTLE_MINUTES,
  WORKFLOWS_TOKEN_SECRET,
  decideRelease,
  mobileUpdatePaths,
  run,
  touchesMobileBundle,
} from './release-timer.mjs';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

const ready = {
  createdAt: minutesAgo(RELEASE_WINDOW_MINUTES),
  mergedMembers: [{ number: 1 }],
  openMembers: [] as { number: number }[],
  releasePr: {
    number: 9,
    createdAt: minutesAgo(REVIEW_SETTLE_MINUTES),
    headSha: 'h',
  },
  ci: { status: 'completed', conclusion: 'success' },
  behindMain: 0,
  unresolvedThreads: 0,
  codexRunning: false,
  mergeable: true as boolean | null,
  now: NOW,
};

describe('decideRelease', () => {
  it('never ships a release branch with nothing merged', () => {
    expect(
      decideRelease({ ...ready, mergedMembers: [], createdAt: minutesAgo(999) })
        .action
    ).toBe('wait');
  });

  it('waits until the time limit', () => {
    const decision = decideRelease({
      ...ready,
      createdAt: minutesAgo(RELEASE_WINDOW_MINUTES - 30),
      releasePr: null,
    });
    expect(decision).toEqual({
      action: 'wait',
      reason: 'batch window open; ships in 30 min',
    });
  });

  it('waits one more period for open members, then ships without them', () => {
    const openMembers = [{ number: 4 }];
    expect(
      decideRelease({
        ...ready,
        openMembers,
        createdAt: minutesAgo(2 * RELEASE_WINDOW_MINUTES - 1),
      }).action
    ).toBe('wait');
    expect(
      decideRelease({
        ...ready,
        openMembers,
        createdAt: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      }).action
    ).toBe('merge');
  });

  it('opens the release PR and runs CI at the first deadline while members are open', () => {
    const openMembers = [{ number: 4 }];
    expect(
      decideRelease({ ...ready, openMembers, releasePr: null }).action
    ).toBe('open-pr');
    expect(decideRelease({ ...ready, openMembers, ci: null }).action).toBe(
      'run-ci'
    );
  });

  it('opens the release PR, then starts CI', () => {
    expect(decideRelease({ ...ready, releasePr: null }).action).toBe('open-pr');
    expect(decideRelease({ ...ready, ci: null }).action).toBe('run-ci');
  });

  it('waits for running CI and holds on failed CI', () => {
    expect(
      decideRelease({
        ...ready,
        ci: { status: 'in_progress', conclusion: null },
      }).action
    ).toBe('wait');
    expect(
      decideRelease({
        ...ready,
        ci: { status: 'completed', conclusion: 'failure' },
      })
    ).toEqual({ action: 'hold', reason: 'CI concluded failure' });
  });

  it('holds on unresolved review threads and merge conflicts', () => {
    expect(decideRelease({ ...ready, unresolvedThreads: 2 }).action).toBe(
      'hold'
    );
    expect(decideRelease({ ...ready, mergeable: false }).action).toBe('hold');
  });

  it('waits for Codex, review settling and mergeability', () => {
    expect(decideRelease({ ...ready, codexRunning: true }).action).toBe('wait');
    expect(
      decideRelease({
        ...ready,
        releasePr: {
          ...ready.releasePr,
          createdAt: minutesAgo(REVIEW_SETTLE_MINUTES - 1),
        },
      }).action
    ).toBe('wait');
    expect(decideRelease({ ...ready, mergeable: null }).action).toBe('wait');
  });

  it('brings a release that fell behind main up to date before testing it', () => {
    expect(decideRelease({ ...ready, behindMain: 2 })).toEqual({
      action: 'update-branch',
      reason: '2 commit(s) behind main; CI must test the combined tree',
    });
    expect(
      decideRelease({ ...ready, behindMain: 2, mergeable: false }).action
    ).toBe('hold');
  });

  it('merges once every gate passes', () => {
    expect(decideRelease(ready).action).toBe('merge');
  });
});

interface Pull {
  number: number;
  title?: string;
  state: 'open' | 'closed';
  merged_at?: string | null;
  base: { ref: string };
  head: { ref: string; sha?: string; repo?: { full_name: string } };
  created_at?: string;
}

function fakeGithub({
  pulls,
  created = minutesAgo(RELEASE_WINDOW_MINUTES),
  checkRuns = [] as {
    status: string;
    conclusion: string | null;
    started_at: string;
  }[],
  queuedRuns = [] as { status: string; conclusion: string | null }[],
  mergeable = true,
  behindBy = 0,
  movedTip,
  behindAtMerge = behindBy,
  threadPages = [[]] as boolean[][],
  releaseFiles = [] as { filename: string; previous_filename?: string }[],
  pendingUpdates = [] as { number: number; merged: boolean }[],
}: {
  pulls: Pull[];
  created?: string;
  checkRuns?: {
    status: string;
    conclusion: string | null;
    started_at: string;
  }[];
  queuedRuns?: { status: string; conclusion: string | null }[];
  mergeable?: boolean | null;
  behindBy?: number;
  movedTip?: string;
  behindAtMerge?: number;
  threadPages?: boolean[][];
  releaseFiles?: { filename: string; previous_filename?: string }[];
  pendingUpdates?: { number: number; merged: boolean }[];
}) {
  const listBranches = vi.fn();
  const listFiles = vi.fn();
  const listForRepo = vi.fn();
  let releaseReads = 0;
  let compares = 0;
  const pullsList = vi.fn(
    async ({ state, base }: { state: string; base: string }) => ({
      data: pulls.filter(
        (pull) => pull.state === state && pull.base.ref === base
      ),
    })
  );
  const listComments = vi.fn();
  const paginate = vi.fn(
    async (method: unknown, params: { state?: string; base?: string }) => {
      if (method === listBranches) {
        return [
          { name: 'release/batch' },
          { name: 'agent/other' },
          { name: 'main' },
        ];
      }
      if (method === listComments) return [];
      if (method === listFiles) return releaseFiles;
      if (method === listForRepo)
        return pendingUpdates.map(({ number }) => ({
          number,
          pull_request: { url: `https://api.github.com/pulls/${number}` },
        }));
      return pulls.filter(
        (pull) =>
          (params.state === 'all' || pull.state === params.state) &&
          (!params.base || pull.base.ref === params.base)
      );
    }
  );
  const rest = {
    repos: {
      listBranches,
      getBranch: vi.fn(async ({ branch }: { branch: string }) => {
        if (branch === 'main')
          return { data: { commit: { sha: 'main-head' } } };
        releaseReads += 1;
        const sha = movedTip && releaseReads > 1 ? movedTip : 'tip';
        return { data: { commit: { sha } } };
      }),
      listActivities: vi.fn(async () => ({ data: [{ timestamp: created }] })),
      getCommit: vi.fn(),
      getContent: vi.fn(async () => ({
        data: {
          content: Buffer.from(
            readFileSync('.github/workflows/eas-update.yml', 'utf8')
          ).toString('base64'),
        },
      })),
      compareCommitsWithBasehead: vi.fn(async () => {
        compares += 1;
        return { data: { behind_by: compares > 1 ? behindAtMerge : behindBy } };
      }),
    },
    pulls: {
      list: pullsList,
      get: vi.fn(async ({ pull_number }: { pull_number: number }) => ({
        data: {
          mergeable,
          merged:
            pendingUpdates.find((pending) => pending.number === pull_number)
              ?.merged ?? false,
        },
      })),
      create: vi.fn(async () => ({ data: { number: 50 } })),
      merge: vi.fn(async () => ({ data: { sha: 'merged' } })),
      listFiles,
      update: vi.fn(
        async ({
          pull_number,
          base,
        }: {
          pull_number: number;
          base: string;
        }) => {
          const pull = pulls.find(
            (candidate) => candidate.number === pull_number
          );
          if (pull) pull.base.ref = base;
          return {};
        }
      ),
      updateBranch: vi.fn(async () => ({})),
    },
    checks: {
      listForRef: vi.fn(async () => ({ data: { check_runs: checkRuns } })),
    },
    actions: {
      listWorkflowRuns: vi.fn(async () => ({
        data: { workflow_runs: queuedRuns },
      })),
      createWorkflowDispatch: vi.fn(
        async (params: { workflow_id: string; ref: string }) => ({ params })
      ),
    },
    issues: {
      listComments,
      listForRepo,
      createComment: vi.fn(async () => ({})),
      addLabels: vi.fn(async () => ({})),
      removeLabel: vi.fn(async () => ({})),
    },
    git: {
      createRef: vi.fn(async () => ({})),
      deleteRef: vi.fn(async () => ({})),
    },
  };
  const graphql = vi.fn(
    async (_query: string, { after }: { after: string | null }) => {
      const page = after ? Number(after) : 0;
      return {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: threadPages[page].map((isResolved) => ({ isResolved })),
              pageInfo: {
                hasNextPage: page + 1 < threadPages.length,
                endCursor: String(page + 1),
              },
            },
          },
        },
      };
    }
  );
  return { github: { paginate, graphql, rest }, rest };
}

const context = { repo: { owner: 'owner', repo: 'repo' } };
const core = {
  info: vi.fn(),
  notice: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
};
const member = (number: number, extra: Partial<Pull> = {}): Pull => ({
  number,
  title: `Member ${number}`,
  state: 'closed',
  merged_at: minutesAgo(30),
  base: { ref: 'release/batch' },
  head: { ref: `agent/m${number}` },
  ...extra,
});
const releasePr = (created = minutesAgo(REVIEW_SETTLE_MINUTES)): Pull => ({
  number: 50,
  state: 'open',
  base: { ref: 'main' },
  head: { ref: 'release/batch', sha: 'tip', repo: { full_name: 'owner/repo' } },
  created_at: created,
});
const greenCi = [
  { status: 'completed', conclusion: 'success', started_at: minutesAgo(5) },
];

describe('run', () => {
  it('opens the release PR and dispatches CI once the time limit passes', async () => {
    const { github, rest } = fakeGithub({ pulls: [member(1)] });

    const results = await run({ github, context, core, now: NOW });

    expect(results).toEqual({
      'release/batch': { action: 'open-pr', reason: 'time limit reached' },
    });
    expect(rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        head: 'release/batch',
        base: 'main',
        title: 'Release batch',
      })
    );
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'ci.yml',
      ref: 'release/batch',
    });
  });

  it('does not dispatch CI again while a dispatched run is queued', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      queuedRuns: [{ status: 'queued', conclusion: null }],
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('wait');
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it('dispatches CI rather than holding when the only run awaits approval', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      queuedRuns: [{ status: 'completed', conclusion: 'action_required' }],
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({
      action: 'run-ci',
      reason: 'no CI run on the release head',
    });
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'ci.yml',
      ref: 'release/batch',
    });
    expect(rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('reads the dispatched run past one that awaits approval', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      queuedRuns: [
        { status: 'completed', conclusion: 'action_required' },
        { status: 'queued', conclusion: null },
      ],
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('wait');
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('squash-merges, verifies main and deletes the release branch', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), member(2), releasePr()],
      checkRuns: greenCi,
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('merge');
    expect(rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 50,
      merge_method: 'squash',
      sha: 'tip',
      commit_title: 'Release batch (#50)',
    });
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'main' })
    );
    expect(rest.git.createRef).not.toHaveBeenCalled();
    expect(rest.git.deleteRef).not.toHaveBeenCalled();
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'branch-cleanup.yml',
      ref: 'main',
    });
  });

  it('publishes the mobile update after a release that changed the mobile bundle', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      releaseFiles: [
        { filename: 'src/app/page.tsx' },
        { filename: 'mobile/app/(app)/automations.tsx' },
      ],
    });

    await run({ github, context, core, now: NOW });

    expect(rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      path: '.github/workflows/eas-update.yml',
      ref: 'tip',
    });
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'eas-update.yml',
      ref: 'main',
      inputs: { channel: 'preview' },
    });
  });

  it('marks the release as owing a mobile update before merging, and clears it once dispatched', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      releaseFiles: [{ filename: 'mobile/app/(app)/index.tsx' }],
    });

    await run({ github, context, core, now: NOW });

    const labelled = rest.issues.addLabels.mock.invocationCallOrder[0];
    expect(rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 50,
      labels: [MOBILE_UPDATE_PENDING_LABEL],
    });
    expect(labelled).toBeLessThan(rest.pulls.merge.mock.invocationCallOrder[0]);
    expect(rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 50,
      name: MOBILE_UPDATE_PENDING_LABEL,
    });
  });

  it('does not merge when it cannot tell whether the release changed the mobile bundle', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
    });
    rest.repos.getContent.mockRejectedValueOnce(new Error('502'));

    await run({ github, context, core, now: NOW });

    expect(rest.pulls.merge).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith('release/batch: 502');
  });

  it('keeps the mark when the mobile update cannot be dispatched after the merge', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      releaseFiles: [{ filename: 'mobile/app/(app)/index.tsx' }],
    });
    rest.actions.createWorkflowDispatch.mockImplementation(
      async (params: { workflow_id: string; ref: string }) => {
        if (params.workflow_id === 'eas-update.yml') throw new Error('500');
        return { params };
      }
    );

    await run({ github, context, core, now: NOW });

    expect(rest.pulls.merge).toHaveBeenCalled();
    expect(rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('publishes a mobile update a merged release still owes on the next run', async () => {
    const { github, rest } = fakeGithub({
      pulls: [],
      pendingUpdates: [{ number: 49, merged: true }],
    });

    await run({ github, context, core, now: NOW });

    expect(github.paginate).toHaveBeenCalledWith(rest.issues.listForRepo, {
      owner: 'owner',
      repo: 'repo',
      state: 'closed',
      labels: MOBILE_UPDATE_PENDING_LABEL,
      per_page: 100,
    });
    expect(rest.pulls.get).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 49,
    });
    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'eas-update.yml',
      ref: 'main',
      inputs: { channel: 'preview' },
    });
    expect(rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 49 })
    );
  });

  it('drops the mark from a release closed without merging, and only reports on a dry run', async () => {
    const closed = fakeGithub({
      pulls: [],
      pendingUpdates: [{ number: 48, merged: false }],
    });
    await run({ github: closed.github, context, core, now: NOW });
    expect(closed.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(closed.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 48 })
    );

    const dry = fakeGithub({
      pulls: [],
      pendingUpdates: [{ number: 49, merged: true }],
    });
    await run({ github: dry.github, context, core, dryRun: true, now: NOW });
    expect(dry.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(dry.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('publishes for a shared web module the mobile bundle imports', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      releaseFiles: [{ filename: 'src/lib/format/date.ts' }],
    });

    await run({ github, context, core, now: NOW });

    expect(rest.actions.createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: 'eas-update.yml' })
    );
  });

  it('leaves the mobile update alone when the release only touched web or mobile docs', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      releaseFiles: [
        { filename: 'src/app/page.tsx' },
        { filename: 'mobile/README.md' },
      ],
    });

    await run({ github, context, core, now: NOW });

    expect(rest.pulls.merge).toHaveBeenCalled();
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: 'eas-update.yml' })
    );
  });

  it('does not publish the mobile update when it does not merge', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      threadPages: [[false]],
      releaseFiles: [{ filename: 'mobile/app/(app)/index.tsx' }],
    });

    await run({ github, context, core, now: NOW });

    expect(rest.pulls.merge).not.toHaveBeenCalled();
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: 'eas-update.yml' })
    );
  });

  it('moves members still open after the extra period to a next release branch', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      checkRuns: greenCi,
    });

    await run({ github, context, core, now: NOW });

    expect(rest.git.createRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'refs/heads/release/batch-next',
      sha: 'main-head',
    });
    expect(rest.pulls.update).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 3,
      base: 'release/batch-next',
    });
    expect(rest.pulls.update).toHaveBeenCalledTimes(1);
    expect(rest.pulls.update.mock.invocationCallOrder[0]).toBeLessThan(
      rest.pulls.merge.mock.invocationCallOrder[0]
    );
  });

  it('does not merge when the release head moved while members were moved', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      checkRuns: greenCi,
      movedTip: 'member-3-merged',
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({
      action: 'wait',
      reason: 'release head moved; it is re-tested first',
    });
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('treats a merge refused for a moved head as a wait', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
    });
    rest.pulls.merge.mockRejectedValueOnce(
      Object.assign(new Error('Head branch was modified'), { status: 409 })
    );

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('wait');
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it('comments once when holding a release on failed CI', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: [
        {
          status: 'completed',
          conclusion: 'failure',
          started_at: minutesAgo(5),
        },
      ],
    });

    await run({ github, context, core, now: NOW });

    expect(rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('reports without acting on a dry run', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
    });

    expect(
      (await run({ github, context, core, dryRun: true, now: NOW }))[
        'release/batch'
      ].action
    ).toBe('merge');
    expect(rest.pulls.merge).not.toHaveBeenCalled();
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it('reuses a next release branch that already exists', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      checkRuns: greenCi,
    });
    rest.git.createRef.mockRejectedValueOnce(
      Object.assign(new Error('Reference already exists'), { status: 422 })
    );

    await run({ github, context, core, now: NOW });

    expect(rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 3, base: 'release/batch-next' })
    );
    expect(rest.pulls.merge).toHaveBeenCalled();
  });

  it('merges main into a release that fell behind instead of merging it', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindBy: 3,
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('update-branch');
    expect(rest.pulls.updateBranch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 50,
      expected_head_sha: 'tip',
    });
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('holds when main cannot be merged into the release cleanly', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindBy: 3,
    });
    rest.pulls.updateBranch.mockRejectedValueOnce(
      Object.assign(new Error('merge conflict'), { status: 422 })
    );

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('hold');
    expect(rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('merges main in with the workflows token when one is supplied', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindBy: 3,
    });
    const updateBranch = vi.fn(async () => ({}));
    const branchUpdater = { rest: { pulls: { updateBranch } } };

    expect(
      (await run({ github, branchUpdater, context, core, now: NOW }))[
        'release/batch'
      ].action
    ).toBe('update-branch');
    expect(updateBranch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 50,
      expected_head_sha: 'tip',
    });
    expect(rest.pulls.updateBranch).not.toHaveBeenCalled();
  });

  it('holds with the missing secret named when main changes a workflow file', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindBy: 3,
    });
    rest.pulls.updateBranch.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission'
        ),
        { status: 403 }
      )
    );
    const quiet = { ...core, setFailed: vi.fn() };

    const result = (await run({ github, context, core: quiet, now: NOW }))[
      'release/batch'
    ];

    expect(result.action).toBe('hold');
    expect(result.reason).toContain(WORKFLOWS_TOKEN_SECRET);
    expect(rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(WORKFLOWS_TOKEN_SECRET),
      })
    );
    expect(quiet.setFailed).not.toHaveBeenCalled();
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('still fails the run on any other refusal to update the branch', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindBy: 3,
    });
    rest.pulls.updateBranch.mockRejectedValueOnce(
      Object.assign(new Error('Resource not accessible'), { status: 403 })
    );
    const loud = { ...core, setFailed: vi.fn() };

    await run({ github, context, core: loud, now: NOW });

    expect(loud.setFailed).toHaveBeenCalledWith(
      'release/batch: Resource not accessible'
    );
  });

  it('does not merge when main moved after the release was tested', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      behindAtMerge: 1,
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({
      action: 'wait',
      reason: 'main moved; the release is updated and re-tested first',
    });
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('counts unresolved review threads beyond the first page', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
      threadPages: [Array(100).fill(true), [true, false]],
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({ action: 'hold', reason: '1 unresolved review thread(s)' });
    expect(github.graphql).toHaveBeenCalledTimes(2);
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('brings a stale release up to date instead of testing it when opening the PR', async () => {
    const { github, rest } = fakeGithub({ pulls: [member(1)], behindBy: 2 });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('open-pr');
    expect(rest.pulls.updateBranch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 50,
      expected_head_sha: 'tip',
    });
    expect(rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it('opens the release PR and warns when main changes a workflow file it cannot merge in', async () => {
    const { github, rest } = fakeGithub({ pulls: [member(1)], behindBy: 2 });
    rest.pulls.updateBranch.mockRejectedValueOnce(
      Object.assign(new Error('without `workflows` permission'), {
        status: 403,
      })
    );
    const quiet = { ...core, warning: vi.fn(), setFailed: vi.fn() };

    expect(
      (await run({ github, context, core: quiet, now: NOW }))['release/batch']
        .action
    ).toBe('open-pr');
    expect(quiet.warning).toHaveBeenCalledWith(
      expect.stringContaining(WORKFLOWS_TOKEN_SECRET)
    );
    expect(quiet.setFailed).not.toHaveBeenCalled();
  });

  it('ignores a fork PR from a branch named like the release', async () => {
    const fork: Pull = {
      ...releasePr(),
      number: 77,
      head: {
        ref: 'release/batch',
        sha: 'fork',
        repo: { full_name: 'someone/fork' },
      },
    };
    const { github, rest } = fakeGithub({ pulls: [member(1), fork] });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('open-pr');
    expect(rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'release/batch', base: 'main' })
    );
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('moves overdue members as soon as the extension ends, even while CI runs', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      checkRuns: [
        { status: 'in_progress', conclusion: null, started_at: minutesAgo(2) },
      ],
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({ action: 'wait', reason: 'CI running' });
    expect(rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 3, base: 'release/batch-next' })
    );
    expect(rest.pulls.merge).not.toHaveBeenCalled();
  });

  it('leaves open members in place during the extension', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES - 1),
      checkRuns: greenCi,
    });

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch'].action
    ).toBe('wait');
    expect(rest.pulls.update).not.toHaveBeenCalled();
  });

  it('holds with a comment when GitHub refuses the merge outright', async () => {
    const { github, rest } = fakeGithub({
      pulls: [member(1), releasePr()],
      checkRuns: greenCi,
    });
    rest.pulls.merge.mockRejectedValueOnce(
      Object.assign(new Error('Required review is missing'), { status: 405 })
    );

    expect(
      (await run({ github, context, core, now: NOW }))['release/batch']
    ).toEqual({
      action: 'hold',
      reason: 'GitHub refused the merge: Required review is missing',
    });
    expect(rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('tells a moved member its release is frozen, not shipped', async () => {
    const { github, rest } = fakeGithub({
      pulls: [
        member(1),
        member(3, { state: 'open', merged_at: null }),
        releasePr(),
      ],
      created: minutesAgo(2 * RELEASE_WINDOW_MINUTES),
      checkRuns: [
        { status: 'in_progress', conclusion: null, started_at: minutesAgo(2) },
      ],
    });

    await run({ github, context, core, now: NOW });

    const [[comment]] = rest.issues.createComment.mock.calls as unknown as [
      [{ issue_number: number; body: string }],
    ];
    expect(comment.issue_number).toBe(3);
    expect(comment.body).toContain(
      'frozen for release without this pull request'
    );
    expect(comment.body).not.toContain('shipped');
  });
});

describe('the CI run the timer dispatches', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const gate = workflow.slice(workflow.indexOf('\n  ci:\n'));

  it('reports its verdict as the CI commit status the ruleset requires', () => {
    expect(gate).toContain('statuses: write');
    expect(gate).toContain(
      "if: always() && github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/release/')"
    );
    expect(gate).toContain('repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA');
    expect(gate).toContain('-f context=CI');
    expect(gate).toContain(
      "STATE: ${{ job.status == 'success' && 'success' || 'failure' }}"
    );
  });

  it('posts that status last, after every failing step has had its say', () => {
    const steps = gate.split('\n      - name: ');
    expect(steps.at(-1)).toMatch(/^Report the result as the CI commit status/);
  });
});

describe('the mobile update the timer dispatches', () => {
  const workflow = readFileSync('.github/workflows/eas-update.yml', 'utf8');
  const paths = mobileUpdatePaths(workflow);

  it('reads the push paths eas-update.yml publishes on', () => {
    expect(paths).toContain('mobile/**');
    expect(paths).toContain('!mobile/**.md');
    expect(paths).toContain('src/lib/format/date.ts');
  });

  it('matches the way the push trigger does, with a later exclusion winning', () => {
    expect(touchesMobileBundle(['mobile/app/(app)/index.tsx'], paths)).toBe(
      true
    );
    expect(touchesMobileBundle(['mobile/AGENTS.md'], paths)).toBe(false);
    expect(touchesMobileBundle(['mobile/docs/notes.md'], paths)).toBe(false);
    expect(touchesMobileBundle(['src/app/page.tsx'], paths)).toBe(false);
    expect(touchesMobileBundle([], paths)).toBe(false);
  });

  it('accepts a manual run on the channel the installed apps follow', () => {
    expect(workflow).toMatch(
      /\n  workflow_dispatch:\n {4}inputs:\n {6}channel:/
    );
    expect(workflow).toContain("CHANNEL: ${{ inputs.channel || 'preview' }}");
  });
});

describe('release timer workflow', () => {
  const workflow = readFileSync('.github/workflows/release-timer.yml', 'utf8');

  it('hands the workflows token to the branch updater when the secret is set', () => {
    expect(workflow).toContain(`secrets.${WORKFLOWS_TOKEN_SECRET}`);
    expect(workflow).toContain('getOctokit(process.env.WORKFLOWS_TOKEN)');
    expect(workflow).toContain('branchUpdater');
  });
});
