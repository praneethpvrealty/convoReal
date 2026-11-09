// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// How a showcase visitor becomes an enquiry without scrolling to the
// bottom of the panel: the sticky action footer, the one-tap enquiry
// for a visitor the showcase already knows, and the two moments an
// anonymous visitor is asked for a WhatsApp number.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';

const fetchMock = vi.fn();

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
  SimilarProperties: () => <div data-testid="similar-properties" />,
}));
vi.mock('@/components/showcase/add-to-inventory', () => ({
  AddToInventory: () => null,
  useShowcaseImportViewers: () => ({ offersImport: false }),
}));

import { ShowcaseView } from './showcase-view';

function makeProperty(id: string, title: string, code: string): Property {
  return {
    id,
    account_id: 'acct-1',
    title,
    price: 95000000,
    location: 'JP Nagar, Bengaluru',
    sublocality: 'JP Nagar',
    city: 'Bengaluru',
    type: 'Residential Land/ Plot',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [`property-images/acct-1/${id}.jpg`],
    property_code: code,
    location_guarded: true,
    location_revealed: false,
    private_images_revealed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as Property;
}

const first = makeProperty('prop-1', 'Plot in JP Nagar 3rd Phase', 'PROP-1');
const second = makeProperty('prop-2', 'Plot in Jayanagar East', 'PROP-2');

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderShowcase(initialPropertyId = first.id) {
  render(
    <ShowcaseView
      properties={[first, second]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={initialPropertyId}
      disableSavedState
    />
  );
}

function postedBodies(path: string) {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).includes(path) &&
        (init as RequestInit | undefined)?.method === 'POST'
    )
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function detailPanel() {
  return within(
    document.querySelector('[data-showcase-detail-actions]')!
      .parentElement as HTMLElement
  );
}

function identify() {
  localStorage.setItem('visitor_name', 'Asha Rao');
  localStorage.setItem('visitor_phone', '9845012345');
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [], ratings: {} }),
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('[PRP-057] showcase detail enquiry footer', () => {
  it('keeps WhatsApp, exact location and enquire one tap away, and puts similar listings after the form', () => {
    renderShowcase();
    const footer = document.querySelector('[data-showcase-detail-actions]');
    expect(footer).not.toBeNull();
    const actions = within(footer as HTMLElement);
    expect(
      actions.getByRole('link', { name: /whatsapp the agent/i })
    ).toBeTruthy();
    expect(
      actions.getByRole('button', { name: /exact location/i })
    ).toBeTruthy();
    expect(actions.getByRole('button', { name: /^enquire$/i })).toBeTruthy();

    const form = screen.getByText(/send instant inquiry/i);
    const similar = screen.getByTestId('similar-properties');
    expect(
      form.compareDocumentPosition(similar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('turns the footer into a one-tap enquiry for a visitor the showcase already knows', async () => {
    identify();
    renderShowcase();
    const footer = document.querySelector(
      '[data-showcase-detail-actions]'
    ) as HTMLElement;
    expect(screen.queryByText(/send instant inquiry/i)).toBeNull();
    expect(screen.getByText(/we have your details as/i)).toBeTruthy();

    fireEvent.click(
      within(footer).getByRole('button', { name: /i.m interested/i })
    );

    await waitFor(() =>
      expect(postedBodies('/api/public/inquiry')).toHaveLength(1)
    );
    const body = postedBodies('/api/public/inquiry')[0];
    expect(body).toMatchObject({
      name: 'Asha Rao',
      phone: '9845012345',
      propertyId: 'prop-1',
      accountId: 'acct-1',
    });
    expect(body.message).toMatch(/interested/i);
    await waitFor(() =>
      expect(screen.getByText(/inquiry submitted/i)).toBeTruthy()
    );
  });

  it('lets a known visitor edit their details back into the full form, and keeps the corrected identity', async () => {
    identify();
    renderShowcase();
    fireEvent.click(screen.getByRole('button', { name: /not you/i }));
    expect(screen.getByText(/send instant inquiry/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/your name/i), {
      target: { value: 'Meera' },
    });
    fireEvent.change(screen.getByPlaceholderText(/mobile number/i), {
      target: { value: '9000011111' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit lead form/i }));
    await waitFor(() =>
      expect(localStorage.getItem('visitor_phone')).toBe('9000011111')
    );
    expect(localStorage.getItem('visitor_name')).toBe('Meera');
  });

  it('sends one enquiry however often the footer is tapped afterwards', async () => {
    identify();
    renderShowcase();
    const footer = document.querySelector(
      '[data-showcase-detail-actions]'
    ) as HTMLElement;
    fireEvent.click(
      within(footer).getByRole('button', { name: /i.m interested/i })
    );
    await waitFor(() =>
      expect(screen.getByText(/inquiry submitted/i)).toBeTruthy()
    );
    const sent = within(footer).getByRole('button', { name: /enquiry sent/i });
    expect((sent as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sent);
    expect(postedBodies('/api/public/inquiry')).toHaveLength(1);
  });

  it('requests the exact location straight away for a known visitor', async () => {
    identify();
    renderShowcase();
    const footer = document.querySelector(
      '[data-showcase-detail-actions]'
    ) as HTMLElement;
    fireEvent.click(
      within(footer).getByRole('button', { name: /exact location/i })
    );
    await waitFor(() =>
      expect(
        postedBodies('/api/public/properties/prop-1/location-request')
      ).toHaveLength(1)
    );
    expect(
      postedBodies('/api/public/properties/prop-1/location-request')[0]
    ).toMatchObject({
      requester_name: 'Asha Rao',
      requester_phone: '9845012345',
      account_id: 'acct-1',
    });
  });

  it('opens the location request form for an anonymous visitor instead', () => {
    renderShowcase();
    const footer = document.querySelector(
      '[data-showcase-detail-actions]'
    ) as HTMLElement;
    fireEvent.click(
      within(footer).getByRole('button', { name: /exact location/i })
    );
    expect(screen.getByPlaceholderText(/whatsapp number/i)).toBeTruthy();
    expect(
      postedBodies('/api/public/properties/prop-1/location-request')
    ).toHaveLength(0);
  });
});

describe('[PRP-057] soft identity capture', () => {
  it('asks for a WhatsApp number after a high rating and files the lead with the rating', async () => {
    renderShowcase();
    expect(document.querySelector('[data-visitor-capture]')).toBeNull();

    fireEvent.click(detailPanel().getByRole('button', { name: /^9$/ }));
    const prompt = await screen.findByText(/sounds like a fit/i);
    const form = prompt.closest('form') as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText(/your name/i), {
      target: { value: 'Ravi' },
    });
    fireEvent.change(within(form).getByLabelText(/whatsapp number/i), {
      target: { value: '9900011122' },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(postedBodies('/api/public/inquiry')).toHaveLength(1)
    );
    const body = postedBodies('/api/public/inquiry')[0];
    expect(body).toMatchObject({ name: 'Ravi', phone: '9900011122' });
    expect(body.message).toContain('9/10');
    expect(localStorage.getItem('visitor_phone')).toBe('9900011122');
  });

  it('asks once a second listing is opened, and stays quiet after a dismissal', async () => {
    renderShowcase();
    expect(screen.queryByText(/browsing a few/i)).toBeNull();

    fireEvent.click(screen.getByTitle(second.title));
    const prompt = await screen.findByText(/browsing a few/i);

    fireEvent.click(
      within(prompt.closest('form') as HTMLFormElement).getByRole('button', {
        name: /not now/i,
      })
    );
    expect(screen.queryByText(/browsing a few/i)).toBeNull();
    expect(localStorage.getItem('visitor_capture_dismissed')).toBe('1');

    fireEvent.click(screen.getByTitle(first.title));
    expect(screen.queryByText(/browsing a few/i)).toBeNull();
  });

  it('withdraws the rating prompt when the rating drops below the threshold, and remembers a dismissal', async () => {
    renderShowcase();
    fireEvent.click(detailPanel().getByRole('button', { name: /^8$/ }));
    await screen.findByText(/sounds like a fit/i);
    fireEvent.click(detailPanel().getByRole('button', { name: /^3$/ }));
    expect(screen.queryByText(/sounds like a fit/i)).toBeNull();
    expect(localStorage.getItem('visitor_interests') ?? '{}').not.toContain(
      'interested'
    );

    fireEvent.click(detailPanel().getByRole('button', { name: /^9$/ }));
    const prompt = await screen.findByText(/sounds like a fit/i);
    fireEvent.click(
      within(prompt.closest('form') as HTMLFormElement).getByRole('button', {
        name: /not now/i,
      })
    );
    expect(localStorage.getItem('visitor_capture_dismissed')).toBe('1');
    fireEvent.click(screen.getByTitle(second.title));
    fireEvent.click(detailPanel().getByRole('button', { name: /^10$/ }));
    expect(screen.queryByText(/sounds like a fit/i)).toBeNull();
    expect(screen.queryByText(/browsing a few/i)).toBeNull();
  });

  it('never asks a visitor it already knows', () => {
    identify();
    renderShowcase();
    fireEvent.click(screen.getByTitle(second.title));
    expect(screen.queryByText(/browsing a few/i)).toBeNull();
    fireEvent.click(detailPanel().getByRole('button', { name: /^10$/ }));
    expect(screen.queryByText(/sounds like a fit/i)).toBeNull();
  });
});
