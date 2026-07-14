'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Property, ShowcaseSettings } from '@/types';
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
} from 'lucide-react';
import { PropertyForm } from '@/components/inventory/property-form';
import { PropertyList } from '@/components/inventory/property-list';
import { LocalityAutocomplete, type PickedLocality } from '@/components/ui/locality-autocomplete';
import { FlyerCreatorDialog } from '@/components/inventory/flyer-creator-dialog';
import { PromotePropertyDialog } from '@/components/inventory/promote-property-dialog';

// Kill switch — the Promote button/dialog only exist where Meta Ads is
// configured on the deployment (see docs/meta-ads-integration-plan.md §2).
const META_ADS_ENABLED = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;
import { PropertyShareDialog } from '@/components/inventory/property-share-dialog';
import { PropertyEmailShareDialog } from '@/components/inventory/property-email-share-dialog';
import { ShowcaseShareDialog } from '@/components/inventory/showcase-share-dialog';
import { localCache } from '@/lib/cache-store';
import { STARRED_PROPERTY_CAP } from '@/lib/starred-properties';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { InfoHint } from '@/components/ui/info-hint';

export default function InventoryPage() {
  const canEdit = useCan('send-messages'); // Agent or higher can write
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';
  const initialPage = parseInt(searchParams?.get('page') || '0', 10);

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Tiered location search: picking a locality shows exact matches first,
  // then properties within radiusKm sorted by distance.
  const [locationText, setLocationText] = useState('');
  const [pickedPlace, setPickedPlace] = useState<PickedLocality | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);

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

  // Global stats — counts across ALL properties, independent of the
  // current page/filters so the summary cards always show accurate totals.
  const [globalStats, setGlobalStats] = useState({
    total: 0,
    published: 0,
    available: 0,
    soldOrContract: 0,
    pendingReview: 0,
  });

  // Filters
  const [typeFilter] = useState('All');
  const [reviewTab, setReviewTab] = useState<'all' | 'review' | 'archived'>('all');
  const statusFilter = reviewTab === 'review' ? 'Pending Review' : reviewTab === 'archived' ? 'Archived' : 'All';
  const [showcaseFilter] = useState('All');
  const [sourceFilter] = useState('All');

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [formViewOnly, setFormViewOnly] = useState(false);
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
  const [emailShareProperty, setEmailShareProperty] = useState<Property | null>(null);
  const [showcaseShareOpen, setShowcaseShareOpen] = useState(false);
  const [showcaseSettings, setShowcaseSettings] = useState<ShowcaseSettings | null>(null);

  const { accountId } = useAuth();
  const [currency, setCurrency] = useState('INR');
  const router = useRouter();

  const fetchShowcaseSettings = useCallback(async () => {
    if (!accountId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('showcase_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();
      if (data) {
        setShowcaseSettings(data);
        if (data.currency) {
          setCurrency(data.currency);
        }
      }
    } catch (err) {
      console.error('Failed to load showcase settings:', err);
    }
  }, [accountId]);

  useEffect(() => {
    fetchShowcaseSettings();
  }, [fetchShowcaseSettings]);

  // Fetch unfiltered, unpaginated counts for the summary stats panel.
  // Uses Supabase HEAD queries (count only, no rows transferred) so it
  // is cheap regardless of the total number of rows.
  const fetchGlobalStats = useCallback(async () => {
    if (!accountId) return;
    try {
      const supabase = createClient();
      const [totalRes, publishedRes, availableRes, soldRes, pendingReviewRes] = await Promise.all([
        supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId),
        supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('is_published', true),
        supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'Available'),
        supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .in('status', ['Sold', 'Under Contract']),
        supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'Pending Review'),
      ]);
      setGlobalStats({
        total: totalRes.count ?? 0,
        published: publishedRes.count ?? 0,
        available: availableRes.count ?? 0,
        soldOrContract: soldRes.count ?? 0,
        pendingReview: pendingReviewRes.count ?? 0,
      });
    } catch (err) {
      console.error('Failed to load global stats:', err);
    }
  }, [accountId]);

  useEffect(() => {
    fetchGlobalStats();
  }, [fetchGlobalStats]);

  const fetchProperties = useCallback(async () => {
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
    }
    if (typeFilter !== 'All') params.set('type', typeFilter);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (reviewTab === 'all') params.set('exclude_archived', 'true');
    if (showcaseFilter !== 'All') params.set('is_published', showcaseFilter === 'Showcased' ? 'true' : 'false');
    if (sourceFilter !== 'All') params.set('listing_source', sourceFilter === 'Owner' ? 'owner' : 'agent');

    const cacheKey = `properties-${params.toString()}`;
    const cached = localCache.get<{ data: Property[]; pagination: { total: number; totalPages: number } }>(cacheKey);

    if (cached) {
      setProperties(cached.data || []);
      setTotalCount(cached.pagination?.total || 0);
      setTotalPages(cached.pagination?.totalPages || 0);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch(`/api/properties?${params.toString()}&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch properties');
      }
      const result = await response.json();
      localCache.set(cacheKey, result);
      setProperties(result.data || []);
      setTotalCount(result.pagination?.total || 0);
      setTotalPages(result.pagination?.totalPages || 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error loading properties';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, pickedPlace, radiusKm, typeFilter, statusFilter, showcaseFilter, sourceFilter, reviewTab]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  // Sync page with URL
  useEffect(() => {
    const urlPage = parseInt(searchParams?.get('page') || '0', 10);
    if (urlPage !== page) {
      const params = new URLSearchParams(searchParams?.toString());
      params.set('page', String(page));
      router.replace(`/inventory?${params.toString()}`, { scroll: false });
    }
  }, [page, searchParams, router]);

  // Automatically open property form modal if propertyId is specified in query parameters
  useEffect(() => {
    const pid = searchParams?.get('propertyId');
    if (pid && !hasAutoOpened) {
      // Try finding in current list first
      let prop = properties.find((p) => p.id === pid || p.property_code === pid);
      
      const loadAndOpen = async () => {
        if (!prop) {
          // Not in current page, fetch from API
          try {
            const response = await fetch(`/api/properties/${pid}`, { cache: 'no-store' });
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
          setHasAutoOpened(true);
        }
      };
      
      loadAndOpen();
    }
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
  async function handleViewClick(property: Property) {
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
    setFormOpen(true);
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.delete('propertyId');
      const queryString = params.toString();
      router.push(`/inventory${queryString ? `?${queryString}` : ''}`, { scroll: false });
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
      localCache.clear();
      fetchProperties();
      fetchGlobalStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error deleting property';
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
      localCache.clear();
      fetchProperties();
      fetchGlobalStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      toast.error(message);
    }
  }

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
          toast.error(`You can star up to ${STARRED_PROPERTY_CAP} properties. Unstar one from Inventory first.`);
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
      localCache.clear();
      fetchProperties();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update star';
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
      const { notificationSent, ownerName } = await response.json() as {
        notificationSent: boolean;
        ownerName: string | null;
      };
      if (notificationSent && ownerName) {
        toast.success(`Listing approved — ${ownerName} has been notified via WhatsApp 📲`);
      } else {
        toast.success('Listing approved and published');
      }
      localCache.clear();
      fetchProperties();
      fetchGlobalStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to approve listing';
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
      localCache.clear();
      fetchProperties();
      fetchGlobalStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reject listing';
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
      localCache.clear();
      fetchProperties();
      fetchGlobalStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${label === 'archived' ? 'archive' : 'unarchive'} property`;
      toast.error(message);
    }
  }

  // stats is now sourced from the accurate global DB counts, not from the
  // current page slice. Aliased for minimal JSX diff below.
  const stats = globalStats;

  return (
    <div className="flex flex-col flex-1 p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Building className="size-6 text-primary" />
            Property Inventory
            <InfoHint text="Your central inventory of all properties, listings, and units available for sale or rent." />
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Manage your real estate listings and publish properties to showcase on the main portal.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={() => setShowcaseShareOpen(true)}
            variant="outline"
            className="border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-sm flex items-center gap-2 shadow"
          >
            <Share2 className="size-4 text-primary" /> Share Showcase Portal
          </Button>
          {canEdit && (
            <Button
              onClick={handleAddClick}
              data-tour="add-property"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm flex items-center gap-2 shadow"
            >
              <Plus className="size-4" /> Add Property
            </Button>
          )}
        </div>
      </div>

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
            <Building className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.total} />
            </div>
            <div className="text-xs text-slate-400 font-medium flex items-center">
              Total Listings
              <InfoHint text="Total number of properties registered in your database." />
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Eye className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.published} />
            </div>
            <div className="text-xs text-slate-400 font-medium flex items-center">
              Showcased Publicly
              <InfoHint text="Properties currently visible to clients on your public Showcase portal." />
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400 shrink-0">
            <CheckCircle className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.available} />
            </div>
            <div className="text-xs text-slate-400 font-medium flex items-center">
              Available Units
              <InfoHint text="Active property listings that are currently available for purchase or lease." />
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
            <Tag className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              <AnimatedCounter value={stats.soldOrContract} />
            </div>
            <div className="text-xs text-slate-400 font-medium flex items-center">
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
          onClick={() => { setReviewTab('all'); setPage(0); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            reviewTab === 'all'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          All Listings
        </button>
        <button
          type="button"
          onClick={() => { setReviewTab('review'); setPage(0); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            reviewTab === 'review'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Review
          {stats.pendingReview > 0 && (
            <span className="bg-purple-500/20 text-purple-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {stats.pendingReview}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setReviewTab('archived'); setPage(0); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            reviewTab === 'archived'
              ? 'border-primary text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Archive className="size-3.5" />
          Archived
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              placeholder='e.g. residential properties > 10 Cr, 3 BHK villa'
              className="pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
            />
          </div>
          <div className="w-full md:w-80">
            <LocalityAutocomplete
              value={locationText}
              onChange={(text) => {
                setLocationText(text);
                // Clearing/retyping the text drops the active place filter
                if (pickedPlace && text !== pickedPlace.name) setPickedPlace(null);
              }}
              onPick={(place) => {
                setPickedPlace(place);
                setLocationText(place.name);
              }}
              placeholder="Filter by locality (Google Maps)"
            />
          </div>
        </div>

        {pickedPlace && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">
              Showing matches in <span className="text-white font-semibold">{pickedPlace.name}</span> first, then within
            </span>
            {[2, 5, 10, 25].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                className={`px-2 py-0.5 rounded-full border font-semibold transition-colors ${
                  radiusKm === r
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {r} km
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPickedPlace(null); setLocationText(''); }}
              className="ml-1 px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-400 hover:text-white font-semibold"
            >
              Clear ✕
            </button>
          </div>
        )}
      </div>

      {/* Main Grid View */}
      <PropertyList
        properties={properties}
        loading={loading}
        onView={handleViewClick}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onTogglePublish={handleTogglePublish}
        onToggleStar={handleToggleStar}
        canEdit={canEdit}
        onFlyer={handleFlyerClick}
        onPromote={META_ADS_ENABLED ? handlePromoteClick : undefined}
        onShare={handleShareClick}
        onEmailShare={handleEmailShareClick}
        onApprove={handleApprove}
        onReject={handleReject}
        onArchive={handleArchive}
        currency={currency}
      />

      {/* Add / Edit Form Modal */}
      <PropertyForm
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        property={selectedProperty}
        onSaved={() => { localCache.clear(); fetchProperties(); fetchGlobalStats(); }}
        viewOnly={formViewOnly}
      />

      {/* Flyer Creator Dialog */}
      <FlyerCreatorDialog
        open={flyerOpen}
        onOpenChange={setFlyerOpen}
        property={flyerProperty}
        onSaved={() => { localCache.clear(); fetchProperties(); fetchGlobalStats(); }}
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
        onSaved={() => { localCache.clear(); fetchProperties(); fetchGlobalStats(); }}
      />

      {/* Share via Email Dialog */}
      <PropertyEmailShareDialog
        open={emailShareOpen}
        onOpenChange={setEmailShareOpen}
        property={emailShareProperty}
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
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="size-5 text-red-500" />
              Delete Property Listing
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete <span className="text-white font-semibold">&quot;{deleteTarget?.title}&quot;</span>? This action is permanent and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700 pt-2 border-t">
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
              className="bg-red-600 hover:bg-red-700 text-white font-medium"
            >
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <p className="text-xs text-slate-500">
            Showing {page * 25 + 1}-{Math.min((page + 1) * 25, totalCount)} of {totalCount}
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
            <span className="text-xs text-slate-400 px-2">
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
