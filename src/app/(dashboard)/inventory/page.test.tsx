// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const replace = vi.fn();
let search = '';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock('@/lib/navigation', () => ({ pushUrl: vi.fn() }));
vi.mock('./inventory-content', () => ({
  default: () => <div>inventory-list</div>,
}));
vi.mock('./projects-content', () => ({
  default: () => <div>projects-view</div>,
}));
vi.mock('@/components/layout/favorite-button', () => ({
  FavoriteButton: () => null,
}));

import InventoryPage from './page';

beforeEach(() => {
  replace.mockReset();
  search = '';
  vi.stubEnv('NEXT_PUBLIC_META_ADS_APP_ID', 'meta-app-1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('InventoryPage — ads', () => {
  it('[PRP-032] has no Ads Campaigns tab even when Meta Ads is enabled', () => {
    render(<InventoryPage />);
    expect(screen.queryByText('Ads Campaigns')).toBeNull();
    expect(screen.getByText('Inventory List')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('[PRP-032] sends the legacy ?tab=ads link to /ads', () => {
    search = 'tab=ads';
    render(<InventoryPage />);
    expect(replace).toHaveBeenCalledWith('/ads');
  });
});
