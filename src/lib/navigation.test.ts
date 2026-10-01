import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadTo } from './navigation';

describe('reloadTo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocation() {
    const assign = vi.fn();
    vi.stubGlobal('window', {
      location: { origin: 'https://www.convoreal.com', assign },
    });
    return assign;
  }

  it('does a full-page load of the path on the current origin', () => {
    const assign = stubLocation();
    reloadTo('/login');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0][0])).toBe(
      'https://www.convoreal.com/login'
    );
  });

  it('keeps the query string', () => {
    const assign = stubLocation();
    reloadTo('/join/abc%20123?invite=1');
    expect(String(assign.mock.calls[0][0])).toBe(
      'https://www.convoreal.com/join/abc%20123?invite=1'
    );
  });

  it('stays on the current origin when handed another one', () => {
    for (const url of ['//evil.example/phish', 'https://evil.example/']) {
      const assign = stubLocation();
      reloadTo(url);
      expect(String(assign.mock.calls[0][0])).toBe(
        'https://www.convoreal.com/'
      );
    }
  });
});
