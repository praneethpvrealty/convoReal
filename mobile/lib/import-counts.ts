// Port of the web's src/lib/inventory/import-activity.ts count helpers,
// so the "Shared by N agents" chip reads identically on both surfaces.
// src/lib/mobile-parity.test.ts pins the wording.

export type ImportCountMap = Record<string, number>;

export function importCountLabel(count: number): string {
  return `Shared by ${count} ${count === 1 ? 'agent' : 'agents'}`;
}
