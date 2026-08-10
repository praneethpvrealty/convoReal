import { create } from 'zustand';

import {
  EMPTY_PROPERTY_FILTERS,
  type PropertyFilters,
} from './property-filters';
import type { PickedLocality } from './types';

export type ListingFilter = 'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';

/**
 * A near-search anchor: either a picked locality (autocomplete) or the
 * device's GPS fix ("Near me"). Feeds /api/properties `near_*` params.
 */
export interface NearAnchor {
  latitude: number;
  longitude: number;
  /** Human label shown in the chip ("Near me" or the locality name). */
  label: string;
  /** Google place_id — present for locality picks, absent for GPS. */
  place_id?: string;
  radiusKm: number;
}

interface PropertySearchState {
  search: string;
  listing: ListingFilter;
  near: NearAnchor | null;
  /** Off by default: results are Available-only until the chip widens them. */
  includeUnavailable: boolean;
  /** Type, status, source, showcase, price band and sort — everything
   *  behind the Filters chip. */
  filters: PropertyFilters;
  setSearch: (v: string) => void;
  setListing: (v: ListingFilter) => void;
  setNear: (v: NearAnchor | null) => void;
  setRadius: (km: number) => void;
  setIncludeUnavailable: (v: boolean) => void;
  setFilters: (v: PropertyFilters) => void;
}

/**
 * Shared between the Properties list and the map screen so both render
 * the same result set (and share one React Query cache entry).
 */
export const usePropertySearch = create<PropertySearchState>((set) => ({
  search: '',
  listing: 'All',
  near: null,
  includeUnavailable: false,
  filters: EMPTY_PROPERTY_FILTERS,
  setSearch: (search) => set({ search }),
  setListing: (listing) => set({ listing }),
  setNear: (near) => set({ near }),
  setRadius: (radiusKm) =>
    set((s) => (s.near ? { near: { ...s.near, radiusKm } } : {})),
  setIncludeUnavailable: (includeUnavailable) => set({ includeUnavailable }),
  setFilters: (filters) => set({ filters }),
}));

export function nearFromLocality(pick: PickedLocality, radiusKm = 5): NearAnchor {
  return {
    latitude: pick.latitude,
    longitude: pick.longitude,
    label: pick.label,
    place_id: pick.place_id,
    radiusKm,
  };
}
