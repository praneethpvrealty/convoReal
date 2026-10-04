import type { BuilderNode } from '@/components/flows/shared';
import { deriveCanvasEdges } from './edges';

export function graphWalkOrder(
  nodes: BuilderNode[],
  entryKey: string | null
): string[] {
  if (!entryKey || !nodes.some((n) => n.node_key === entryKey)) return [];
  const targets = new Map<string, string[]>();
  for (const edge of deriveCanvasEdges(nodes)) {
    const list = targets.get(edge.source) ?? [];
    list.push(edge.target);
    targets.set(edge.source, list);
  }
  const order: string[] = [];
  const seen = new Set([entryKey]);
  const queue = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    order.push(key);
    for (const next of targets.get(key) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return order;
}

export function orderFunnelRows<T extends { node_key: string }>(
  rows: T[],
  walk: string[]
): T[] {
  if (walk.length === 0) return rows;
  const rank = new Map(walk.map((key, i) => [key, i]));
  return rows
    .map((row, i) => ({ row, at: rank.get(row.node_key) ?? walk.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.row);
}
