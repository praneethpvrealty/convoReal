export type ImportCountMap = Record<string, number>;

export function importCountLabel(count: number): string {
  return `Shared by ${count} ${count === 1 ? 'agent' : 'agents'}`;
}
