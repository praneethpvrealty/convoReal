'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl, replaceUrl } from '@/lib/navigation';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Property, ShowcaseSettings } from '@/types';
import { getMatchingContacts } from '@/lib/matching';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Building,
  CheckCircle,
  Eye,
  Loader2,
  Trash2,
  Tag,
  ChevronLeft,
  ChevronRight,
  Share2,
  Archive,
  RefreshCw,
  FolderInput,
  X,
  Map as MapIcon,
  LayoutGrid,
  LocateFixed,
} from 'lucide-react';
import { PropertyForm } from '@/components/inventory/property-form';
import { PropertyMapView } from '@/components/inventory/property-map-view';
import { useT } from '@/hooks/use-locale';
import { PropertyList } from '@/components/inventory/property-list';
import {
  LocalityAutocomplete,
  type PickedLocality,
} from '@/components/ui/locality-autocomplete';
import { FlyerCreatorDialog } from '@/components/inventory/flyer-creator-dialog';
import { PromotePropertyDialog } from '@/components/inventory/promote-property-dialog';

// Kill switch — the Promote button/dialog only exist where Meta Ads is
// configured on the deployment (see docs/meta-ads-integration-plan.md §2).
const META_ADS_ENABLED = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;
import { PropertyShareDialog } from '@/components/inventory/property-share-dialog';
import { ImportSharedDialog } from '@/components/inventory/import-shared-dialog';
import { PropertyEmailShareDialog } from '@/components/inventory/property-email-share-dialog';
import { ShowcaseShareDialog } from '@/components/inventory/showcase-share-dialog';
import { STARRED_PROPERTY_CAP } from '@/lib/starred-properties';
import { PortalPostDialog } from '@/components/inventory/portal-post-dialog';
import { PortalSyncDialog } from '@/components/inventory/portal-sync-dialog';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { InfoHint } from '@/components/ui/info-hint';

// Counts across ALL properties, independent of the current page/filters
// so the summary cards always show accurate totals.
const EMPTY_BADGES: Record<string, string[]> = {};

const EMPTY_COUNTS: Record<string, number> = {};

const EMPTY_STATS = {
  total: 0,
  published: 0,
  available: 0,
  soldOrContract: 0,
  pendingReview: 0,
  activeTotal: 0,
  direct: 0,
  agentReferred: 0,
};

