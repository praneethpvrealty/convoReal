import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('QuotedMessage layout', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/message-bubble.tsx'),
    'utf8'
  );
  const start = source.indexOf('export function QuotedMessage(');
  const body = source.slice(start, source.indexOf('\nexport ', start + 1));

  it('keeps the quote text column in the bubble width', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/\bflex:\s*1\b/);
    expect(body).toMatch(/flexGrow:\s*1,\s*flexShrink:\s*1/);
  });
});
