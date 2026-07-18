import type { LiaisonService } from '@/types';

/** Max services one person can carry — a directory card, not a rate card. */
const MAX_SERVICES = 30;

export function sanitizeServices(value: unknown): LiaisonService[] {
  if (!Array.isArray(value)) return [];
  const out: LiaisonService[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { name, fee, fee_note } = item as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    out.push({
      name: name.trim(),
      fee:
        typeof fee === 'number' && Number.isFinite(fee) && fee >= 0
          ? fee
          : null,
      fee_note: typeof fee_note === 'string' ? fee_note.trim() || null : null,
    });
    if (out.length >= MAX_SERVICES) break;
  }
  return out;
}
