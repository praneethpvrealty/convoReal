// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The detail modal's Share control — the one a buyer uses to forward a
// listing to a friend.
//
// The assertion that earns this file is the last one: the link it hands
// out must never carry the share grant (?g=). A grant unmasks the exact
// address, the pin and the guarded photos for whoever holds the link,
// and the agent granted it to ONE recipient. Copying the current URL
// instead of rebuilding it would forward that unmasking to everyone the
// buyer shares with, silently.
// ============================================================

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import type { Property, ShowcaseSettings } from '@/types';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
});

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: () => null,
}));
vi.mock('@/components/showcase/showcase-lead-bot', () => ({
  ShowcaseLeadBot: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));

import { ShowcaseView } from './showcase-view';

const GRANT_TOKEN = 'g'.repeat(48);

const property = {
  id: 'prop-1',
  account_id: 'acct-1',
  title: 'Sarjapur JV Land',
  price: 220000000,
  location: 'Sarjapur, Bangalore',
  sublocality: 'Sarjapur',
  city: 'Bangalore',
  type: 'Residential Land/ Plot',
  status: 'Available',
  listing_type: 'Sale',
  is_published: true,
  features: [],
  images: ['property-images/acct-1/img-1.jpg'],
  property_code: 'CR-001',
  location_guarded: true,
  location_revealed: false,
  private_images_revealed: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderAt(
  search: string,
  grantToken?: string,
  agentMode = false,
  visitorRef?: string,
  onboardOffer = false,
  writeText: ReturnType<
    typeof vi.fn<(text: string) => Promise<void>>
  > = vi.fn().mockResolvedValue(undefined)
) {
  window.history.replaceState({}, '', `/${search}`);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      shareGrantToken={grantToken}
      initialAgentMode={agentMode}
      initialOnboardOffer={onboardOffer}
      visitorRef={visitorRef}
      disableSavedState
    />
  );
  return writeText;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('showcase detail — share control', () => {
  it('offers a share control on the open listing', () => {
    renderAt('');
    expect(
      screen.getByRole('button', { name: /share this property/i })
    ).toBeTruthy();
  });

  it('copies a link addressed to the listing when the device cannot share', () => {
    const writeText = renderAt('');

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('property_id')).toBe('CR-001');
  });

  it('carries the referrer through so the recipient lands on the same catalog', () => {
    const writeText = renderAt('?ref=acct-1');

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('ref')).toBe('acct-1');
  });

  it('leaves a co-broker with the attributed link instead', () => {
    renderAt('', undefined, true, 'contact-7');

    expect(
      screen.queryByRole('button', { name: /share this property/i })
    ).toBeNull();
    expect(screen.getByText(/get my share link/i)).toBeTruthy();
  });

  it('withholds the re-share panel from an unattributed visit', () => {
    // A new hop has to hang off the attribution on the link the visitor
    // holds. With none, the API refuses the mint, so the form would only
    // collect a phone number it cannot use.
    renderAt('', undefined, true);

    expect(screen.queryByText(/get my share link/i)).toBeNull();
  });

  it('shows the invite request only when the sender offered inventory onboarding', () => {
    renderAt('', undefined, true, 'contact-7', true);

    expect(
      screen.getByRole('button', { name: /request convoreal invite/i })
    ).toBeTruthy();
    expect(screen.getByText(/pending review inventory/i)).toBeTruthy();
  });

  it('falls back to an error toast when the clipboard write is rejected', async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(
        new DOMException('Document is not focused.', 'NotAllowedError')
      );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    renderAt('', undefined, false, undefined, false, writeText);

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });

  it('copies the sanitized link — never the raw address bar — when the Clipboard API is rejected', async () => {
    // A recipient viewing through a grant (?g=) has that grant in their
    // actual address bar. If the writeText rejection ever fell back to
    // "copy the page URL yourself", it would be steering them at the
    // one URL this whole file exists to keep from leaking.
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(
        new DOMException('Document is not focused.', 'NotAllowedError')
      );
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    let copiedValue: string | undefined;
    document.execCommand = ((command: string) => {
      if (command === 'copy') {
        copiedValue =
          document.activeElement instanceof HTMLTextAreaElement
            ? document.activeElement.value
            : undefined;
      }
      return true;
    }) as typeof document.execCommand;
    renderAt(`?g=${GRANT_TOKEN}&v=contact-9`, GRANT_TOKEN, false, undefined, false, writeText);

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    await waitFor(() => expect(successSpy).toHaveBeenCalled());
    expect(copiedValue).toBeTruthy();
    expect(copiedValue).not.toContain(GRANT_TOKEN);
    expect(copiedValue).not.toContain('g=');
    expect(copiedValue).not.toContain('v=contact-9');

    successSpy.mockRestore();
    // @ts-expect-error -- restoring happy-dom's default (unimplemented) execCommand
    delete document.execCommand;
  });

  it('falls back to a manual copy when the co-broker reshare link cannot use the Clipboard API', async () => {
    // The reshare-link "Copy" button used to fire
    // navigator.clipboard.writeText(...).then(...) with no .catch — a
    // rejection (e.g. NotAllowedError when the tab lost focus) became an
    // unhandled promise rejection instead of falling back, unlike the
    // main Share button just above it.
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(
        new DOMException('Document is not focused.', 'NotAllowedError')
      );
    const originalFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/reshare-link')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ link: 'https://www.convoreal.com/property/sarjapur-jv-land?ref=contact-9' }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      })
    );
    let copiedValue: string | undefined;
    document.execCommand = ((command: string) => {
      if (command === 'copy') {
        copiedValue =
          document.activeElement instanceof HTMLTextAreaElement
            ? document.activeElement.value
            : undefined;
      }
      return true;
    }) as typeof document.execCommand;

    try {
      renderAt('', undefined, true, 'contact-9', false, writeText);

      fireEvent.click(screen.getByRole('button', { name: /get my share link/i }));
      fireEvent.change(screen.getByPlaceholderText('Your Name'), {
        target: { value: 'Priya' },
      });
      fireEvent.change(screen.getByPlaceholderText('Your WhatsApp Number'), {
        target: { value: '9900277111' },
      });
      fireEvent.click(screen.getByRole('button', { name: /get my share link/i }));

      const copyButton = await screen.findByRole('button', { name: /^copy$/i });
      fireEvent.click(copyButton);

      await waitFor(() => expect(copiedValue).toBeTruthy());
      expect(copiedValue).toBe(
        'https://www.convoreal.com/property/sarjapur-jv-land?ref=contact-9'
      );
      await screen.findByRole('button', { name: /copied!/i });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      // @ts-expect-error -- restoring happy-dom's default (unimplemented) execCommand
      delete document.execCommand;
    }
  });

  it('never forwards the share grant that unmasked this visit', () => {
    const writeText = renderAt(`?g=${GRANT_TOKEN}&v=contact-9`, GRANT_TOKEN);

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    const shared = writeText.mock.calls[0][0];
    expect(shared).not.toContain(GRANT_TOKEN);
    expect(shared).not.toContain('g=');
    // The per-contact visitor token is Pulse identity, not the sharer's
    // to hand on either — the recipient must count as their own visitor.
    expect(shared).not.toContain('v=contact-9');
  });
});
