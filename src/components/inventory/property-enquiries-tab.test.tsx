// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Property } from '@/types';
import type { AudienceContact } from '@/lib/inventory/listing-audience';
import { Tabs } from '@/components/ui/tabs';
import { PropertyEnquiriesTab } from './property-enquiries-tab';

const dialogs = vi.hoisted(() => ({
  schedule: [] as Array<Record<string, unknown>>,
  followUp: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/hooks/useCan', () => ({
  useCan: () => true,
}));

vi.mock('@/components/contacts/name-tag-badge', () => ({
  NameTagBadge: () => null,
}));

vi.mock('@/components/calendar/schedule-dialog', () => ({
  ScheduleDialog: (props: Record<string, unknown>) => {
    dialogs.schedule.push(props);
    return props.open ? <div data-testid="schedule-dialog" /> : null;
  },
}));

vi.mock('@/components/contacts/property-interest-follow-up-dialog', () => ({
  PropertyInterestFollowUpDialog: (props: Record<string, unknown>) => {
    dialogs.followUp.push(props);
    return <div data-testid="follow-up-dialog" />;
  },
}));

const PROPERTY = {
  id: 'prop-1',
  title: 'Lakeview Villa',
  property_code: 'LV-01',
} as Property;

const CONTACTS: AudienceContact[] = [
  {
    contactId: 'c1',
    name: 'Ravi Buyer',
    phone: '9800000001',
    classification: 'Buyer',
    nameTag: null,
    enquired: true,
    viewed: true,
    viewsCount: 3,
    lastAt: '2026-09-01T10:00:00Z',
  },
  {
    contactId: 'c2',
    name: null,
    phone: '+919800000002',
    classification: null,
    nameTag: null,
    enquired: true,
    viewed: false,
    viewsCount: 0,
    lastAt: null,
  },
];

function renderTab(
  overrides: Partial<Parameters<typeof PropertyEnquiriesTab>[0]> = {}
) {
  const fetchListingEnquiries = vi.fn(() => Promise.resolve());
  const view = render(
    <Tabs value="enquiries">
      <PropertyEnquiriesTab
        property={PROPERTY}
        enquiredContacts={CONTACTS}
        loadingListingAudience={false}
        listingAudienceError={false}
        fetchListingEnquiries={fetchListingEnquiries}
        {...overrides}
      />
    </Tabs>
  );
  return { ...view, fetchListingEnquiries };
}

afterEach(() => {
  cleanup();
  dialogs.schedule.length = 0;
  dialogs.followUp.length = 0;
});

describe('[PRP-007] PropertyEnquiriesTab', () => {
  it('lists every enquired contact with view, call, message and follow-up actions', () => {
    renderTab();

    expect(screen.getByText('2 contacts enquired')).toBeTruthy();
    expect(screen.getByText('Ravi Buyer')).toBeTruthy();
    expect(screen.getAllByText('+919800000002')).toHaveLength(2);

    const viewLinks = screen.getAllByRole('link', { name: /View contact/ });
    expect(viewLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/contacts?contactId=c1',
      '/contacts?contactId=c2',
    ]);
    const callLinks = screen.getAllByRole('link', { name: /Call/ });
    expect(callLinks.map((a) => a.getAttribute('href'))).toEqual([
      'tel:+919800000001',
      'tel:+919800000002',
    ]);
    expect(screen.getAllByRole('button', { name: /Message/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Follow up/ })).toHaveLength(
      2
    );
  });

  it('opens the schedule dialog for the chosen contact on Follow up', () => {
    renderTab();

    expect(screen.queryByTestId('schedule-dialog')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Follow up/ })[0]);

    expect(screen.getByTestId('schedule-dialog')).toBeTruthy();
    const latest = dialogs.schedule.at(-1)!;
    expect(latest.contactId).toBe('c1');
    expect(latest.propertyId).toBe('prop-1');
    expect(latest.initialTitle).toBe('Follow up — LV-01');
  });

  it('opens the WhatsApp follow-up dialog on Message and reloads after a send', () => {
    const { fetchListingEnquiries } = renderTab();

    expect(screen.queryByTestId('follow-up-dialog')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Message/ })[1]);

    expect(screen.getByTestId('follow-up-dialog')).toBeTruthy();
    const latest = dialogs.followUp.at(-1)!;
    expect(latest.contactId).toBe('c2');
    expect(latest.contactName).toBe('');
    expect(latest.contactPhone).toBe('+919800000002');
    (latest.onSent as () => void)();
    expect(fetchListingEnquiries).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the enquiries failed to load', () => {
    const { fetchListingEnquiries } = renderTab({
      enquiredContacts: [],
      listingAudienceError: true,
    });

    expect(screen.getByText('Could not load enquired contacts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchListingEnquiries).toHaveBeenCalledTimes(1);
  });
});
