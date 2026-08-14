// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// One tap on the gate's button sends the request.
//
// The gate used to put a button in front of the form that carried the
// SAME label as the button that submits it — "Request full details".
// Tapping it only revealed the form. A buyer tapped once, told the
// agent "I did", and waited on a request that was never made; the row
// only appeared after he was asked to try again.
//
// So the test is not "the form works" — it is that there is exactly one
// control with that label, and pressing it reaches the server.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Property } from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { TeaserGate } from './teaser-gate';

const property = {
  id: 'cf0216ef-ba96-48cf-b2c2-f8c6092a14f7',
  title: '4 BHK Residential House in HSR Layout',
  location: 'HSR Layout, Bengaluru',
  price_band: '₹16.5 Cr – ₹17 Cr',
  image_count: 2,
  images: [],
} as unknown as Property;

function renderGate(
  props: Partial<React.ComponentProps<typeof TeaserGate>> = {}
) {
  return render(
    <TeaserGate
      property={property}
      accountId="acct-1"
      onClose={() => {}}
      {...props}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('teaser gate', () => {
  it('offers exactly one control to request access', () => {
    renderGate();
    expect(
      screen.getAllByRole('button', { name: /request full details/i }).length
    ).toBe(1);
  });

  it('shows the form immediately, with no reveal step', () => {
    renderGate();
    expect(screen.getByPlaceholderText(/your name/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/whatsapp number/i)).toBeTruthy();
  });

  // The regression: a known visitor taps once and the request is made.
  it('submits on the first tap when the visitor is already known', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderGate({ visitorName: 'Supreeth', visitorPhone: '+917022217893' });
    fireEvent.click(
      screen.getByRole('button', { name: /request full details/i })
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain(
      `/api/public/properties/${property.id}/location-request`
    );
    const body = JSON.parse(String(init.body));
    expect(body.requester_name).toBe('Supreeth');
    expect(body.requester_phone).toBe('+917022217893');
    expect(body.scope).toBe('listing');
  });

  it('confirms on screen once it is sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      )
    );
    renderGate({ visitorName: 'Supreeth', visitorPhone: '+917022217893' });
    fireEvent.click(
      screen.getByRole('button', { name: /request full details/i })
    );
    await screen.findByText(/request sent/i);
  });

  // Silence is what caused the original confusion, so an incomplete
  // form must say something rather than absorb the tap.
  it('says what is missing instead of absorbing the tap', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderGate();
    fireEvent.submit(
      screen
        .getByRole('button', { name: /request full details/i })
        .closest('form')!
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
