const RELEASE_BRANCH = /^release\//;
const MINUTE_MS = 60_000;
const CODEX_LOGIN = 'chatgpt-codex-connector[bot]';
const HOLD_MARKER = 'release-timer:held';

export const RELEASE_WINDOW_MINUTES = 120;
export const REVIEW_SETTLE_MINUTES = 15;

function minutesSince(from, now) {
  return Math.floor((now - new Date(from).getTime()) / MINUTE_MS);
}

export function decideRelease({
  createdAt,
  mergedMembers,
  openMembers,
  releasePr,
  behindMain,
  ci,
  unresolvedThreads,
  codexRunning,
  mergeable,
  now,
}) {
  if (mergedMembers.length === 0) {
    return { action: 'wait', reason: 'no member pull request merged yet' };
  }

  const age = minutesSince(createdAt, now);
  if (age < RELEASE_WINDOW_MINUTES) {
    return {
      action: 'wait',
      reason: `batch window open; ships in ${RELEASE_WINDOW_MINUTES - age} min`,
    };
  }
  if (!releasePr) return { action: 'open-pr', reason: 'time limit reached' };
  if (mergeable === false) {
    return { action: 'hold', reason: 'merge conflict with main' };
  }
  if (behindMain > 0) {
    return {
      action: 'update-branch',
      reason: `${behindMain} commit(s) behind main; CI must test the combined tree`,
    };
  }
  if (!ci) return { action: 'run-ci', reason: 'no CI run on the release head' };
  if (ci.status !== 'completed')
    return { action: 'wait', reason: 'CI running' };
  if (ci.conclusion !== 'success') {
    return { action: 'hold', reason: `CI concluded ${ci.conclusion}` };
  }
  if (unresolvedThreads > 0) {
    return {
      action: 'hold',
      reason: `${unresolvedThreads} unresolved review thread(s)`,
    };
  }
  if (codexRunning) return { action: 'wait', reason: 'Codex review running' };
  if (minutesSince(releasePr.createdAt, now) < REVIEW_SETTLE_MINUTES) {
    return { action: 'wait', reason: 'giving review bots time to start' };
  }
  if (mergeable !== true) {
    return { action: 'wait', reason: 'GitHub is still computing mergeability' };
  }
  if (openMembers.length > 0 && age < 2 * RELEASE_WINDOW_MINUTES) {
    const numbers = openMembers.map((pull) => `#${pull.number}`).join(', ');
    return {
      action: 'wait',
      reason: `waiting for ${numbers}; ships without them in ${2 * RELEASE_WINDOW_MINUTES - age} min`,
    };
  }
  return {
    action: 'merge',
    reason: 'time limit reached and every gate passed',
  };
}

async function branchCreatedAt(github, owner, repo, branch, tipSha) {
  const { data } = await github.rest.repos.listActivities({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    activity_type: 'branch_creation',
    per_page: 1,
  });
  if (data[0]?.timestamp) return data[0].timestamp;
  const { data: tip } = await github.rest.repos.getCommit({
    owner,
    repo,
    ref: tipSha,
  });
  return tip.commit.committer.date;
}

async function latestCiRun(github, owner, repo, sha) {
  const { data } = await github.rest.checks.listForRef({
    owner,
    repo,
    ref: sha,
    check_name: 'CI',
    filter: 'latest',
  });
  const [latest] = data.check_runs.sort((a, b) =>
    (b.started_at ?? '').localeCompare(a.started_at ?? '')
  );
  if (latest) return { status: latest.status, conclusion: latest.conclusion };

  const {
    data: { workflow_runs: runs },
  } = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'ci.yml',
    head_sha: sha,
    per_page: 1,
  });
  return runs[0]
    ? { status: runs[0].status, conclusion: runs[0].conclusion }
    : null;
}

