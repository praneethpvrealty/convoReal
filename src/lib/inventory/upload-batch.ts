export interface FailedUpload {
  name: string;
  reason: string;
}

export function documentTitleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  return stem || base.trim();
}

export function uploadFailureSummary(
  failed: readonly FailedUpload[],
  noun: 'photo' | 'document'
): string | null {
  if (failed.length === 0) return null;
  if (failed.length === 1) {
    return `Couldn't upload "${failed[0].name}": ${failed[0].reason}`;
  }
  const names = failed.map((f) => `"${f.name}"`);
  const shown =
    names.length > 3
      ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      : names.join(', ');
  return `Couldn't upload ${failed.length} ${noun}s: ${shown}`;
}
