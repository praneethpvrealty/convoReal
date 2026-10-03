import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(body: string, name: string): string {
  const match = body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
  expect(match).not.toBeNull();
  return match![1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  "html[data-mode='dark']",
  "html[data-mode='dark'][data-theme='verdant']",
])('%s secondary text', (selector) => {
  const body = block(selector);
  const surfaces = ['background', 'card', 'color-slate-900', 'color-slate-800'];

  it('[PRP-035] keeps text-slate-500 at WCAG AA on every surface', () => {
    const text = token(body, 'color-slate-500');
    for (const surface of surfaces) {
      expect(contrast(text, token(body, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('[PRP-035] keeps the slate ramp ordered from 400 to 500', () => {
    const l400 = luminance(token(body, 'color-slate-400'));
    const l450 = luminance(token(body, 'color-slate-450'));
    const l500 = luminance(token(body, 'color-slate-500'));
    expect(l400).toBeGreaterThan(l450);
    expect(l450).toBeGreaterThan(l500);
  });
});
