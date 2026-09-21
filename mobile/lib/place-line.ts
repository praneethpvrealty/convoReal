export function placeLine(...parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const segment of (part ?? '').split(',')) {
      const trimmed = segment.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out.join(', ');
}
