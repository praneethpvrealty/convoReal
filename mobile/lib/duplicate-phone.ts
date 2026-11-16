export const DUPLICATE_PHONE = 'DUPLICATE_PHONE';

export function existingContactIdFrom(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const { code, data } = err as { code?: unknown; data?: unknown };
  if (code !== DUPLICATE_PHONE || !data || typeof data !== 'object') {
    return null;
  }
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

export function importSummary(counts: {
  ok: number;
  existing: number;
  failed: number;
  failureReason: string;
}): string {
  const { ok, existing, failed, failureReason } = counts;
  const parts = [`Imported ${ok} contact${ok === 1 ? '' : 's'}`];
  if (existing) parts.push(`${existing} already saved`);
  if (failed) parts.push(`${failed} failed (${failureReason})`);
  return parts.join(' · ');
}
