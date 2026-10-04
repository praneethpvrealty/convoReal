import { describe, expect, it } from 'vitest';

import {
  ROOT_SCOPE,
  describeIssue,
  hasChildren,
  insertAt,
  mapAtPath,
  moveAt,
  parseIssuePath,
  pathInScope,
  removeAt,
  stepAtPath,
  type StepPath,
} from './step-tree';

interface Node {
  id: string;
  branches?: { yes: Node[]; no: Node[] };
}

const leaf = (id: string): Node => ({ id });
const cond = (id: string, yes: Node[] = [], no: Node[] = []): Node => ({
  id,
  branches: { yes, no },
});

const ids = (list: Node[] | undefined) => (list ?? []).map((n) => n.id);

function tree(): Node[] {
  return [
    cond('c', [leaf('y1'), leaf('y2'), leaf('y3')], [leaf('n1')]),
    leaf('r2'),
  ];
}

const conditionPath: StepPath = pathInScope(ROOT_SCOPE, 0);
const secondYes = pathInScope({ parent: conditionPath, branch: 'yes' }, 1);

describe('step tree paths inside a Yes branch', () => {
  it('addresses the second Yes step with one segment per level', () => {
    expect(secondYes).toEqual([
      { branch: null, index: 0 },
      { branch: 'yes', index: 1 },
    ]);
    expect(stepAtPath(tree(), secondYes)?.id).toBe('y2');
  });

  it('edits the second step of a Yes branch', () => {
    const next = mapAtPath(tree(), secondYes, (s) => ({ ...s, id: 'edited' }));
    expect(ids(next[0].branches?.yes)).toEqual(['y1', 'edited', 'y3']);
    expect(ids(next[0].branches?.no)).toEqual(['n1']);
    expect(ids(next)).toEqual(['c', 'r2']);
  });

  it('deletes the second step of a Yes branch', () => {
    const next = removeAt(tree(), secondYes);
    expect(ids(next[0].branches?.yes)).toEqual(['y1', 'y3']);
    expect(ids(next)).toEqual(['c', 'r2']);
  });

  it('moves the second step of a Yes branch up and down', () => {
    expect(ids(moveAt(tree(), secondYes, -1)[0].branches?.yes)).toEqual([
      'y2',
      'y1',
      'y3',
    ]);
    expect(ids(moveAt(tree(), secondYes, 1)[0].branches?.yes)).toEqual([
      'y1',
      'y3',
      'y2',
    ]);
  });

  it('leaves the tree unchanged when moving past either end', () => {
    const first = pathInScope({ parent: conditionPath, branch: 'yes' }, 0);
    const before = tree();
    expect(ids(moveAt(before, first, -1)[0].branches?.yes)).toEqual([
      'y1',
      'y2',
      'y3',
    ]);
  });
});

describe('insertAt', () => {
  it('inserts at the root', () => {
    expect(ids(insertAt(tree(), ROOT_SCOPE, 1, leaf('new')))).toEqual([
      'c',
      'new',
      'r2',
    ]);
  });

  it('inserts into a condition nested inside another condition', () => {
    const steps = [cond('outer', [leaf('a'), cond('inner', [leaf('x')], [])])];
    const innerPath = pathInScope(
      { parent: pathInScope(ROOT_SCOPE, 0), branch: 'yes' },
      1
    );
    const next = insertAt(
      steps,
      { parent: innerPath, branch: 'no' },
      0,
      leaf('deep')
    );
    const inner = stepAtPath(next, innerPath);
    expect(inner?.id).toBe('inner');
    expect(ids(inner?.branches?.no)).toEqual(['deep']);
    expect(ids(inner?.branches?.yes)).toEqual(['x']);
    expect(ids(next[0].branches?.yes)).toEqual(['a', 'inner']);
  });

  it('edits, deletes and moves inside a nested condition', () => {
    const steps = [
      cond('outer', [cond('inner', [leaf('p'), leaf('q')], [])], []),
    ];
    const innerScope = {
      parent: pathInScope(
        { parent: pathInScope(ROOT_SCOPE, 0), branch: 'yes' },
        0
      ),
      branch: 'yes' as const,
    };
    const q = pathInScope(innerScope, 1);
    const innerYes = (list: Node[]) =>
      ids(list[0].branches?.yes[0].branches?.yes);
    expect(innerYes(mapAtPath(steps, q, (s) => ({ ...s, id: 'Q' })))).toEqual([
      'p',
      'Q',
    ]);
    expect(innerYes(removeAt(steps, q))).toEqual(['p']);
    expect(innerYes(moveAt(steps, q, -1))).toEqual(['q', 'p']);
  });
});

describe('hasChildren', () => {
  it('is true only for a condition with at least one branch step', () => {
    expect(hasChildren(leaf('a'))).toBe(false);
    expect(hasChildren(cond('c'))).toBe(false);
    expect(hasChildren(cond('c', [], [leaf('n')]))).toBe(true);
  });
});

describe('validation issue paths', () => {
  it('parses nested step paths and their field', () => {
    expect(parseIssuePath('steps[0].yes.steps[1].tag_id')).toEqual({
      path: [
        { branch: null, index: 0 },
        { branch: 'yes', index: 1 },
      ],
      field: 'tag_id',
    });
    expect(parseIssuePath('steps[2]')).toEqual({
      path: [{ branch: null, index: 2 }],
      field: '',
    });
    expect(parseIssuePath('trigger.keywords')).toBeNull();
    expect(parseIssuePath('steps')).toBeNull();
  });

  it('round-trips with the tree so an issue lands on its step', () => {
    const parsed = parseIssuePath('steps[0].yes.steps[1].text');
    expect(parsed && stepAtPath(tree(), parsed.path)?.id).toBe('y2');
  });

  it('describes issues in plain words', () => {
    expect(
      describeIssue({
        path: 'steps[0].no.steps[0].text',
        message: 'message text is required',
      })
    ).toBe('Step 1 › No › step 1: message text is required');
    expect(
      describeIssue({
        path: 'trigger.keywords',
        message: 'at least one keyword is required',
      })
    ).toBe('Trigger: at least one keyword is required');
    expect(
      describeIssue({
        path: 'steps',
        message: 'active automations need at least one step',
      })
    ).toBe('active automations need at least one step');
  });
});
