// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { BOARD_LAYOUT_STORAGE_KEY } from '@/lib/pipelines/board-layout';
import { useBoardLayout } from './useBoardLayout';

afterEach(() => {
  localStorage.clear();
});

describe('[PIPE-001] useBoardLayout', () => {
  it('reads a stored wheel layout after mount', async () => {
    localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, 'wheel');
    const { result } = renderHook(() => useBoardLayout());
    await waitFor(() => expect(result.current[0]).toBe('wheel'));
  });

  it('falls back to flat when the stored value is garbage', async () => {
    localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, 'carousel');
    const { result } = renderHook(() => useBoardLayout());
    await act(async () => {});
    expect(result.current[0]).toBe('flat');
  });

  it('remembers a new choice', async () => {
    const { result } = renderHook(() => useBoardLayout());
    act(() => result.current[1]('wheel'));
    expect(result.current[0]).toBe('wheel');
    expect(localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY)).toBe('wheel');
  });
});
