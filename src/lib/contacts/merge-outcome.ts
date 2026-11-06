export interface MergeFailure {
  label: string;
  reason: string;
}

export function mergeOutcomeMessage(
  merged: readonly string[],
  failed: readonly MergeFailure[]
): { tone: 'success' | 'warning' | 'error'; title: string; detail?: string } {
  if (failed.length === 0) {
    return {
      tone: 'success',
      title: `Merged ${merged.length + 1} contacts into one`,
    };
  }
  const detail = failed.map((f) => `${f.label}: ${f.reason}`).join('\n');
  if (merged.length === 0) {
    return { tone: 'error', title: 'Merge failed', detail };
  }
  return {
    tone: 'warning',
    title: `Merged ${merged.join(', ')}; ${failed.length} not merged`,
    detail,
  };
}
