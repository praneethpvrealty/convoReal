const MANAGED_BRANCH = /^(agent|release)\//;
const DAY_MS = 86_400_000;

export const CLOSED_GRACE_DAYS = 7;
export const IDLE_DAYS = 14;

export function isManagedBranch(name) {
  return MANAGED_BRANCH.test(name);
}

function daysBetween(from, to) {
  return Math.floor((to - new Date(from).getTime()) / DAY_MS);
}

export function decideBranch({
  name,
  tipSha,
  tipDate,
  tipInDefault,
  openAsHead,
  openAsBase,
  closedPulls,
  now,
}) {
  if (!isManagedBranch(name))
    return { remove: false, reason: 'not an agent/ or release/ branch' };
  if (openAsHead) return { remove: false, reason: 'has an open pull request' };
  if (openAsBase)
    return { remove: false, reason: 'an open pull request targets it' };

  const reviewed = closedPulls.filter((pull) => pull.headSha === tipSha);
  const merged = reviewed.find((pull) => pull.mergedAt);
  if (merged) return { remove: true, reason: `merged in #${merged.number}` };

  if (reviewed.length > 0) {
    const lastClosed = reviewed.reduce((latest, pull) =>
      pull.closedAt > latest.closedAt ? pull : latest
    );
    const closedDays = daysBetween(lastClosed.closedAt, now);
    if (closedDays >= CLOSED_GRACE_DAYS) {
      return {
        remove: true,
        reason: `#${lastClosed.number} closed without merging ${closedDays} days ago`,
      };
    }
    return {
      remove: false,
      reason: `#${lastClosed.number} closed ${closedDays} days ago; kept for reopening`,
    };
  }

  if (tipInDefault)
    return { remove: true, reason: 'tip is already in the default branch' };

  const idleDays = daysBetween(tipDate, now);
  if (idleDays >= IDLE_DAYS)
    return {
      remove: true,
      reason: `no pull request for its tip and idle ${idleDays} days`,
    };
  return {
    remove: false,
    reason: `no pull request yet; idle ${idleDays} days`,
  };
}

async function openPullRefs(github, owner, repo) {
  const pulls = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  const heads = new Set();
  const bases = new Set();
  for (const pull of pulls) {
    if (pull.head.repo?.full_name === `${owner}/${repo}`)
      heads.add(pull.head.ref);
    bases.add(pull.base.ref);
  }
  return { heads, bases };
}

async function closedPullsFor(github, owner, repo, branch) {
  const pulls = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    head: `${owner}:${branch}`,
    per_page: 100,
  });
  return pulls.map((pull) => ({
    number: pull.number,
    headSha: pull.head.sha,
    mergedAt: pull.merged_at,
    closedAt: pull.closed_at,
  }));
}

async function tipIsInDefault(github, owner, repo, defaultBranch, sha) {
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${defaultBranch}...${sha}`,
    per_page: 1,
  });
  return data.status === 'identical' || data.status === 'behind';
}

async function namedBranch(github, owner, repo, name) {
  try {
    const { data } = await github.rest.repos.getBranch({
      owner,
      repo,
      branch: name,
    });
    return [{ name: data.name, commit: { sha: data.commit.sha } }];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function stillUnchanged(github, owner, repo, name, tipSha) {
  const [current] = await namedBranch(github, owner, repo, name);
  if (!current || current.commit.sha !== tipSha) return false;
  const [{ data: asHead }, { data: asBase }] = await Promise.all([
    github.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${name}`,
      per_page: 1,
    }),
    github.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      base: name,
      per_page: 1,
    }),
  ]);
  return asHead.length === 0 && asBase.length === 0;
}

/**
 * @param {{ github: any, context: any, core: any, only?: string | null, dryRun?: boolean, now?: number }} options
 */
export async function run({
  github,
  context,
  core,
  only = null,
  dryRun = false,
  now = Date.now(),
}) {
  const { owner, repo } = context.repo;
  const defaultBranch = context.payload.repository?.default_branch ?? 'main';
  const branches = only
    ? await namedBranch(github, owner, repo, only)
    : await github.paginate(github.rest.repos.listBranches, {
        owner,
        repo,
        per_page: 100,
      });
  const { heads, bases } = await openPullRefs(github, owner, repo);
  const removed = [];

  for (const branch of branches) {
    if (!isManagedBranch(branch.name)) continue;
    const tipSha = branch.commit.sha;
    const { data: tip } = await github.rest.repos.getCommit({
      owner,
      repo,
      ref: tipSha,
    });
    const decision = decideBranch({
      name: branch.name,
      tipSha,
      tipDate: tip.commit.committer.date,
      tipInDefault: await tipIsInDefault(
        github,
        owner,
        repo,
        defaultBranch,
        tipSha
      ),
      openAsHead: heads.has(branch.name),
      openAsBase: bases.has(branch.name),
      closedPulls: await closedPullsFor(github, owner, repo, branch.name),
      now,
    });

    if (!decision.remove) {
      core.info(`keep ${branch.name}: ${decision.reason}`);
      continue;
    }
    if (!dryRun) {
      const unchanged = await stillUnchanged(
        github,
        owner,
        repo,
        branch.name,
        tipSha
      );
      if (!unchanged) {
        core.info(`keep ${branch.name}: changed while the sweep ran`);
        continue;
      }
      await github.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch.name}`,
      });
    }
    removed.push(branch.name);
    core.notice(
      `${dryRun ? 'would delete' : 'deleted'} ${branch.name} at ${tipSha}: ${decision.reason}`
    );
  }

  core.info(
    `${dryRun ? 'Would delete' : 'Deleted'} ${removed.length} branch(es).`
  );
  return removed;
}
