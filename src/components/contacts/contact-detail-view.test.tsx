// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const tables = vi.hoisted(() => ({
  reads: [] as string[],
  searches: [] as Array<{ table: string; ors: string[]; limit?: number }>,
  rows: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    profile: { id: 'p1' },
    account: { default_language: 'en' },
    accountId: 'acct-1',
    canViewGuardedLocations: true,
  }),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      tables.reads.push(table);
      const search: { table: string; ors: string[]; limit?: number } = {
        table,
        ors: [],
      };
      const finish = (single: boolean) => {
        if (search.ors.length > 0) tables.searches.push(search);
        return Promise.resolve({
          data: single
            ? ((tables.rows[table] as unknown[] | undefined)?.[0] ?? null)
            : (tables.rows[table] ?? []),
          error: null,
        });
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        or: (expression: string) => {
          search.ors.push(expression);
          return chain;
        },
        limit: (count: number) => {
          search.limit = count;
          return chain;
        },
        single: () => finish(true),
        maybeSingle: () => finish(true),
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => finish(false).then(onFulfilled, onRejected),
      };
      return chain;
    },
  }),
}));

const Nothing = vi.hoisted(() => () => null);
vi.mock('@/components/inventory/property-form', () => ({
  PropertyForm: Nothing,
}));
vi.mock('@/components/inventory/property-share-dialog', () => ({
  PropertyShareDialog: Nothing,
}));
vi.mock('@/components/inventory/showcase-share-dialog', () => ({
  ShowcaseShareDialog: Nothing,
}));
vi.mock('@/components/calendar/schedule-dialog', () => ({
  ScheduleDialog: Nothing,
}));
vi.mock('@/components/contacts/log-external-share-dialog', () => ({
  LogExternalShareDialog: Nothing,
}));
vi.mock('@/components/contacts/call-analysis', () => ({
  CallRecordingAnalyzer: Nothing,
  CallAnalysisSection: Nothing,
}));
vi.mock('@/components/contacts/greetings-generator-dialog', () => ({
  GreetingsGeneratorDialog: Nothing,
}));
vi.mock('@/components/contacts/owner-details-request-dialog', () => ({
  OwnerDetailsRequestDialog: Nothing,
}));
vi.mock('@/components/contacts/contact-requirements-dialog', () => ({
  ContactRequirementsDialog: Nothing,
}));
vi.mock('@/components/contacts/move-to-engine-dialog', () => ({
  MoveToEngineDialog: Nothing,
}));
vi.mock('@/components/contacts/share-inventory-dialog', () => ({
  ShareInventoryDialog: Nothing,
}));
vi.mock('@/components/contacts/property-interest-follow-up-dialog', () => ({
  PropertyInterestFollowUpDialog: Nothing,
}));
vi.mock('@/components/contacts/portal-invite-dialog', () => ({
  PortalInviteDialog: Nothing,
}));
vi.mock('@/components/contacts/portfolio-invite-dialog', () => ({
  PortfolioInviteDialog: Nothing,
}));
vi.mock('@/components/contacts/seller-page-dialog', () => ({
  SellerPageDialog: Nothing,
}));
vi.mock('@/components/contacts/log-call-prompt', () => ({
  LogCallPrompt: Nothing,
}));
vi.mock('@/components/contacts/party-panel', () => ({ PartyPanel: Nothing }));
vi.mock('@/components/contacts/areas-of-interest-input', () => ({
  AreasOfInterestInput: Nothing,
}));
vi.mock('@/components/contacts/projects-of-interest-input', () => ({
  ProjectsOfInterestInput: Nothing,
}));
vi.mock('@/components/ui/searchable-property-select', () => ({
  SearchablePropertySelect: Nothing,
}));

import { ContactDetailView } from './contact-detail-view';

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContactDetailView
        open
        onOpenChange={vi.fn()}
        contactId="c1"
        onUpdated={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe('ContactDetailView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    tables.reads = [];
    tables.searches = [];
    tables.rows = {};
  });

  it('searches referrer suggestions on the server only once the field is used', async () => {
    tables.rows = {
      contacts: [
        {
          id: 'c1',
          name: 'Meera Buyer',
          phone: '+919800000000',
          classification: 'Buyer',
          secondary_phones: [],
        },
        {
          id: 'c2',
          name: 'Ravi',
          second_name: 'Kumar',
          phone: '+919800000002',
          classification: 'Agent',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ calls: [] }),
        })
      )
    );

    renderView();

    const input = await screen.findByPlaceholderText(
      'Search existing contact or type a name...'
    );
    await waitFor(() => expect(tables.reads).toContain('contact_notes'));
    expect(tables.searches).toEqual([]);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ravi' } });

    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
    expect(tables.searches).toEqual([
      {
        table: 'contacts',
        ors: [
          'name.ilike."%ravi%",second_name.ilike."%ravi%",phone.ilike."%ravi%"',
        ],
        limit: 5,
      },
    ]);
  });

  it('renders the contact once the detail bundle has loaded', async () => {
    tables.rows = {
      contacts: [
        {
          id: 'c1',
          name: 'Meera Buyer',
          phone: '+919800000000',
          classification: 'Buyer',
          secondary_phones: [],
        },
      ],
      showcase_settings: [{ currency: 'INR' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ calls: [] }),
        })
      )
    );

    renderView();

    expect(await screen.findByText('Meera Buyer')).toBeTruthy();
    await waitFor(() => expect(tables.reads).toContain('contact_notes'));
    expect(tables.reads).toContain('contacts');
    expect(tables.reads).toContain('tags');
    expect(tables.reads).toContain('deals');
    expect(tables.reads).toContain('showcase_settings');
    expect(screen.getAllByDisplayValue('Meera Buyer').length).toBeGreaterThan(
      0
    );
  });
});
