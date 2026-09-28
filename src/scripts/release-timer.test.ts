import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_WINDOW_MINUTES,
  REVIEW_SETTLE_MINUTES,
  decideRelease,
  run,
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
}) {
  const listBranches = vi.fn();
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
      compareCommitsWithBasehead: vi.fn(async () => {
        compares += 1;
        return { data: { behind_by: compares > 1 ? behindAtMerge : behindBy } };
      }),
    },
    pulls: {
      list: pullsList,
      get: vi.fn(async () => ({ data: { mergeable } })),
      create: vi.fn(async () => ({ data: { number: 50 } })),
      merge: vi.fn(async () => ({ data: { sha: 'merged' } })),
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
    issues: { listComments, createComment: vi.fn(async () => ({})) },
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
});
