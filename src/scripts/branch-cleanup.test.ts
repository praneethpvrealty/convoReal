import { describe, expect, it, vi } from 'vitest';
import {
  CLOSED_GRACE_DAYS,
  IDLE_DAYS,
  decideBranch,
  isManagedBranch,
  run,
} from './branch-cleanup.mjs';

const NOW = Date.parse('2026-09-28T00:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

const base = {
  name: 'agent/example',
  tipSha: 'tip',
  tipDate: daysAgo(1),
  tipInDefault: false,
  openAsHead: false,
  openAsBase: false,
  closedPulls: [] as {
    number: number;
    headSha: string;
    mergedAt: string | null;
    closedAt: string;
  }[],
  now: NOW,
};

describe('isManagedBranch', () => {
  it('manages only agent/ and release/ branches', () => {
    expect(isManagedBranch('agent/fix')).toBe(true);
    expect(isManagedBranch('release/batch')).toBe(true);
    expect(isManagedBranch('main')).toBe(false);
    expect(isManagedBranch('claude/session')).toBe(false);
    expect(isManagedBranch('my-agent/fix')).toBe(false);
  });
});

describe('decideBranch', () => {
  it('never touches unmanaged branches, even stale ones', () => {
    expect(
      decideBranch({
        ...base,
        name: 'main',
        tipDate: daysAgo(400),
        tipInDefault: true,
      }).remove
    ).toBe(false);
  });

  it('keeps a branch with an open pull request', () => {
    const closedPulls = [
      { number: 1, headSha: 'tip', mergedAt: daysAgo(2), closedAt: daysAgo(2) },
    ];
    expect(
      decideBranch({ ...base, openAsHead: true, closedPulls }).remove
    ).toBe(false);
  });

  it('keeps a release branch that open member pull requests still target', () => {
    const closedPulls = [
      { number: 2, headSha: 'tip', mergedAt: daysAgo(1), closedAt: daysAgo(1) },
    ];
    expect(
      decideBranch({
        ...base,
        name: 'release/batch',
        openAsBase: true,
        closedPulls,
      }).remove
    ).toBe(false);
  });

  it('deletes a branch whose tip was merged', () => {
    const closedPulls = [
      { number: 3, headSha: 'tip', mergedAt: daysAgo(0), closedAt: daysAgo(0) },
    ];
    expect(decideBranch({ ...base, closedPulls })).toEqual({
      remove: true,
      reason: 'merged in #3',
    });
  });

  it('keeps commits pushed after the merged pull request until they go idle', () => {
    const closedPulls = [
      {
        number: 4,
        headSha: 'older',
        mergedAt: daysAgo(3),
        closedAt: daysAgo(3),
      },
    ];
    expect(decideBranch({ ...base, closedPulls }).remove).toBe(false);
    expect(
      decideBranch({ ...base, closedPulls, tipDate: daysAgo(IDLE_DAYS) }).remove
    ).toBe(true);
  });

  it('keeps a pull request closed without merging for a grace period', () => {
    const recent = [
      {
        number: 5,
        headSha: 'tip',
        mergedAt: null,
        closedAt: daysAgo(CLOSED_GRACE_DAYS - 1),
      },
    ];
    const old = [
      {
        number: 5,
        headSha: 'tip',
        mergedAt: null,
        closedAt: daysAgo(CLOSED_GRACE_DAYS),
      },
    ];
    expect(decideBranch({ ...base, closedPulls: recent }).remove).toBe(false);
    expect(decideBranch({ ...base, closedPulls: old }).remove).toBe(true);
  });

  it('deletes a branch without a pull request whose tip is already in the default branch', () => {
    expect(decideBranch({ ...base, tipInDefault: true })).toEqual({
      remove: true,
      reason: 'tip is already in the default branch',
    });
  });

  it('keeps fresh unreviewed work and deletes it once idle', () => {
    expect(
      decideBranch({ ...base, tipDate: daysAgo(IDLE_DAYS - 1) }).remove
    ).toBe(false);
    expect(decideBranch({ ...base, tipDate: daysAgo(IDLE_DAYS) }).remove).toBe(
      true
    );
  });
});

function fakeGithub({
  branches,
  openPulls = [],
  closedPulls = {},
  status = 'diverged',
}: {
  branches: { name: string; sha: string }[];
  openPulls?: { headRef: string; baseRef: string }[];
  closedPulls?: Record<
    string,
    {
      number: number;
      sha: string;
      merged_at: string | null;
      closed_at: string;
    }[]
  >;
  status?: string;
}) {
  const listBranches = vi.fn();
  const list = vi.fn();
  const deleteRef = vi.fn(async () => ({}));
  const getBranch = vi.fn(async ({ branch }: { branch: string }) => {
    const found = branches.find((candidate) => candidate.name === branch);
    if (!found) throw Object.assign(new Error('Not Found'), { status: 404 });
    return { data: { name: found.name, commit: { sha: found.sha } } };
  });
  const paginate = vi.fn(
    async (method: unknown, params: { state?: string; head?: string }) => {
      if (method === listBranches)
        return branches.map((branch) => ({
          name: branch.name,
          commit: { sha: branch.sha },
        }));
      if (params.state === 'open') {
        return openPulls.map((pull) => ({
          head: { ref: pull.headRef, repo: { full_name: 'owner/repo' } },
          base: { ref: pull.baseRef },
        }));
      }
      const branch = params.head!.split(':')[1];
      return (closedPulls[branch] ?? []).map((pull) => ({
        ...pull,
        head: { sha: pull.sha },
      }));
    }
  );
  return {
    github: {
      paginate,
      rest: {
        pulls: { list },
        repos: {
          listBranches,
          getBranch,
          getCommit: vi.fn(async () => ({
            data: { commit: { committer: { date: daysAgo(1) } } },
          })),
          compareCommitsWithBasehead: vi.fn(async () => ({ data: { status } })),
        },
        git: { deleteRef },
      },
    },
    deleteRef,
  };
}

const context = {
  repo: { owner: 'owner', repo: 'repo' },
  payload: { repository: { default_branch: 'main' } },
};
const core = { info: vi.fn(), notice: vi.fn() };

describe('run', () => {
  it('sweeps only finished managed branches', async () => {
    const { github, deleteRef } = fakeGithub({
      branches: [
        { name: 'main', sha: 'm' },
        { name: 'agent/merged', sha: 'a1' },
        { name: 'agent/in-review', sha: 'a2' },
        { name: 'release/batch', sha: 'r1' },
      ],
      openPulls: [{ headRef: 'agent/in-review', baseRef: 'release/batch' }],
      closedPulls: {
        'agent/merged': [
          {
            number: 9,
            sha: 'a1',
            merged_at: daysAgo(0),
            closed_at: daysAgo(0),
          },
        ],
      },
    });

    const removed = await run({ github, context, core, now: NOW });

    expect(removed).toEqual(['agent/merged']);
    expect(deleteRef).toHaveBeenCalledTimes(1);
    expect(deleteRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'heads/agent/merged',
    });
  });

  it('reports without deleting on a dry run', async () => {
    const { github, deleteRef } = fakeGithub({
      branches: [{ name: 'agent/done', sha: 'd' }],
      status: 'identical',
    });

    expect(
      await run({ github, context, core, dryRun: true, now: NOW })
    ).toEqual(['agent/done']);
    expect(deleteRef).not.toHaveBeenCalled();
  });

  it('checks just the merged branch and tolerates it already being gone', async () => {
    const { github, deleteRef } = fakeGithub({
      branches: [
        { name: 'agent/one', sha: 'o' },
        { name: 'agent/other', sha: 'x' },
      ],
      closedPulls: {
        'agent/one': [
          {
            number: 10,
            sha: 'o',
            merged_at: daysAgo(0),
            closed_at: daysAgo(0),
          },
        ],
      },
      status: 'identical',
    });

    expect(
      await run({ github, context, core, only: 'agent/one', now: NOW })
    ).toEqual(['agent/one']);
    expect(
      await run({ github, context, core, only: 'agent/missing', now: NOW })
    ).toEqual([]);
    expect(deleteRef).toHaveBeenCalledTimes(1);
  });
});
