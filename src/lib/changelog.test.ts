import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bytes = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'));

describe('CHANGELOG.md', () => {
  it('is valid UTF-8', () => {
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ).not.toThrow();
  });

  it('has no control bytes other than tab and newline', () => {
    const offset = bytes.findIndex(
      (byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a
    );
    expect(offset).toBe(-1);
  });

  it('opens with the changelog heading', () => {
    expect(bytes.subarray(0, 12).toString('utf8')).toBe('# Changelog\n');
  });
});
