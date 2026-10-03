export function logText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ');
}
