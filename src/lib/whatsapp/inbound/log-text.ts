export function logText(value: unknown): string {
  return String(value ?? '').replace(/\n|\r/g, '');
}