async function unresolvedThreadCount(github, owner, repo, number) {
  let unresolved = 0;
  let after = null;
  do {
    const result = await github.graphql(
      `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              nodes { isResolved }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { owner, repo, number, after }
    );
    const threads = result.repository.pullRequest.reviewThreads;
    unresolved += threads.nodes.filter((thread) => !thread.isResolved).length;
    after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (after);
  return unresolved;
}

async function prComments(github, owner, repo, number) {
  return github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
}

function codexIsRunning(comments) {
  return comments.some(
    (comment) =>
      comment.user?.login === CODEX_LOGIN &&
      comment.body?.includes('codex-pull-request-review-summary') &&
      comment.body.includes('**Running**')
  );
}

function releaseBody(branch, mergedMembers) {
  const lines = mergedMembers.map((pull) => `- #${pull.number} ${pull.title}`);
  return [
    `Release of \`${branch}\`, opened by the release timer after ${RELEASE_WINDOW_MINUTES} minutes.`,
    '',
    '## Members',
    '',
    ...lines,
    '',
    'The timer squash-merges this once CI is green, no review thread is unresolved and no Codex review is running.',
  ].join('\n');
}

async function openMembersOf(github, owner, repo, branch) {
  const { data } = await github.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    base: branch,
    per_page: 100,
  });
  return data;
}

async function carryOver(
  github,
  core,
  owner,
  repo,
  branch,
  openMembers,
  mainSha
) {
  const next = `${branch}-next`;
  try {
    await github.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${next}`,
      sha: mainSha,
    });
  } catch (error) {
    if (error.status !== 422) throw error;
  }
  for (const pull of openMembers) {
    await github.rest.pulls.update({
      owner,
      repo,
      pull_number: pull.number,
      base: next,
    });
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull.number,
      body: `\`${branch}\` passed its time limit and is frozen for release without this pull request, so it now targets \`${next}\`. Merge \`${next}\` into this branch before the next push; until then its diff may show changes from the earlier release.`,
    });
  }
  core.notice(`moved ${openMembers.length} open member(s) to ${next}`);
}

