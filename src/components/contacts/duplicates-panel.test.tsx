// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The duplicate-contacts panel on the Contacts page.
//
// The assertion that earns this file is the third one. An earlier
// version cached the result in sessionStorage and skipped the refetch
// whenever it read a value back — but `[]` is truthy, so a check that
// found nothing stuck for the life of the tab. The panel hides itself
// when empty, and its only manual re-check control lives inside the
// banner it just hid, so the failure sealed itself: a duplicate created
// after the first visit could never surface, and nothing in the UI
// could force another look.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DuplicatesPanel } from '@/components/contacts/duplicates-panel';

const STALE_SESSION_KEY = 'convoreal_duplicate_groups_v1';

const GROUP = {
  reason: 'phone' as const,
  key: '919108362189',
  contacts: [
    {
      id: 'c1',
      name: 'Chetan kumar',
      phone: '+919108362189',
      email: null,
      source: 'whatsapp',
      classification: 'Agent',
      created_at: '2026-07-21T10:00:00Z',
      name_tag: 'C kumar',
    },
    {
      id: 'c2',
      name: 'C Kumar',
      phone: '+919108362189',
      email: null,
      source: 'whatsapp',
      classification: 'Agent',
      created_at: '2026-07-21T10:17:00Z',
      name_tag: null,
    },
  ],
};

function mockGroups(...responses: Array<{ groups: unknown[] }>) {
  const fetchMock = vi.fn();
  for (const body of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ groups: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DuplicatesPanel />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('duplicates panel', () => {
  it('flags a group sharing one phone number', async () => {
    mockGroups({ groups: [GROUP] });
    renderPanel();

    expect(await screen.findByText(/1 duplicate group detected/)).toBeTruthy();
    expect(screen.getByText('1 extra')).toBeTruthy();
  });

  // Rendering nothing was indistinguishable from the feature being gone,
  // which is exactly how it was reported: an account that had merged its
  // duplicates away looked like an account whose panel had been deleted.
  it('says so when the account has no duplicates', async () => {
    mockGroups({ groups: [] });
    renderPanel();

    expect(await screen.findByText(/No duplicate contacts found/)).toBeTruthy();
  });

  it('offers a re-check when it found nothing', async () => {
    const fetchMock = mockGroups({ groups: [] }, { groups: [GROUP] });
    renderPanel();

    await screen.findByText(/No duplicate contacts found/);
    fireEvent.click(screen.getByTitle('Re-check for duplicates'));

    expect(await screen.findByText(/1 duplicate group detected/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never lets an earlier empty result suppress the check', async () => {
    // What the old sessionStorage cache would have left behind after a
    // visit that predated the duplicate. Reading this back and treating
    // it as a hit is exactly the bug: `[]` is truthy.
    sessionStorage.setItem(STALE_SESSION_KEY, JSON.stringify([]));

    const fetchMock = mockGroups({ groups: [GROUP] });
    renderPanel();

    expect(await screen.findByText(/1 duplicate group detected/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/contacts/duplicates');
  });

  it('names both sides of the group once expanded', async () => {
    mockGroups({ groups: [GROUP] });
    renderPanel();

    fireEvent.click(await screen.findByText(/1 duplicate group detected/));

    expect(screen.getByText(/Same phone/)).toBeTruthy();
    expect(screen.getByText('Chetan kumar')).toBeTruthy();
    expect(screen.getByText('C Kumar')).toBeTruthy();
  });

  it('re-checks on demand without a remount', async () => {
    const fetchMock = mockGroups(
      { groups: [GROUP] },
      { groups: [GROUP, GROUP] }
    );
    renderPanel();

    await screen.findByText(/1 duplicate group detected/);
    fireEvent.click(screen.getByTitle('Re-check for duplicates'));

    expect(await screen.findByText(/2 duplicate groups detected/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
