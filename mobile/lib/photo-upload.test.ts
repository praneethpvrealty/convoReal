import { describe, expect, it } from 'vitest';

import { restorePhoto, uploadEach, uploadProgressLabel } from './photo-upload';

describe('[UIX-011] uploadEach', () => {
  it('keeps uploading past a failure and reports what failed', async () => {
    const progress: string[] = [];
    const landed: string[] = [];
    const result = await uploadEach(
      ['a', 'b', 'c'],
      async (item) => {
        if (item === 'b') throw new Error('network');
        return `path/${item}`;
      },
      (done, total) => progress.push(`${done}/${total}`),
      (path) => landed.push(path)
    );
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    expect(landed).toEqual(['path/a', 'path/c']);
    expect(result).toEqual({
      uploaded: ['path/a', 'path/c'],
      failed: ['b'],
      lastError: 'network',
    });
  });
});

describe('[UIX-011] uploadProgressLabel', () => {
  it('counts a batch and stays short for one photo', () => {
    expect(uploadProgressLabel(3, 8)).toBe('Uploading 3 of 8');
    expect(uploadProgressLabel(1, 1)).toBe('Uploading…');
  });
});

describe('[UIX-011] restorePhoto', () => {
  it('puts an undone removal back where it was', () => {
    expect(restorePhoto(['a', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
    expect(restorePhoto(['a'], 'z', 5)).toEqual(['a', 'z']);
    expect(restorePhoto(['a', 'b'], 'b', 0)).toEqual(['a', 'b']);
  });
});