export default function InventoryPage() {
  const t = useT();
  const canEdit = useCan('send-messages'); // Agent or higher can write
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';
  const initialPage = parseInt(searchParams?.get('page') || '0', 10);

  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Tiered location search: picking a locality shows exact matches first,
  // then properties within radiusKm sorted by distance.
  const [locationText, setLocationText] = useState('');
  const [pickedPlace, setPickedPlace] = useState<PickedLocality | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [nearMe, setNearMe] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [view, setView] = useState<'grid' | 'map'>('grid');
  // Mobile-only: search + locality live behind a floating lens button
  // (the two bars ate half the viewport and were unreachable once
  // scrolled into the list). Desktop keeps the inline bars.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Debounce search to avoid per-keystroke NLP parse + Supabase round-trip.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to first page when the debounced search or location filter changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, pickedPlace, radiusKm]);

  // Filters
  const [typeFilter] = useState('All');
  const [reviewTab, setReviewTab] = useState<'all' | 'review' | 'archived'>(
    'all'
  );
  const statusFilter =
    reviewTab === 'review'
      ? 'Pending Review'
      : reviewTab === 'archived'
        ? 'Archived'
        : 'All';
  const [showcaseFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState<'All' | 'Owner' | 'Agent'>(
    'All'
  );

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [importSharedOpen, setImportSharedOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(
    null
  );
  const [formViewOnly, setFormViewOnly] = useState(false);
  const [formInitialTab, setFormInitialTab] = useState<'details' | 'matches'>(
    'details'
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);
  const [flyerProperty, setFlyerProperty] = useState<Property | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteProperty, setPromoteProperty] = useState<Property | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareProperty, setShareProperty] = useState<Property | null>(null);
  const [emailShareOpen, setEmailShareOpen] = useState(false);
  const [emailShareProperty, setEmailShareProperty] = useState<Property | null>(
    null
  );
  const [showcaseShareOpen, setShowcaseShareOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalSyncOpen, setPortalSyncOpen] = useState(false);
  const [portalProperty, setPortalProperty] = useState<Property | null>(null);

  const { accountId } = useAuth();
  const router = useRouter();

  const queryClient = useQueryClient();

  // Everything on this page that comes from the server hangs off the
  // 'inventory' key, so a write invalidates the lot with one call
  // instead of clearing a hand-rolled Map and re-running each fetcher.
  const refreshInventory = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }, [queryClient]);

  const showcaseSettingsQuery = useQuery({
    queryKey: ['inventory', 'showcase-settings', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('showcase_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();
      return (data as ShowcaseSettings | null) ?? null;
    },
    enabled: Boolean(accountId),
  });
  const showcaseSettings = showcaseSettingsQuery.data ?? null;
  const currency = showcaseSettings?.currency ?? 'INR';

  // Unfiltered, unpaginated counts for the summary stats panel, from a
  // single scan of the account's inventory (migration 168). This was
  // five parallel `count: 'exact'` HEAD requests — those are real
  // COUNT(*)s, not metadata reads, so they scanned the account's whole
  // inventory once each on every visit.
  const globalStatsQuery = useQuery({
    queryKey: ['inventory', 'stats', accountId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc('inventory_stats', { p_account_id: accountId })
        .maybeSingle<{
          total: number;
          published: number;
          available: number;
          sold_or_contract: number;
          pending_review: number;
          active_total: number;
          direct: number;
          agent_referred: number;
        }>();
      if (error) throw error;
      return {
        total: data?.total ?? 0,
        published: data?.published ?? 0,
        available: data?.available ?? 0,
        soldOrContract: data?.sold_or_contract ?? 0,
        pendingReview: data?.pending_review ?? 0,
        activeTotal: data?.active_total ?? 0,
        direct: data?.direct ?? 0,
        agentReferred: data?.agent_referred ?? 0,
      };
    },
    enabled: Boolean(accountId),
  });
  const globalStats = globalStatsQuery.data ?? EMPTY_STATS;

  const listParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: '25',
    });
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (pickedPlace) {
      params.set('near_lat', String(pickedPlace.latitude));
      params.set('near_lng', String(pickedPlace.longitude));
      params.set('near_place_id', pickedPlace.place_id);
      params.set('near_label', pickedPlace.name);
      params.set('radius_km', String(radiusKm));
    } else if (nearMe) {
      // Pure radius search around the browser's GPS fix — no place id
      // or label, so the API skips the locality tier entirely.
      params.set('near_lat', String(nearMe.latitude));
      params.set('near_lng', String(nearMe.longitude));
      params.set('radius_km', String(radiusKm));
    }
    if (typeFilter !== 'All') params.set('type', typeFilter);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (reviewTab === 'all') params.set('exclude_archived', 'true');
    if (showcaseFilter !== 'All')
      params.set(
        'is_published',
        showcaseFilter === 'Showcased' ? 'true' : 'false'
      );
    if (sourceFilter !== 'All')
      params.set(
        'listing_source',
        sourceFilter === 'Owner' ? 'owner' : 'agent'
      );
    return params.toString();
  }, [
    page,
    debouncedSearch,
    pickedPlace,
    nearMe,
    radiusKm,
    typeFilter,
    statusFilter,
    showcaseFilter,
    sourceFilter,
    reviewTab,
  ]);

  // The querystring is the cache key, so paging back to a page already
  // seen reads the cache. The previous request appended `&_t=` with
  // `cache: 'no-store'` to defeat HTTP caching, then kept its own 30s
  // Map alongside; both are gone.
  const propertiesQuery = useQuery({
    queryKey: ['inventory', 'list', listParams],
    queryFn: async () => {
      const response = await fetch(`/api/properties?${listParams}`);
      if (!response.ok) throw new Error('Failed to fetch properties');
      return (await response.json()) as {
        data: Property[];
        pagination?: { total: number; totalPages: number };
      };
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (propertiesQuery.error) {
      const message =
        propertiesQuery.error instanceof Error
          ? propertiesQuery.error.message
          : 'Error loading properties';
      toast.error(message);
    }
  }, [propertiesQuery.error]);

  const properties = useMemo(
    () => propertiesQuery.data?.data ?? [],
    [propertiesQuery.data]
  );

  // Map view fetches its own wider page — 100 pins beats 25 — and only
  // while the map is showing. Same filters, so the two stay in step.
  const mapParams = useMemo(() => {
    const params = new URLSearchParams(listParams);
    params.set('page', '0');
    params.set('limit', '100');
    return params.toString();
  }, [listParams]);
  const mapQuery = useQuery({
    queryKey: ['inventory', 'map', mapParams],
    enabled: view === 'map',
    queryFn: async () => {
      const response = await fetch(`/api/properties?${mapParams}`);
      if (!response.ok) throw new Error('Failed to fetch properties');
      return (await response.json()) as { data: Property[] };
    },
    placeholderData: (prev) => prev,
  });

  const totalCount = propertiesQuery.data?.pagination?.total ?? 0;
  const totalPages = propertiesQuery.data?.pagination?.totalPages ?? 0;
  const loading = propertiesQuery.isPending;

  // Sync page with URL
  useEffect(() => {
    const urlPage = parseInt(searchParams?.get('page') || '0', 10);
    if (urlPage !== page) {
      const params = new URLSearchParams(searchParams?.toString());
      params.set('page', String(page));
      replaceUrl(router, `/inventory?${params.toString()}`);
    }
  }, [page, searchParams, router]);

  // Automatically open property form modal if propertyId is specified in query parameters.
  // The id is read from the live URL (window.location) as well as useSearchParams: on
  // cached/prerendered page loads useSearchParams can hydrate with empty params, which left
  // deep links (e.g. the "View it in your dashboard" link from the WhatsApp chatbot) silently
  // landing on the list instead of opening the property. Opening always goes through a fresh
  // fetch so it works even when the property is not on the currently loaded page.
  useEffect(() => {
    if (hasAutoOpened) return;
    const pid =
      searchParams?.get('propertyId') ||
      (typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('propertyId')
        : null);
    if (!pid) return;

    setHasAutoOpened(true);

    const loadAndOpen = async () => {
      let prop = properties.find(
        (p) => p.id === pid || p.property_code === pid
      );
      if (!prop) {
        try {
          const response = await fetch(`/api/properties/${pid}`, {
            cache: 'no-store',
          });
          if (response.ok) {
            prop = await response.json();
          }
        } catch {
          // ignore
        }
      }
      if (prop) {
        setSelectedProperty(prop);
        setFormViewOnly(true);
        setFormOpen(true);
      } else {
        toast.error('Could not open that property. It may have been removed.');
      }
    };

    loadAndOpen();
  }, [searchParams, properties, hasAutoOpened]);

  // Keep active modal property states in sync with the fetched properties list.
  // Compares by `updated_at`, not object identity — every fetchProperties()
  // call returns a brand-new array with brand-new object references even
  // when nothing about a given property actually changed, so a reference
  // check (`updated !== selectedProperty`) reassigned a new object on
  // every single refetch. That churned the `property` prop into
  // PropertyForm, whose effect depends on it — re-running fetchContacts()
  // and resetting the Matching Contacts tab's selection/active-tab state
  // out from under anyone using it, and re-triggering its loading spinner
  // over an already-loaded, otherwise-untouched contact list.
  useEffect(() => {
    if (selectedProperty) {
      const updated = properties.find((p) => p.id === selectedProperty.id);
      if (updated && updated.updated_at !== selectedProperty.updated_at) {
        setSelectedProperty(updated);
      }
    }
    if (flyerProperty) {
      const updated = properties.find((p) => p.id === flyerProperty.id);
      if (updated && updated.updated_at !== flyerProperty.updated_at) {
        setFlyerProperty(updated);
      }
    }
    if (shareProperty) {
      const updated = properties.find((p) => p.id === shareProperty.id);
      if (updated && updated.updated_at !== shareProperty.updated_at) {
        setShareProperty(updated);
      }
    }
  }, [properties, selectedProperty, flyerProperty, shareProperty]);

  // Handle edit click - fetch full property with interested_contacts
  function handleNearMe() {
    if (nearMe) {
      setNearMe(null);
      return;
    }
    if (!navigator.geolocation) {
      toast.error(t('inventory.locationUnavailable'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPickedPlace(null);
        setLocationText('');
        setNearMe({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setPage(0);
      },
      () => {
        setLocating(false);
        toast.error(
          'Could not get your location — allow location access and try again.'
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  async function handleViewClick(
    property: Property,
    tab: 'details' | 'matches' = 'details'
  ) {
    setFormInitialTab(tab);
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch property details');
      }
      const fullProperty = await response.json();
      setSelectedProperty(fullProperty);
      setFormViewOnly(true);
      setFormOpen(true);
    } catch (err) {
      console.error('Failed to load property details:', err);
      // Fallback to list property if detail fetch fails
      setSelectedProperty(property);
      setFormViewOnly(true);
      setFormOpen(true);
    }
  }

  async function handleEditClick(property: Property) {
    setFormInitialTab('details');
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch property details');
      }
      const fullProperty = await response.json();
      setSelectedProperty(fullProperty);
      setFormViewOnly(false);
      setFormOpen(true);
    } catch (err) {
      console.error('Failed to load property details:', err);
      // Fallback to list property if detail fetch fails
      setSelectedProperty(property);
      setFormViewOnly(false);
      setFormOpen(true);
    }
  }

  // Handle add click
  function handleAddClick() {
    setSelectedProperty(null);
    setFormViewOnly(false);
    setFormInitialTab('details');
    setFormOpen(true);
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.delete('propertyId');
      const queryString = params.toString();
      pushUrl(router, `/inventory${queryString ? `?${queryString}` : ''}`);
      setSelectedProperty(null);
    }
  };

  // Handle flyer click
  function handleFlyerClick(property: Property) {
    setFlyerProperty(property);
    setFlyerOpen(true);
  }

  function handlePromoteClick(property: Property) {
    setPromoteProperty(property);
    setPromoteOpen(true);
  }

  // Handle share click
  function handleShareClick(property: Property) {
    setShareProperty(property);
    setShareOpen(true);
  }

  // Handle email share click
  function handleEmailShareClick(property: Property) {
    setEmailShareProperty(property);
    setEmailShareOpen(true);
  }

  // Handle delete confirmation click
  function handleDeleteClick(property: Property) {
    setDeleteTarget(property);
    setDeleteConfirmOpen(true);
  }

  // Perform delete request
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/properties/${deleteTarget.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to delete property');
      }

      toast.success('Property listing deleted successfully');
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Error deleting property';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  // Toggle publish status inline
  async function handleTogglePublish(property: Property) {
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_published: !property.is_published,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to update publication status');
      }

      toast.success(
        property.is_published
          ? 'Property hidden from showcase'
          : 'Property is now public on showcase'
      );
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to update status';
      toast.error(message);
    }
  }

  // Which portals each visible property is live on — feeds the tiny
  // "99 / MB / H" badges on the cards. A missing table (migration 121
  // not applied) just leaves the badges off.
  // Keyed by the ids actually on screen, so paging back to a page whose
  // badges are already cached costs nothing. The id list is bounded by
  // the page size (25), so it is safe in an `.in()` filter.
  const visiblePropertyIds = useMemo(
    () => properties.map((p) => p.id),
    [properties]
  );

  const portalBadgesQuery = useQuery({
    queryKey: ['inventory', 'portal-badges', accountId, visiblePropertyIds],
    queryFn: async () => {
      const supabaseClient = createClient();
      const { data } = await supabaseClient
        .from('property_portal_listings')
        .select('property_id, portal')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .in('property_id', visiblePropertyIds);
      const map: Record<string, string[]> = {};
      for (const row of data || []) {
        const code = PORTALS[row.portal as PortalKey]?.shortCode;
        if (!code) continue;
        if (!map[row.property_id]) map[row.property_id] = [];
        map[row.property_id].push(code);
      }
      return map;
    },
    enabled: Boolean(accountId) && visiblePropertyIds.length > 0,
  });
  const portalBadges = portalBadgesQuery.data ?? EMPTY_BADGES;

  // Buyer contacts for the per-card match counts, fetched once per visit
  // with only the columns src/lib/matching.ts reads — far lighter than
  // the form's full `select('*')` it repeats on every dialog open.
  const matchContactsQuery = useQuery({
    queryKey: ['inventory', 'match-contacts', accountId],
    queryFn: async () => {
      const supabaseClient = createClient();
      const { data, error } = await supabaseClient
        .from('contacts')
        .select(
          'id, classification, requirements, requirement_active, min_budget, max_budget, no_budget, min_roi, property_interests, areas_of_interest, areas_of_interest_geo, projects_of_interest, strict_project_match, strict_area_match, pref_property_types, pref_property_categories, pref_bhk_min, pref_bhk_max, pref_budget_min, pref_budget_max, pref_areas, pref_excluded_areas, pref_projects, pref_min_roi, pref_listing_types, pref_extracted_at, contact_notes(note_text)'
        )
        .eq('classification', 'Buyer');
      if (error) throw error;
      return (data ?? []) as unknown as Contact[];
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });

  const matchCounts = useMemo(() => {
    const buyers = matchContactsQuery.data;
    if (!buyers || buyers.length === 0 || properties.length === 0)
      return EMPTY_COUNTS;
    const counts: Record<string, number> = {};
    for (const property of properties) {
      counts[property.id] = getMatchingContacts(property, buyers).length;
    }
    return counts;
  }, [matchContactsQuery.data, properties]);

  // Toggle the Contacts-page interest-filter star. The server enforces
  // the cap too; this pre-check just gives a friendlier local error.
  async function handleToggleStar(property: Property) {
    try {
      if (!property.is_starred) {
        const supabaseClient = createClient();
        const { count } = await supabaseClient
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('is_starred', true);
        if ((count ?? 0) >= STARRED_PROPERTY_CAP) {
          toast.error(
            `You can star up to ${STARRED_PROPERTY_CAP} properties. Unstar one from Inventory first.`
          );
          return;
        }
      }

      const response = await fetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_starred: !property.is_starred,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to update star');
      }

      toast.success(
        property.is_starred
          ? 'Removed from Contacts quick filters'
          : `Starred — now a quick filter on the Contacts page (${property.property_code || property.title})`
      );
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to update star';
      toast.error(message);
    }
  }

  // Approve a "Pending Review" WhatsApp-submitted listing — publishes it,
  // syncs to the WhatsApp catalog, and sends a WhatsApp notification to
  // the tagged owner contact (if one is set on the property).
  async function handleApprove(property: Property) {
    try {
      const response = await fetch(`/api/properties/${property.id}/approve`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to approve listing');
      }
      const { notificationSent, ownerName } = (await response.json()) as {
        notificationSent: boolean;
        ownerName: string | null;
      };
      if (notificationSent && ownerName) {
        toast.success(
          `Listing approved — ${ownerName} has been notified via WhatsApp 📲`
        );
      } else {
        toast.success('Listing approved and published');
      }
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to approve listing';
      toast.error(message);
    }
  }

  // Reject a "Pending Review" listing — kept for audit rather than deleted.
  async function handleReject(property: Property) {
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Rejected' }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to reject listing');
      }
      toast.success('Listing rejected');
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to reject listing';
      toast.error(message);
    }
  }

  async function handleArchive(property: Property) {
    const newStatus = property.status === 'Archived' ? 'Available' : 'Archived';
    const label = newStatus === 'Archived' ? 'archived' : 'unarchived';
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error('Failed to update property status');
      toast.success(`Property ${label}`);
      refreshInventory();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : `Failed to ${label === 'archived' ? 'archive' : 'unarchive'} property`;
      toast.error(message);
    }
  }

  // stats is now sourced from the accurate global DB counts, not from the
  // current page slice. Aliased for minimal JSX diff below.
  const stats = globalStats;

  // The listing-party pills, rendered twice (tab row on sm+, own row on
  // mobile). Counts are the RPC's non-archived splits — the same rows
  // each pill yields on the All Listings tab — and are held back until
  // the stats load so the labels don't flash "(0)".
  const statsReady = Boolean(globalStatsQuery.data);
  const sourcePills = [
    { value: 'All', label: 'All', count: stats.activeTotal },
    { value: 'Owner', label: 'Direct', count: stats.direct },
    { value: 'Agent', label: 'Agent referred', count: stats.agentReferred },
  ] as const;

  return (
    <div className="flex flex-1 flex-col space-y-6 p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-white">
            <Building className="text-primary size-6" />
            Property Inventory
            <InfoHint text="Your central inventory of all properties, listings, and units available for sale or rent." />
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Manage your real estate listings and publish properties to showcase
            on the main portal.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && (
            <Button
              onClick={() => setPortalSyncOpen(true)}
              variant="outline"
              className="flex items-center gap-2 border-slate-800 bg-slate-900 text-sm font-semibold text-slate-200 shadow hover:bg-slate-800"
            >
              <RefreshCw className="text-primary size-4" /> Portal Sync
            </Button>
          )}
          <Button
            onClick={() => setShowcaseShareOpen(true)}
            variant="outline"
            className="flex items-center gap-2 border-slate-800 bg-slate-900 text-sm font-semibold text-slate-200 shadow hover:bg-slate-800"
          >
            <Share2 className="text-primary size-4" /> Share Showcase Portal
          </Button>
          {canEdit && (
            <Button
              onClick={() => setImportSharedOpen(true)}
              variant="outline"
              className="flex items-center gap-2 border-slate-800 bg-slate-900 text-sm font-semibold text-slate-200 shadow hover:bg-slate-800"
            >
              <FolderInput className="text-primary size-4" /> Import Shared
            </Button>
          )}
          {canEdit && (
            <Button
              onClick={handleAddClick}
              data-tour="add-property"
              className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2 text-sm font-semibold shadow"
            >
              <Plus className="size-4" /> Add Property
            </Button>
          )}
        </div>
      </div>

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
            <Building className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.total} />
            </div>
            <div className="flex items-center text-xs font-medium text-slate-400">
              Total Listings
              <InfoHint text="Total number of properties registered in your database." />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Eye className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.published} />
            </div>
            <div className="flex items-center text-xs font-medium text-slate-400">
              Showcased Publicly
              <InfoHint text="Properties currently visible to clients on your public Showcase portal." />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
            <CheckCircle className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.available} />
            </div>
            <div className="flex items-center text-xs font-medium text-slate-400">
              Available Units
              <InfoHint text="Active property listings that are currently available for purchase or lease." />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Tag className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.soldOrContract} />
            </div>
            <div className="flex items-center text-xs font-medium text-slate-400">
              Sold / Under Contract
              <InfoHint text="Properties that have been sold or are currently locked under a contract." />
            </div>
          </div>
        </div>
      </div>

      {/* Review Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800">
        <button
          type="button"
          onClick={() => {
            setReviewTab('all');
            setPage(0);
          }}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            reviewTab === 'all'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          All Listings
        </button>
        <button
          type="button"
          onClick={() => {
            setReviewTab('review');
            setPage(0);
          }}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            reviewTab === 'review'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Review
          {stats.pendingReview > 0 && (
            <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">
              {stats.pendingReview}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setReviewTab('archived');
            setPage(0);
          }}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            reviewTab === 'archived'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Archive className="size-3.5" />
          Archived
        </button>

        {/* Listing party — who the listing belongs to. 'Owner' is
            owner-direct (incl. WhatsApp/web self-listings, which the
            API groups under 'owner' only when stored that way);
            'Agent' is co-broked stock referred by an outside agent
            (owner_contact_id holds the referring agent's card). */}
        <div className="ml-4 hidden items-center gap-1 pb-1.5 sm:flex">
          {sourcePills.map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSourceFilter(value);
                setPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                sourceFilter === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
              {statsReady ? ` (${count})` : ''}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 pb-1.5">
          {[
            {
              value: 'grid' as const,
              icon: LayoutGrid,
              label: t('inventory.listView'),
            },
            {
              value: 'map' as const,
              icon: MapIcon,
              label: t('inventory.mapView'),
            },
          ].map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => setView(value)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                view === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Search Bar — inline on md+; on mobile it lives behind the
          floating lens button below so it costs no vertical space. */}
      <div className="hidden space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 md:block">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="e.g. residential properties > 10 Cr, 3 BHK villa"
              className="h-9 border-slate-700 bg-slate-800 pl-9 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="w-full md:w-80">
            <LocalityAutocomplete
              value={locationText}
              onChange={(text) => {
                setLocationText(text);
                // Clearing/retyping the text drops the active place filter
                if (pickedPlace && text !== pickedPlace.name)
                  setPickedPlace(null);
              }}
              onPick={(place) => {
                setNearMe(null);
                setPickedPlace(place);
                setLocationText(place.name);
              }}
              placeholder="Filter by locality (Google Maps)"
            />
          </div>
          <button
            type="button"
            onClick={handleNearMe}
            disabled={locating}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              nearMe
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {locating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <LocateFixed className="size-3.5" />
            )}
            {t('inventory.nearMe')}
          </button>
        </div>

        {(pickedPlace || nearMe) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">
              {pickedPlace ? (
                <>
                  Showing matches in{' '}
                  <span className="font-semibold text-white">
                    {pickedPlace.name}
                  </span>{' '}
                  first, then within
                </>
              ) : (
                <>{t('inventory.nearYou')}</>
              )}
            </span>
            {[2, 5, 10, 25].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                className={`rounded-full border px-2 py-0.5 font-semibold transition-colors ${
                  radiusKm === r
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {r} km
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPickedPlace(null);
                setNearMe(null);
                setLocationText('');
              }}
              className="ml-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 font-semibold text-slate-400 hover:text-white"
            >
              Clear ✕
            </button>
          </div>
        )}
      </div>

      {/* Mobile: the listing-party pills live on their own row — the
          tab bar has no horizontal room for them at 360px. */}
      <div className="flex items-center gap-1 sm:hidden">
        {sourcePills.map(({ value, label, count }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setSourceFilter(value);
              setPage(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              sourceFilter === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
            {statsReady ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {/* Mobile: active-filter summary chip row (visible while the
          overlay is closed, so an applied filter is never invisible). */}
      {(debouncedSearch.trim() || pickedPlace || nearMe) &&
        !mobileSearchOpen && (
          <div className="flex flex-wrap items-center gap-2 text-xs md:hidden">
            {debouncedSearch.trim() && (
              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                className="border-primary/40 bg-primary/10 max-w-[60vw] cursor-pointer truncate rounded-full border px-2.5 py-1 font-semibold text-white"
              >
                &ldquo;{debouncedSearch.trim()}&rdquo;
              </button>
            )}
            {pickedPlace && (
              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                className="border-primary/40 bg-primary/10 max-w-[40vw] cursor-pointer truncate rounded-full border px-2.5 py-1 font-semibold text-white"
              >
                📍 {pickedPlace.name} · {radiusKm} km
              </button>
            )}
            {nearMe && (
              <span className="border-primary/40 bg-primary/10 rounded-full border px-2.5 py-1 font-semibold text-white">
                📍 {t('inventory.nearMe')} · {radiusKm} km
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPickedPlace(null);
                setNearMe(null);
                setLocationText('');
              }}
              className="cursor-pointer rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 font-semibold text-slate-400"
            >
              Clear ✕
            </button>
          </div>
        )}

      {/* Mobile: floating lens — fixed, so it's reachable at any scroll
          depth. Sits above the global AI FAB in the corner. */}
      <button
        type="button"
        aria-label="Search inventory"
        onClick={() => setMobileSearchOpen(true)}
        className={`fixed right-4 bottom-24 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/95 text-slate-200 shadow-lg shadow-slate-950/50 backdrop-blur transition-transform active:scale-95 md:hidden ${
          mobileSearchOpen ? 'hidden' : ''
        }`}
      >
        <Search className="size-5" />
        {(debouncedSearch.trim() || pickedPlace) && (
          <span className="bg-primary absolute top-1 right-1 h-2.5 w-2.5 rounded-full border border-slate-900" />
        )}
      </button>

      {/* Mobile: search panel — in-flow and sticky, NOT an overlay, so
          the result list stays visible and live-updates while typing. */}
      {mobileSearchOpen && (
        <div className="sticky top-2 z-40 md:hidden">
          <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-xl shadow-slate-950/60 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                Search inventory
              </span>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setMobileSearchOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="e.g. residential properties > 10 Cr"
                className="h-10 border-slate-700 bg-slate-800 pl-9 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <LocalityAutocomplete
                  value={locationText}
                  onChange={(text) => {
                    setLocationText(text);
                    if (pickedPlace && text !== pickedPlace.name)
                      setPickedPlace(null);
                  }}
                  onPick={(place) => {
                    setNearMe(null);
                    setPickedPlace(place);
                    setLocationText(place.name);
                  }}
                  placeholder="Filter by locality (Google Maps)"
                />
              </div>
              <button
                type="button"
                aria-label="Near me"
                onClick={handleNearMe}
                disabled={locating}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  nearMe
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-slate-700 bg-slate-800 text-slate-300'
                }`}
              >
                {locating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LocateFixed className="size-4" />
                )}
              </button>
            </div>
            {(pickedPlace || nearMe) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Within</span>
                {[2, 5, 10, 25].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadiusKm(r)}
                    className={`rounded-full border px-2 py-0.5 font-semibold transition-colors ${
                      radiusKm === r
                        ? 'bg-primary/15 border-primary/50 text-primary'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPickedPlace(null);
                  setNearMe(null);
                  setLocationText('');
                }}
                className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-white"
              >
                Clear all
              </button>
              <Button
                size="sm"
                onClick={() => setMobileSearchOpen(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer px-4 text-xs font-bold"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid / Map View */}
      {view === 'map' ? (
        <PropertyMapView
          properties={mapQuery.data?.data ?? []}
          loading={mapQuery.isPending}
          center={
            nearMe ??
            (pickedPlace
              ? {
                  latitude: pickedPlace.latitude,
                  longitude: pickedPlace.longitude,
                }
              : null)
          }
          onOpen={handleViewClick}
          currency={currency}
        />
      ) : (
        <PropertyList
          properties={properties}
          loading={loading}
          onView={handleViewClick}
          onEdit={handleEditClick}
          onDelete={handleDeleteClick}
          onTogglePublish={handleTogglePublish}
          onToggleStar={handleToggleStar}
          onPortals={(property) => {
            setPortalProperty(property);
            setPortalOpen(true);
          }}
          portalBadges={portalBadges}
          canEdit={canEdit}
          onFlyer={handleFlyerClick}
          onPromote={META_ADS_ENABLED ? handlePromoteClick : undefined}
          onShare={handleShareClick}
          onMatches={(property) => handleViewClick(property, 'matches')}
          matchCounts={matchContactsQuery.data ? matchCounts : undefined}
          onEmailShare={handleEmailShareClick}
          onApprove={handleApprove}
          onReject={handleReject}
          onArchive={handleArchive}
          currency={currency}
        />
      )}

      {/* Add / Edit Form Modal */}
      <PropertyForm
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        property={selectedProperty}
        onSaved={() => refreshInventory()}
        viewOnly={formViewOnly}
        initialTab={formInitialTab}
      />

      {/* Import Shared Property Dialog */}
      <ImportSharedDialog
        open={importSharedOpen}
        onOpenChange={setImportSharedOpen}
        onImported={() => refreshInventory()}
      />

      {/* Flyer Creator Dialog */}
      <FlyerCreatorDialog
        open={flyerOpen}
        onOpenChange={setFlyerOpen}
        property={flyerProperty}
        onSaved={() => refreshInventory()}
      />

      {/* Promote (Meta Ads) Dialog */}
      {META_ADS_ENABLED && (
        <PromotePropertyDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          property={promoteProperty}
        />
      )}

      {/* Share Property Dialog */}
      <PropertyShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        property={shareProperty}
        onSaved={() => refreshInventory()}
        onPromote={META_ADS_ENABLED ? handlePromoteClick : undefined}
      />

      {/* Share via Email Dialog */}
      <PropertyEmailShareDialog
        open={emailShareOpen}
        onOpenChange={setEmailShareOpen}
        property={emailShareProperty}
      />

      {/* Post to Portals Dialog */}
      <PortalPostDialog
        open={portalOpen}
        onOpenChange={setPortalOpen}
        property={portalProperty}
        currency={currency}
        onSaved={refreshInventory}
      />

      {/* Portal Inventory Sync Dialog */}
      <PortalSyncDialog
        open={portalSyncOpen}
        onOpenChange={setPortalSyncOpen}
        onImported={() => {
          refreshInventory();
        }}
      />

      {/* Share Showcase Portal Dialog */}
      <ShowcaseShareDialog
        open={showcaseShareOpen}
        onOpenChange={setShowcaseShareOpen}
        accountId={accountId}
        showcaseSettings={showcaseSettings}
        activeSearch={search}
      />

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Trash2 className="size-5 text-red-500" />
              Delete Property Listing
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-white">
                &quot;{deleteTarget?.title}&quot;
              </span>
              ? This action is permanent and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-slate-700 bg-slate-900 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deleting}
              onClick={handleDeleteConfirm}
              className="bg-red-600 font-medium text-white hover:bg-red-700"
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {view === 'grid' && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <p className="text-xs text-slate-500">
            Showing {page * 25 + 1}-{Math.min((page + 1) * 25, totalCount)} of{' '}
            {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 text-xs text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
