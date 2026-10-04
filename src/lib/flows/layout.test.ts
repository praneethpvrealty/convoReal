import { describe, it, expect } from 'vitest';
import { autoLayout, layoutUnpositioned, shouldAutoLayout } from './layout';

describe('shouldAutoLayout', () => {
  it('returns false for an empty list', () => {
    expect(shouldAutoLayout([])).toBe(false);
  });

  it('returns true when every node sits at 0,0', () => {
    expect(
      shouldAutoLayout([
        { position_x: 0, position_y: 0 },
        { position_x: 0, position_y: 0 },
      ])
    ).toBe(true);
  });

  it('treats null / undefined positions as 0,0', () => {
    expect(shouldAutoLayout([{ position_x: null, position_y: null }, {}])).toBe(
      true
    );
  });

  it('returns false if any node has a non-zero position (mid-edit guard)', () => {
    expect(
      shouldAutoLayout([
        { position_x: 0, position_y: 0 },
        { position_x: 200, position_y: 50 },
      ])
    ).toBe(false);
  });
});

describe('autoLayout', () => {
  it('returns a position for every input node', () => {
    const positions = autoLayout(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ]
    );
    expect(positions.size).toBe(3);
    expect(positions.has('a')).toBe(true);
    expect(positions.has('b')).toBe(true);
    expect(positions.has('c')).toBe(true);
  });

  it('lays a linear chain top-to-bottom by default', () => {
    const positions = autoLayout(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ]
    );
    const a = positions.get('a')!;
    const b = positions.get('b')!;
    const c = positions.get('c')!;
    // TB direction => y increases down the chain.
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it('spreads branch targets horizontally on the same rank', () => {
    const positions = autoLayout(
      [{ id: 'root' }, { id: 'left' }, { id: 'right' }],
      [
        { source: 'root', target: 'left' },
        { source: 'root', target: 'right' },
      ]
    );
    const left = positions.get('left')!;
    const right = positions.get('right')!;
    // Same rank => same y; different positions horizontally.
    expect(left.y).toBe(right.y);
    expect(left.x).not.toBe(right.x);
  });

  it("ignores edges whose endpoints aren't in the node list", () => {
    // Defensive — the canvas filters dangling edges but the helper
    // shouldn't blow up if a stale edge slips through.
    const positions = autoLayout(
      [{ id: 'only' }],
      [
        { source: 'only', target: 'ghost' },
        { source: 'phantom', target: 'only' },
      ]
    );
    expect(positions.size).toBe(1);
    expect(positions.get('only')).toBeDefined();
  });

  it('respects custom node widths when computing positions', () => {
    const narrow = autoLayout(
      [
        { id: 'a', width: 100, height: 50 },
        { id: 'b', width: 100, height: 50 },
      ],
      [{ source: 'a', target: 'b' }]
    );
    const wide = autoLayout(
      [
        { id: 'a', width: 400, height: 50 },
        { id: 'b', width: 400, height: 50 },
      ],
      [{ source: 'a', target: 'b' }]
    );
    // Wider nodes don't shift vertical spacing on a single chain
    // (rank gap is fixed) but they DO offset x to keep nodes centered.
    expect(narrow.get('a')!.y).toBe(wide.get('a')!.y);
  });
});

describe('layoutUnpositioned', () => {
  const nodes = [
    { node_key: 'start' },
    { node_key: 'menu', position_x: 0, position_y: 0 },
    { node_key: 'yes' },
    { node_key: 'no' },
  ];
  const edges = [
    { source: 'start', target: 'menu' },
    { source: 'menu', target: 'yes' },
    { source: 'menu', target: 'no' },
  ];

  it('nodes with no positions get laid out and keep them after one is moved', () => {
    const laid = layoutUnpositioned(nodes, edges);
    expect(shouldAutoLayout(laid)).toBe(false);
    const byKey = new Map(laid.map((n) => [n.node_key, n]));
    expect(byKey.get('start')!.position_y).toBeLessThan(
      byKey.get('menu')!.position_y!
    );
    expect(byKey.get('yes')!.position_x).not.toBe(byKey.get('no')!.position_x);

    const moved = laid.map((n) =>
      n.node_key === 'yes' ? { ...n, position_x: 900, position_y: 900 } : n
    );
    const relaid = layoutUnpositioned(moved, edges);
    expect(relaid).toBe(moved);
    for (const n of relaid) {
      if (n.node_key === 'yes') continue;
      expect(n.position_x).toBe(byKey.get(n.node_key)!.position_x);
      expect(n.position_y).toBe(byKey.get(n.node_key)!.position_y);
    }
  });

  it('returns the same array when a node already has a position', () => {
    const placed = [
      { node_key: 'a', position_x: 40, position_y: 10 },
      { node_key: 'b' },
    ];
    expect(layoutUnpositioned(placed, [{ source: 'a', target: 'b' }])).toBe(
      placed
    );
  });

  it('returns the same array for a single node at the origin so the canvas writes nothing', () => {
    const single = [{ node_key: 'only', position_x: 0, position_y: 0 }];
    expect(shouldAutoLayout(single)).toBe(true);
    const first = layoutUnpositioned(single, []);
    expect(first).toBe(single);
    expect(layoutUnpositioned(first, [])).toBe(first);
  });

  it('settles after one layout pass', () => {
    const laid = layoutUnpositioned(nodes, edges);
    expect(laid).not.toBe(nodes);
    expect(layoutUnpositioned(laid, edges)).toBe(laid);
  });

  it('writes whole-pixel positions', () => {
    for (const n of layoutUnpositioned(nodes, edges)) {
      expect(Number.isInteger(n.position_x)).toBe(true);
      expect(Number.isInteger(n.position_y)).toBe(true);
    }
  });
});
