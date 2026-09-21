// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Property } from '@/types';
import {
  DEFAULT_PROPERTY_SORT,
  propertySortFor,
} from '@/lib/inventory/property-sorts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/storage/url', () => ({ storagePublicUrl: (p: string) => p }));

import { PropertyTable } from './property-table';

const row = (id: string, title: string, price: number) =>
  ({
    id,
    account_id: 'acct-1',
    title,
    price,
    location: 'Sarjapur, Bangalore',
    sublocality: 'Sarjapur',
    city: 'Bangalore',
    type: 'Villa',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    area_sqft: 2400,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as unknown as Property;

const baseProps = {
  loading: false,
  canEdit: true,
  onView: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onSort: () => {},
  sort: DEFAULT_PROPERTY_SORT,
};

afterEach(cleanup);

describe('PropertyTable', () => {
  it('renders one row per listing with the columns agents compare on', () => {
    render(
      <PropertyTable
        {...baseProps}
        properties={[
          row('p1', 'Sarjapur Villa', 25000000),
          row('p2', 'Whitefield Flat', 9000000),
        ]}
        matchCounts={{ p1: 4, p2: 0 }}
        onMatches={() => {}}
      />
    );
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('₹2.50 Cr')).toBeTruthy();
    expect(screen.getByText('₹90 Lakhs')).toBeTruthy();
    expect(screen.getAllByText('2,400 Sq.Ft.')).toHaveLength(2);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('drives the shared server sort from the column headers', () => {
    const onSort = vi.fn();
    render(
      <PropertyTable
        {...baseProps}
        properties={[row('p1', 'Sarjapur Villa', 25000000)]}
        sort={propertySortFor('price', 'asc')}
        onSort={onSort}
      />
    );
    const price = screen.getByRole('button', { name: /sort by price/i });
    expect(price.getAttribute('aria-pressed')).toBe('true');
    expect(price.getAttribute('aria-label')).toContain('ascending');
    fireEvent.click(price);
    expect(onSort).toHaveBeenCalledWith('price');
    fireEvent.click(screen.getByRole('button', { name: /sort by locality/i }));
    expect(onSort).toHaveBeenCalledWith('location');
  });

  it('opens details from the title cell and keeps the overflow menu per row', () => {
    const onView = vi.fn();
    render(
      <PropertyTable
        {...baseProps}
        properties={[row('p1', 'Sarjapur Villa', 25000000)]}
        onView={onView}
      />
    );
    fireEvent.click(screen.getByText('Sarjapur Villa'));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(
      screen.getByRole('button', { name: 'More actions for Sarjapur Villa' })
    ).toBeTruthy();
  });
});

describe('PropertyTable — review and location search', () => {
  it('shows plain headers while a location filter orders by distance', () => {
    const onSort = vi.fn();
    render(
      <PropertyTable
        {...baseProps}
        properties={[row('p1', 'Sarjapur Villa', 25000000)]}
        sortLocked
        onSort={onSort}
      />
    );
    expect(screen.queryByRole('button', { name: /sort by/i })).toBeNull();
    expect(screen.getByText('Price')).toBeTruthy();
  });

  it('keeps approve and reject on pending-review rows', async () => {
    const onApprove = vi.fn<(p: Property) => Promise<void>>(async () => {});
    const onReject = vi.fn<(p: Property) => Promise<void>>(async () => {});
    const pendingRow = {
      ...row('p1', 'Sarjapur Villa', 25000000),
      status: 'Pending Review',
    } as unknown as Property;
    render(
      <PropertyTable
        {...baseProps}
        properties={[pendingRow, row('p2', 'Whitefield Flat', 9000000)]}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
    expect(screen.getAllByRole('button', { name: /approve/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' })
    );
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).not.toHaveBeenCalled();
  });
});
