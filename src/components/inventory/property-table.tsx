'use client';

import type { Property } from '@/types';
import { formatCurrency } from '@/lib/currency-utils';
import { storagePublicUrl } from '@/lib/storage/url';
import { internalPhotoSources } from '@/lib/inventory/photo-sources';
import { isLandType } from '@/lib/inventory/property-options';
import {
  type PropertySort,
  type PropertySortField,
} from '@/lib/inventory/property-sorts';
import {
  importCountLabel,
  type ImportCountMap,
} from '@/lib/inventory/import-activity';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  PropertyActionsMenu,
  type PropertyActionHandlers,
} from '@/components/inventory/property-actions-menu';
import { PropertyConstructionLoader } from '@/components/ui/property-construction-loader';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building,
  CheckSquare,
  Eye,
  EyeOff,
  Lock,
  Share2,
  Square,
  Users,
} from 'lucide-react';

interface PropertyTableProps extends PropertyActionHandlers {
  properties: Property[];
  loading: boolean;
  sort: PropertySort;
  onSort: (field: PropertySortField) => void;
  onView: (property: Property) => void;
  onShare?: (property: Property) => void;
  onMatches?: (property: Property) => void;
  matchCounts?: Record<string, number>;
  importCounts?: ImportCountMap;
  canEdit: boolean;
  currency?: string;
  selectedIds?: string[];
  onToggleSelected?: (propertyId: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  Available: 'bg-green-500/10 text-green-400 border-green-500/30',
  'Under Contract': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Sold: 'bg-slate-800 text-slate-400 border-slate-700',
  'Off Market': 'bg-red-500/10 text-red-400 border-red-500/30',
  'Pending Review': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  Rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
  Archived: 'bg-slate-800 text-slate-500 border-slate-700',
};

const SORTABLE: { field: PropertySortField; label: string }[] = [
  { field: 'title', label: 'Listing' },
  { field: 'location', label: 'Locality' },
  { field: 'price', label: 'Price' },
  { field: 'status', label: 'Status' },
  { field: 'created_at', label: 'Added' },
];

function sizeLabel(property: Property): string {
  if (isLandType(property.type)) {
    return property.land_area
      ? `${property.land_area.toLocaleString('en-IN')} ${property.land_area_unit || 'Sq.Ft.'}`
      : '—';
  }
  return property.area_sqft
    ? `${property.area_sqft.toLocaleString('en-IN')} ${property.area_unit || 'Sq.Ft.'}`
    : '—';
}

function priceLabel(property: Property, currency: string): string {
  if (
    property.listing_type === 'Rent' ||
    property.listing_type === 'Built to Suit'
  ) {
    return `${formatCurrency(property.rent_per_month || 0, currency)}/mo`;
  }
  if (property.listing_type === 'JV/JD') {
    return property.owner_share_percent && property.builder_share_percent
      ? `${property.owner_share_percent}:${property.builder_share_percent} share`
      : 'JV / JD';
  }
  return formatCurrency(property.price, currency);
}

/**
 * The dense view of the same page of listings the grid shows: one row
 * per property, the columns an agent compares stock on, and the same
 * server-side sort the grid uses, driven from the column headers.
 */
export function PropertyTable({
  properties,
  loading,
  sort,
  onSort,
  onView,
  onShare,
  onMatches,
  matchCounts,
  importCounts,
  canEdit,
  currency = 'INR',
  selectedIds,
  onToggleSelected,
  ...actions
}: PropertyTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <PropertyConstructionLoader
          size={104}
          label="Loading property inventory"
          className="mb-3"
        />
        <p className="text-sm">Loading property inventory...</p>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 py-16 text-center">
        <Building className="mx-auto mb-4 size-12 text-slate-600" />
        <h3 className="mb-1 text-lg font-semibold text-white">
          No listings found
        </h3>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          Create property records or adjust search filters to view inventory.
        </p>
      </div>
    );
  }

  function header(field: PropertySortField, label: string) {
    const active = sort.field === field;
    const Icon = active
      ? sort.order === 'asc'
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-pressed={active}
        aria-label={`Sort by ${label.toLowerCase()}${
          active ? `, ${sort.order === 'asc' ? 'ascending' : 'descending'}` : ''
        }`}
        className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors hover:text-white ${
          active ? 'text-white' : 'text-slate-400'
        }`}
      >
        {label}
        <Icon
          className={`size-3 ${active ? 'text-primary' : 'text-slate-600'}`}
        />
      </button>
    );
  }

  const sortable = Object.fromEntries(SORTABLE.map((c) => [c.field, c.label]));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <Table className="text-slate-200">
        <TableHeader className="bg-slate-950/60">
          <TableRow className="border-slate-800 hover:bg-transparent">
            {onToggleSelected && <TableHead className="w-10" />}
            <TableHead className="min-w-64">
              {header('title', sortable.title)}
            </TableHead>
            <TableHead className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              Type
            </TableHead>
            <TableHead>{header('location', sortable.location)}</TableHead>
            <TableHead className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              Size
            </TableHead>
            <TableHead className="text-right">
              {header('price', sortable.price)}
            </TableHead>
            <TableHead>{header('status', sortable.status)}</TableHead>
            <TableHead className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              Matches
            </TableHead>
            <TableHead>{header('created_at', sortable.created_at)}</TableHead>
            <TableHead className="text-right text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {properties.map((property) => {
            const cover = internalPhotoSources(property)[0];
            const thumb = cover
              ? cover.guarded
                ? cover.url
                : storagePublicUrl(cover.url)
              : null;
            const selected = selectedIds?.includes(property.id) ?? false;
            const matchCount = matchCounts?.[property.id];
            const importCount = importCounts?.[property.id] ?? 0;
            return (
              <TableRow
                key={property.id}
                data-state={selected ? 'selected' : undefined}
                className="data-[state=selected]:bg-primary/5 border-slate-800/80 hover:bg-slate-800/40"
              >
                {onToggleSelected && (
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => onToggleSelected(property.id)}
                      aria-label={`Select ${property.title}`}
                      className="text-slate-400 hover:text-white"
                    >
                      {selected ? (
                        <CheckSquare className="text-primary size-4" />
                      ) : (
                        <Square className="size-4" />
                      )}
                    </button>
                  </TableCell>
                )}
                <TableCell className="whitespace-normal">
                  <button
                    type="button"
                    onClick={() => onView(property)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (property.private_images_count ?? 0) > 0 ? (
                        <Lock className="size-4 text-slate-600" />
                      ) : (
                        <Building className="size-5 text-slate-700" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="hover:text-primary line-clamp-1 text-sm font-semibold text-white transition-colors">
                        {property.title}
                      </span>
                      <span className="flex items-center gap-2 text-[11px] text-slate-500">
                        {property.property_code && (
                          <span className="font-mono">
                            {property.property_code}
                          </span>
                        )}
                        {property.is_published ? (
                          <span
                            className="text-primary inline-flex items-center gap-1"
                            title="Showcased publicly"
                          >
                            <Eye className="size-3" /> Public
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1"
                            title="Private listing"
                          >
                            <EyeOff className="size-3" /> Private
                          </span>
                        )}
                        {importCount > 0 && (
                          <span title={importCountLabel(importCount)}>
                            · {importCountLabel(importCount)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell className="text-xs text-slate-300">
                  {property.type}
                </TableCell>
                <TableCell
                  className="max-w-48 truncate text-xs text-slate-300"
                  title={property.location}
                >
                  {property.sublocality || property.location}
                </TableCell>
                <TableCell className="text-xs text-slate-300">
                  {sizeLabel(property)}
                </TableCell>
                <TableCell className="text-right text-sm font-bold text-white">
                  {priceLabel(property, currency)}
                </TableCell>
                <TableCell>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase ${
                      STATUS_STYLES[property.status] ||
                      'border-slate-700 bg-slate-800 text-slate-300'
                    }`}
                  >
                    {property.status}
                  </span>
                </TableCell>
                <TableCell>
                  {onMatches && matchCount !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onMatches(property)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        matchCount > 0
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                          : 'border border-slate-700 bg-slate-800 text-slate-500'
                      }`}
                      title="Matching contacts for this property"
                    >
                      <Users className="size-3" />
                      {matchCount}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-slate-400">
                  {new Date(property.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onView(property)}
                      className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <Eye className="mr-1 size-3.5" /> Details
                    </Button>
                    {onShare && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onShare(property)}
                        aria-label={`Share ${property.title}`}
                        className="h-8 w-8 border-slate-800 px-0 text-slate-300 hover:bg-slate-800 hover:text-white"
                      >
                        <Share2 className="text-primary size-3.5" />
                      </Button>
                    )}
                    <PropertyActionsMenu
                      property={property}
                      canEdit={canEdit}
                      {...actions}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
