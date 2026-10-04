export type BranchKey = 'yes' | 'no';

export interface PathSegment {
  branch: BranchKey | null;
  index: number;
}

export type StepPath = PathSegment[];

export interface ListScope {
  parent: StepPath;
  branch: BranchKey | null;
}

export interface TreeStep {
  branches?: { yes: TreeStep[]; no: TreeStep[] };
}

export const ROOT_SCOPE: ListScope = { parent: [], branch: null };

export function pathInScope(scope: ListScope, index: number): StepPath {
  return [...scope.parent, { branch: scope.branch, index }];
}

function scopeOf(path: StepPath): ListScope {
  return {
    parent: path.slice(0, -1),
    branch: path[path.length - 1].branch,
  };
}

export function stepAtPath<T extends TreeStep>(
  steps: T[],
  path: StepPath
): T | undefined {
  let list: TreeStep[] = steps;
  let found: TreeStep | undefined;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (i > 0) {
      if (!found?.branches || !seg.branch) return undefined;
      list = found.branches[seg.branch];
    }
    found = list[seg.index];
    if (!found) return undefined;
  }
  return found as T | undefined;
}

export function mapAtPath<T extends TreeStep>(
  steps: T[],
  path: StepPath,
  updater: (s: T) => T
): T[] {
  if (path.length === 0) return steps;
  const [head, ...rest] = path;
  if (!steps[head.index]) return steps;
  return steps.map((s, i) => {
    if (i !== head.index) return s;
    if (rest.length === 0) return updater(s);
    const branch = rest[0].branch;
    if (!branch || !s.branches) return s;
    return {
      ...s,
      branches: {
        ...s.branches,
        [branch]: mapAtPath(s.branches[branch] as T[], rest, updater),
      },
    };
  });
}

function mapList<T extends TreeStep>(
  steps: T[],
  scope: ListScope,
  fn: (list: T[]) => T[]
): T[] {
  if (scope.parent.length === 0) return scope.branch ? steps : fn(steps);
  const branch = scope.branch;
  if (!branch) return steps;
  return mapAtPath(steps, scope.parent, (s) =>
    s.branches
      ? {
          ...s,
          branches: {
            ...s.branches,
            [branch]: fn(s.branches[branch] as T[]),
          },
        }
      : s
  );
}

export function insertAt<T extends TreeStep>(
  steps: T[],
  scope: ListScope,
  index: number,
  node: T
): T[] {
  return mapList(steps, scope, (list) => {
    const copy = [...list];
    copy.splice(index, 0, node);
    return copy;
  });
}

export function removeAt<T extends TreeStep>(steps: T[], path: StepPath): T[] {
  if (path.length === 0) return steps;
  const index = path[path.length - 1].index;
  return mapList(steps, scopeOf(path), (list) =>
    list.filter((_, i) => i !== index)
  );
}

export function moveAt<T extends TreeStep>(
  steps: T[],
  path: StepPath,
  direction: -1 | 1
): T[] {
  if (path.length === 0) return steps;
  const i = path[path.length - 1].index;
  const j = i + direction;
  return mapList(steps, scopeOf(path), (list) => {
    if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
}

export function hasChildren(step: TreeStep): boolean {
  return (step.branches?.yes.length ?? 0) + (step.branches?.no.length ?? 0) > 0;
}

export function parseIssuePath(
  issuePath: string
): { path: StepPath; field: string } | null {
  const m = /^((?:steps\[\d+\]\.(?:yes|no)\.)*steps\[\d+\])(?:\.(.+))?$/.exec(
    issuePath
  );
  if (!m) return null;
  const path: StepPath = [];
  for (const seg of m[1].matchAll(/(?:(yes|no)\.)?steps\[(\d+)\]/g)) {
    path.push({
      branch: (seg[1] as BranchKey | undefined) ?? null,
      index: Number(seg[2]),
    });
  }
  return { path, field: m[2] ?? '' };
}

export function pathLabel(path: StepPath): string {
  return path
    .map((seg) =>
      seg.branch
        ? `${seg.branch === 'yes' ? 'Yes' : 'No'} › step ${seg.index + 1}`
        : `Step ${seg.index + 1}`
    )
    .join(' › ');
}

export function describeIssue(issue: {
  path: string;
  message: string;
}): string {
  const parsed = parseIssuePath(issue.path);
  if (parsed) return `${pathLabel(parsed.path)}: ${issue.message}`;
  if (issue.path.startsWith('trigger')) return `Trigger: ${issue.message}`;
  return issue.message;
}
