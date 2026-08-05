// @vitest-environment happy-dom

// ============================================================
// The pending-review verdict buttons on the inventory cards.
//
// Approving publishes the listing, syncs the WhatsApp catalog and
// notifies the owner, so it runs for seconds — long enough that a
// reviewer works down the queue rather than waiting. The state behind
// the spinner used to be a single `decidingId`, which meant deciding a
// second card silently dropped the first card's spinner and re-enabled
// its buttons while its request was still in flight. These pin the
// concurrent case: two cards decided at once each keep their own
// indicator, and the one that resolves first does not clear the other.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  within,
} from '@testing-library/react';
import { act } from 'react';
import type { Property } from '@/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/storage/url', () => ({ storagePublicUrl: (p: string) => p }));

import { PropertyList } from './property-list';

const pending = (id: string, title: string) =>
  ({
    id,
    account_id: 'acct-1',
    title,
    price: 5000000,
    location: 'Sarjapur, Bangalore',
    city: 'Bangalore',
    type: 'Apartment',
    status: 'Pending Review',
    listing_type: 'Sale',
    is_published: false,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as unknown as Property;

/** A promise the test resolves by hand, so a decision can be held
 *  in flight while the next one starts. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The card whose heading is `title`, so assertions can't drift onto
 *  the other card's buttons. */
function card(title: string) {
  return screen.getByText(title).closest('div.flex.flex-col') as HTMLElement;
}

function buttonOn(title: string, name: RegExp) {
  return within(card(title)).getByRole('button', { name });
}

function spinning(button: HTMLElement) {
  return button.querySelector('.animate-spin') !== null;
}

/** The four handlers the list always takes; none of them is exercised
 *  here. */
const baseProps = {
  loading: false,
  canEdit: true,
  onView: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onTogglePublish: async () => {},
};

afterEach(cleanup);

describe('PropertyList — pending review verdicts', () => {
  it('keeps each card independently decidable while another is running', async () => {
    const first = deferred();
    const second = deferred();
    const onApprove = vi
      .fn<(p: Property) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(
      <PropertyList
        properties={[
          pending('p1', 'Sarjapur Villa'),
          pending('p2', 'Whitefield Flat'),
        ]}
        {...baseProps}
        onApprove={onApprove}
      />
    );

    fireEvent.click(buttonOn('Sarjapur Villa', /approve/i));
    expect(spinning(buttonOn('Sarjapur Villa', /approve/i))).toBe(true);

    // The second card is still actionable — that is the point of the
    // background publish.
    const secondApprove = buttonOn('Whitefield Flat', /approve/i);
    expect(secondApprove.hasAttribute('disabled')).toBe(false);
    fireEvent.click(secondApprove);

    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(spinning(buttonOn('Sarjapur Villa', /approve/i))).toBe(true);
    expect(spinning(buttonOn('Whitefield Flat', /approve/i))).toBe(true);

    // The first to finish must not clear the other card's indicator.
    await act(async () => {
      first.resolve();
    });
    expect(spinning(buttonOn('Sarjapur Villa', /approve/i))).toBe(false);
    expect(spinning(buttonOn('Whitefield Flat', /approve/i))).toBe(true);

    await act(async () => {
      second.resolve();
    });
    expect(spinning(buttonOn('Whitefield Flat', /approve/i))).toBe(false);
  });

  it('spins the button that was actually pressed', async () => {
    const held = deferred();
    const onReject = vi.fn<(p: Property) => Promise<void>>(() => held.promise);

    render(
      <PropertyList
        properties={[pending('p1', 'Sarjapur Villa')]}
        {...baseProps}
        onApprove={vi.fn()}
        onReject={onReject}
      />
    );

    fireEvent.click(buttonOn('Sarjapur Villa', /reject/i));

    expect(spinning(buttonOn('Sarjapur Villa', /reject/i))).toBe(true);
    expect(spinning(buttonOn('Sarjapur Villa', /approve/i))).toBe(false);

    await act(async () => {
      held.resolve();
    });
  });

  it('refuses a second verdict on the same listing', async () => {
    const held = deferred();
    const onApprove = vi.fn<(p: Property) => Promise<void>>(() => held.promise);
    const onReject = vi.fn<(p: Property) => Promise<void>>();

    render(
      <PropertyList
        properties={[pending('p1', 'Sarjapur Villa')]}
        {...baseProps}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    fireEvent.click(buttonOn('Sarjapur Villa', /approve/i));
    fireEvent.click(buttonOn('Sarjapur Villa', /approve/i));
    fireEvent.click(buttonOn('Sarjapur Villa', /reject/i));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();

    await act(async () => {
      held.resolve();
    });
  });
});
