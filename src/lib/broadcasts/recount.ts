export function contactsLabel(count: number): string {
  return `${count.toLocaleString('en-IN')} contact${count === 1 ? '' : 's'}`;
}

export type RecountOutcome =
  | { kind: 'failed' }
  | { kind: 'empty' }
  | { kind: 'changed'; count: number; label: string }
  | { kind: 'confirm'; count: number; label: string };

export function recountOutcome(
  result: { isError: boolean; data: number | undefined },
  shown?: number
): RecountOutcome {
  if (result.isError || result.data === undefined) return { kind: 'failed' };
  if (result.data <= 0) return { kind: 'empty' };
  const label = contactsLabel(result.data);
  if (shown !== undefined && result.data !== shown) {
    return { kind: 'changed', count: result.data, label };
  }
  return { kind: 'confirm', count: result.data, label };
}
