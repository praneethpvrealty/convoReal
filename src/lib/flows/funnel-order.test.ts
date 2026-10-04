import { describe, expect, it } from 'vitest';
import type { BuilderNode } from '@/components/flows/shared';
import { graphWalkOrder, orderFunnelRows } from './funnel-order';

const nodes: BuilderNode[] = [
  { node_key: 'bye', node_type: 'end', config: {} },
  {
    node_key: 'menu',
    node_type: 'send_buttons',
    config: {
      text: 'Pick one',
      buttons: [
        { reply_id: 'buy', title: 'Buy', next_node_key: 'agent' },
        { reply_id: 'no', title: 'No', next_node_key: 'bye' },
      ],
    },
  },
  { node_key: 'start', node_type: 'start', config: { next_node_key: 'menu' } },
  { node_key: 'agent', node_type: 'handoff', config: {} },
  { node_key: 'orphan', node_type: 'end', config: {} },
];

describe('graphWalkOrder', () => {
  it('walks breadth-first from the entry node along config edges', () => {
    expect(graphWalkOrder(nodes, 'start')).toEqual([
      'start',
      'menu',
      'agent',
      'bye',
    ]);
  });

  it('returns nothing without a known entry node', () => {
    expect(graphWalkOrder(nodes, null)).toEqual([]);
    expect(graphWalkOrder(nodes, 'missing')).toEqual([]);
  });
});

describe('orderFunnelRows', () => {
  const rows = [
    { node_key: 'start', runs_entered: 10 },
    { node_key: 'bye', runs_entered: 7 },
    { node_key: 'orphan', runs_entered: 5 },
    { node_key: 'menu', runs_entered: 9 },
    { node_key: 'agent', runs_entered: 2 },
  ];

  it('orders rows by the graph walk and keeps unreached nodes last in count order', () => {
    expect(
      orderFunnelRows(rows, graphWalkOrder(nodes, 'start')).map(
        (r) => r.node_key
      )
    ).toEqual(['start', 'menu', 'agent', 'bye', 'orphan']);
  });

  it('keeps the incoming order when there is no walk', () => {
    expect(orderFunnelRows(rows, [])).toBe(rows);
  });
});
