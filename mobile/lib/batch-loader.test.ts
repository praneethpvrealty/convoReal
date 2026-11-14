import { describe, expect, it, vi } from 'vitest';

import { createBatchLoader } from './batch-loader';

describe('createBatchLoader', () => {
  it('resolves every key asked for in one window with a single fetch', async () => {
    const fetchMany = vi.fn(async (keys: string[]) => {
      return new Map(keys.map((k) => [k, `value-${k}`]));
    });
    const load = createBatchLoader(fetchMany, { windowMs: 1 });

    const results = await Promise.all([load('a'), load('b'), load('a')]);

    expect(results).toEqual(['value-a', 'value-b', 'value-a']);
    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany).toHaveBeenCalledWith(['a', 'b']);
  });

  it('resolves a key the fetch did not return as null', async () => {
    const load = createBatchLoader(async () => new Map([['a', 1]]), {
      windowMs: 1,
    });

    expect(await Promise.all([load('a'), load('missing')])).toEqual([1, null]);
  });

  it('starts a new fetch for keys asked for after the window closed', async () => {
    const fetchMany = vi.fn(async (keys: string[]) => {
      return new Map(keys.map((k) => [k, k]));
    });
    const load = createBatchLoader(fetchMany, { windowMs: 1 });

    await load('a');
    await load('b');

    expect(fetchMany).toHaveBeenCalledTimes(2);
    expect(fetchMany).toHaveBeenLastCalledWith(['b']);
  });

  it('rejects every waiter when the fetch fails, and recovers afterwards', async () => {
    let fail = true;
    const load = createBatchLoader(
      async (keys: string[]) => {
        if (fail) throw new Error('offline');
        return new Map(keys.map((k) => [k, k]));
      },
      { windowMs: 1 }
    );

    await expect(Promise.all([load('a'), load('b')])).rejects.toThrow(
      'offline'
    );
    fail = false;
    expect(await load('a')).toBe('a');
  });

  it('splits a window larger than maxBatch so no key is dropped', async () => {
    const fetchMany = vi.fn(async (keys: string[]) => {
      return new Map(keys.map((k) => [k, k]));
    });
    const load = createBatchLoader(fetchMany, { windowMs: 1, maxBatch: 2 });

    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(load));

    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchMany.mock.calls.map(([keys]) => keys)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });
});
