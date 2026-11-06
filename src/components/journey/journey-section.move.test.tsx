// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { JourneyItem, JourneyStage } from '@/types';

const STAGES = [
  { id: 's1', name: 'Shared', position: 0, color: '#fff' },
  { id: 's2', name: 'Visited', position: 1, color: '#fff' },
  { id: 's3', name: 'Negotiating', position: 2, color: '#fff' },
] as JourneyStage[];

const ITEM = {
  id: 'item-1',
  contact_id: 'c1',
  property_id: 'p1',
  stage_id: 's1',
  status: 'active',
  property: { id: 'p1', title: 'Lake View Flat' },
} as unknown as JourneyItem;

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = {
        data: table === 'journey_items' ? [ITEM] : [],
        count: 0,
        error: null,
      };
      const chain: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'neq',
        'in',
        'is',
        'not',
        'or',
        'order',
        'limit',
        'gte',
      ]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = () =>
        Promise.resolve({ data: { id: 'c1', name: 'Ravi' }, error: null });
      chain.then = (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve);
      return chain;
    },
  }),
}));

vi.mock('./journey-canvas', () => ({
  JourneyCanvas: ({
    items,
    onAdvance,
  }: {
    items: JourneyItem[];
    onAdvance: (item: JourneyItem) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-stage={item.stage_id}
          onClick={() => onAdvance(item)}
        >
          advance {item.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./journey-item-sheet', () => ({ JourneyItemSheet: () => null }));
vi.mock('./add-items-dialog', () => ({ AddItemsDialog: () => null }));
vi.mock('./captured-tray-dialog', () => ({ CapturedTrayDialog: () => null }));
vi.mock('./contact-notes-dialog', () => ({ ContactNotesDialog: () => null }));

import { JourneySection } from './journey-section';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderSection() {
  return render(
    <JourneySection
      mode="buyer"
      subjectId="c1"
      stages={STAGES}
      currency="INR"
      canEdit
      variant="full"
    />
  );
}

describe('JourneySection moveItem', () => {
  it('[UIX-038] rolls the card back and says so when the move request throws', async () => {
    let rejectMove: (err: Error) => void = () => {};
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise((_, reject) => {
          if (url === '/api/journey/move') rejectMove = reject;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSection();

    const button = await screen.findByRole('button', {
      name: 'advance item-1',
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'advance item-1' }).dataset.stage
      ).toBe('s2')
    );

    fireEvent.click(screen.getByRole('button', { name: 'advance item-1' }));
    const moveCalls = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/journey/move');
    expect(moveCalls()).toHaveLength(1);

    rejectMove(new Error('offline'));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Failed to move: check your connection and try again'
      )
    );
    expect(
      screen.getByRole('button', { name: 'advance item-1' }).dataset.stage
    ).toBe('s1');
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
