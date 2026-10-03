import { describe, expect, it } from 'vitest';

import { previewSegments } from '@/lib/showcase/message-preview';

const url = 'https://example.com/s/abc';

describe('[PRP-034] showcase message preview', () => {
  it('fills the first name into {name}', () => {
    expect(
      previewSegments('Hi {name}!', { name: 'Asha Rao', portalUrl: url })
    ).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'name', text: 'Asha' },
      { kind: 'text', text: '!' },
    ]);
  });

  it('falls back to "there" when no name is known', () => {
    expect(
      previewSegments('Hi {name}!', { name: null, portalUrl: url })[1]
    ).toEqual({ kind: 'name', text: 'there' });
    expect(
      previewSegments('Hi {name}!', { name: '  ', portalUrl: url })[1]
    ).toEqual({ kind: 'name', text: 'there' });
  });

  it('fills the portal link into {portalUrl}', () => {
    expect(
      previewSegments('See {portalUrl}', { name: null, portalUrl: url })
    ).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: url },
    ]);
  });

  it('fills every occurrence of every token', () => {
    const segments = previewSegments('{name} {portalUrl} {name} {portalUrl}', {
      name: 'Ravi',
      portalUrl: url,
    });
    expect(segments.filter((s) => s.kind === 'name')).toHaveLength(2);
    expect(segments.filter((s) => s.kind === 'link')).toHaveLength(2);
    expect(segments.map((s) => s.text).join('')).toBe(
      `Ravi ${url} Ravi ${url}`
    );
  });

  it('returns a single text segment when there are no tokens', () => {
    expect(
      previewSegments('Plain text', { name: 'Ravi', portalUrl: url })
    ).toEqual([{ kind: 'text', text: 'Plain text' }]);
    expect(previewSegments('', { name: null, portalUrl: url })).toEqual([]);
  });
});