async function shipBranch({
  github,
  context,
  core,
  branch,
  allPulls,
  dryRun,
  now,
}) {
  const { owner, repo } = context.repo;
  const { data: head } = await github.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });
  const tipSha = head.commit.sha;

  const members = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'all',
    base: branch,
    per_page: 100,
  });
  const mergedMembers = members.filter((pull) => pull.merged_at);
  let openMembers = members.filter((pull) => pull.state === 'open');
  const createdAt = await branchCreatedAt(github, owner, repo, branch, tipSha);
  const overdue = minutesSince(createdAt, now) >= 2 * RELEASE_WINDOW_MINUTES;
  if (
    overdue &&
    openMembers.length > 0 &&
    mergedMembers.length > 0 &&
    !dryRun
  ) {
    const { data: mainHead } = await github.rest.repos.getBranch({
      owner,
      repo,
      branch: 'main',
    });
    await carryOver(
      github,
      core,
      owner,
      repo,
      branch,
      openMembers,
      mainHead.commit.sha
    );
    openMembers = [];
  }
  const openPr = allPulls.find(
    (pull) =>
      pull.head.ref === branch &&
      pull.head.repo?.full_name === `${owner}/${repo}` &&
      pull.base.ref === 'main'
  );
  const releasePr = openPr
    ? {
        number: openPr.number,
        createdAt: openPr.created_at,
        headSha: openPr.head.sha,
      }
    : null;

  let ci = null;
  let unresolvedThreads = 0;
  let codexRunning = false;
  let mergeable = null;
  let behindMain = 0;
  let comments = [];
  if (releasePr) {
    ({
      data: { behind_by: behindMain },
    } = await github.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `main...${releasePr.headSha}`,
      per_page: 1,
    }));
    ci = await latestCiRun(github, owner, repo, releasePr.headSha);
    unresolvedThreads = await unresolvedThreadCount(
      github,
      owner,
      repo,
      releasePr.number
    );
    comments = await prComments(github, owner, repo, releasePr.number);
    codexRunning = codexIsRunning(comments);
    ({
      data: { mergeable },
    } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: releasePr.number,
    }));
  }

  const decision = decideRelease({
    createdAt,
    mergedMembers,
    openMembers,
    releasePr,
    behindMain,
    ci,
    unresolvedThreads,
    codexRunning,
    mergeable,
    now,
  });
  core.info(`${branch}: ${decision.action} (${decision.reason})`);
  if (dryRun || decision.action === 'wait') return decision;

  if (decision.action === 'open-pr') {
    const { data: created } = await github.rest.pulls.create({
      owner,
      repo,
      head: branch,
      base: 'main',
      title: `Release ${branch.replace(RELEASE_BRANCH, '')}`,
      body: releaseBody(branch, mergedMembers),
    });
    core.notice(`opened release PR #${created.number} for ${branch}`);
    const {
      data: { behind_by: behindAtOpen },
    } = await github.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `main...${tipSha}`,
      per_page: 1,
    });
    if (behindAtOpen > 0) {
      try {
        await github.rest.pulls.updateBranch({
          owner,
          repo,
          pull_number: created.number,
          expected_head_sha: tipSha,
        });
        core.notice(`merged main into ${branch}; CI runs on the new head next`);
      } catch (error) {
        if (error.status !== 422) throw error;
        core.warning(
          `${branch}: main cannot be merged in cleanly; held next run`
        );
      }
      return decision;
    }
    await github.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: 'ci.yml',
      ref: branch,
    });
    return decision;
  }

  if (decision.action === 'run-ci') {
    await github.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: 'ci.yml',
      ref: branch,
    });
    core.notice(`started CI on ${branch}`);
    return decision;
  }

  const hold = async (reason) => {
    const marker = `<!-- ${HOLD_MARKER}:${releasePr.headSha} -->`;
    if (!comments.some((comment) => comment.body?.includes(marker))) {
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: releasePr.number,
        body: `${marker}\nThe release timer is holding this release: ${reason}. It merges automatically once that is fixed on a new push.`,
      });
    }
    core.warning(`${branch} held: ${reason}`);
    return { action: 'hold', reason };
  };

  if (decision.action === 'hold') return hold(decision.reason);

  if (decision.action === 'update-branch') {
    try {
      await github.rest.pulls.updateBranch({
        owner,
        repo,
        pull_number: releasePr.number,
        expected_head_sha: releasePr.headSha,
      });
    } catch (error) {
      if (error.status !== 422) throw error;
      return hold('main cannot be merged into the release branch cleanly');
    }
    core.notice(`merged main into ${branch}; CI runs on the new head next`);
    return decision;
  }

  const openNow = await openMembersOf(github, owner, repo, branch);
  if (openNow.length > 0) {
    const { data: mainHead } = await github.rest.repos.getBranch({
      owner,
      repo,
      branch: 'main',
    });
    await carryOver(
      github,
      core,
      owner,
      repo,
      branch,
      openNow,
      mainHead.commit.sha
    );
  }
  const { data: current } = await github.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });
  if (current.commit.sha !== releasePr.headSha) {
    return {
      action: 'wait',
      reason: 'release head moved; it is re-tested first',
    };
  }
  const {
    data: { behind_by: behindNow },
  } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `main...${releasePr.headSha}`,
    per_page: 1,
  });
  if (behindNow > 0) {
    return {
      action: 'wait',
      reason: 'main moved; the release is updated and re-tested first',
    };
  }

  let merged;
  try {
    ({ data: merged } = await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: releasePr.number,
      merge_method: 'squash',
      sha: releasePr.headSha,
      commit_title: `Release ${branch.replace(RELEASE_BRANCH, '')} (#${releasePr.number})`,
    }));
  } catch (error) {
    if (error.status === 405) {
      return hold(`GitHub refused the merge: ${error.message}`);
    }
    if (error.status !== 409) throw error;
    return {
      action: 'wait',
      reason: 'release head moved; it is re-tested first',
    };
  }
  core.notice(`merged ${branch} into main as ${merged.sha}`);
  await github.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: 'ci.yml',
    ref: 'main',
  });

  const stillOpen = await openMembersOf(github, owner, repo, branch);
  if (stillOpen.length > 0) {
    await carryOver(github, core, owner, repo, branch, stillOpen, merged.sha);
  }
  await github.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: 'branch-cleanup.yml',
    ref: 'main',
  });
  return decision;
}

/**
 * @param {{ github: any, context: any, core: any, dryRun?: boolean, now?: number }} options
 * @returns {Promise<Record<string, { action: string, reason: string }>>}
 */
export async function run({
  github,
  context,
  core,
  dryRun = false,
  now = Date.now(),
}) {
  const { owner, repo } = context.repo;
  const branches = (
    await github.paginate(github.rest.repos.listBranches, {
      owner,
      repo,
      per_page: 100,
    })
  ).filter((branch) => RELEASE_BRANCH.test(branch.name));
  const allPulls = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });

  /** @type {Record<string, { action: string, reason: string }>} */
  const results = {};
  for (const branch of branches) {
    try {
      results[branch.name] = await shipBranch({
        github,
        context,
        core,
        branch: branch.name,
        allPulls,
        dryRun,
        now,
      });
    } catch (error) {
      core.setFailed(`${branch.name}: ${error.message}`);
    }
  }
  return results;
}
