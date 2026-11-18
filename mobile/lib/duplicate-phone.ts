export const DUPLICATE_PHONE = 'DUPLICATE_PHONE';

export function isDuplicatePhone(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === DUPLICATE_PHONE
  );
}

export function existingContactIdFrom(err: unknown): string | null {
  if (!isDuplicatePhone(err)) return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
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
