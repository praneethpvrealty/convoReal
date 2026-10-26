// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Property } from '@/types';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseBase: vi.fn(async () => 'https://brokers.convoreal.com/'),
}));

import { PropertyActionsMenu } from './property-actions-menu';

const property = (overrides: Partial<Property> = {}) =>
  ({
    id: 'p1',
    account_id: 'acct-1',
    property_code: 'CR-101',
    title: 'Sarjapur Villa',
    status: 'Available',
    is_published: true,
    ...overrides,
  }) as unknown as Property;

const writeText = vi.fn(async () => {});

beforeEach(() => {
  writeText.mockClear();
  toastSuccess.mockClear();
  vi.stubGlobal('ClipboardItem', undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openMenu(p: Property) {
  render(
    <PropertyActionsMenu
      property={p}
      canEdit
      onEdit={() => {}}
      onDelete={() => {}}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: `More actions for ${p.title}` })
  );
}

describe('PropertyActionsMenu showcase link', () => {
  it('[PRP-052] copies the listing showcase link without the internal marker', async () => {
    openMenu(property());
    fireEvent.click(await screen.findByText('Copy showcase link'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://brokers.convoreal.com/?property_id=CR-101'
      )
    );
    expect(toastSuccess).toHaveBeenCalledWith('Showcase link copied');
  });

  it('[PRP-052] offers no showcase link for a listing the showcase does not list', async () => {
    openMenu(property({ status: 'Sold' }));
    expect(await screen.findByText('Not on showcase')).toBeTruthy();
    expect(screen.queryByText('Copy showcase link')).toBeNull();
  });
});
