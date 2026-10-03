export type DurationUnit = 's' | 'm' | 'h';

export function durationUnit(minutes: number): DurationUnit {
  if (minutes < 1) return 's';
  if (minutes < 60) return 'm';
  return 'h';
}

const trim = (value: number) => String(Number(value.toFixed(1)));

export function formatDuration(
  minutes: number | null,
  unit: DurationUnit = durationUnit(minutes ?? 0)
): string {
  if (minutes == null) return '—';
  if (unit === 's') return `${Math.round(minutes * 60)}s`;
  if (unit === 'm') return `${trim(minutes)}m`;
  return `${trim(minutes / 60)}h`;
}
