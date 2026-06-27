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
} from 'lucide-react';
import { PropertyForm } from '@/components/inventory/property-form';
import { PropertyList } from '@/components/inventory/property-list';
import { FlyerCreatorDialog } from '@/components/inventory/flyer-creator-dialog';
import { PropertyShareDialog } from '@/components/inventory/property-share-dialog';
import { ShowcaseShareDialog } from '@/components/inventory/showcase-share-dialog';
import { localCache } from '@/lib/cache-store';

export default function InventoryPage() {
  const canEdit = useCan('send-messages'); // Agent or higher can write
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';
  const initialPage = parseInt(searchParams?.get('page') || '0', 10);

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Global stats — counts across ALL properties, independent of the
  // current page/filters so the summary cards always show accurate totals.
  const [globalStats, setGlobalStats] = useState({
    total: 0,
    published: 0,
    available: 0,
    soldOrContract: 0,
  });
  
  // Filters
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showcaseFilter, setShowcaseFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [formViewOnly, setFormViewOnly] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);
  const [flyerProperty, setFlyerProperty] = useState<Property | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareProperty, setShareProperty] = useState<Property | null>(null);
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
      const [totalRes, publishedRes, availableRes, soldRes] = await Promise.all([
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
      ]);
      setGlobalStats({
        total: totalRes.count ?? 0,
        published: publishedRes.count ?? 0,
        available: availableRes.count ?? 0,
        soldOrContract: soldRes.count ?? 0,
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
    if (search.trim()) params.set('search', search.trim());
    if (typeFilter !== 'All') params.set('type', typeFilter);
    if (statusFilter !== 'All') params.set('status', statusFilter);
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
  }, [page, search, typeFilter, statusFilter, showcaseFilter, sourceFilter]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  // Sync page with URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('page', String(page));
    router.replace(`/inventory?${params.toString()}`, { scroll: false });
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

  // Keep active modal property states in sync with the fetched properties list
  useEffect(() => {
    if (selectedProperty) {
      const updated = properties.find((p) => p.id === selectedProperty.id);
      if (updated && updated !== selectedProperty) {
        setSelectedProperty(updated);
      }
    }
    if (flyerProperty) {
      const updated = properties.find((p) => p.id === flyerProperty.id);
      if (updated && updated !== flyerProperty) {
        setFlyerProperty(updated);
      }
    }
    if (shareProperty) {
      const updated = properties.find((p) => p.id === shareProperty.id);
      if (updated && updated !== shareProperty) {
        setShareProperty(updated);
      }
    }
  }, [properties, selectedProperty, flyerProperty, shareProperty]);

  // Handle edit click - fetch full property with interested_contacts
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

  // Handle add click
  function handleAddClick() {
    setSelectedProperty(null);
    setFormViewOnly(false);
    setFormOpen(true);
  }

  // Handle flyer click
  function handleFlyerClick(property: Property) {
    setFlyerProperty(property);
    setFlyerOpen(true);
  }

  // Handle share click
  function handleShareClick(property: Property) {
    setShareProperty(property);
    setShareOpen(true);
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
            <div className="text-2xl font-bold text-white">{stats.total}</div>
            <div className="text-xs text-slate-400 font-medium">Total Listings</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Eye className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{stats.published}</div>
            <div className="text-xs text-slate-400 font-medium">Showcased Publicly</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400 shrink-0">
            <CheckCircle className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{stats.available}</div>
            <div className="text-xs text-slate-400 font-medium">Available Units</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
            <Tag className="size-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{stats.soldOrContract}</div>
            <div className="text-xs text-slate-400 font-medium">Sold / Under Contract</div>
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col lg:flex-row gap-4 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by title, location or keywords..."
            className="pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
          />
        </div>

        {/* Filter Selection Panel */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
           <select
             value={typeFilter}
             onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
             className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
           >
             <option value="All">All Categories</option>
             <option value="Residential">Residential</option>
             <option value="Commercial">Commercial</option>
             <option value="Agricultural">Agricultural</option>
           </select>

           <select
             value={statusFilter}
             onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
             className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
           >
             <option value="All">All Statuses</option>
             <option value="Available">Available</option>
             <option value="Under Contract">Under Contract</option>
             <option value="Sold">Sold</option>
             <option value="Off Market">Off Market</option>
           </select>

           <select
             value={showcaseFilter}
             onChange={(e) => { setShowcaseFilter(e.target.value); setPage(0); }}
             className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
           >
             <option value="All">All Showcase</option>
             <option value="Showcased">Showcased Only</option>
             <option value="Private">Private Only</option>
           </select>

           <select
             value={sourceFilter}
             onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
             className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
           >
             <option value="All">All Sources</option>
             <option value="Owner">Direct (Owner)</option>
             <option value="Agent">Referred by Agent</option>
           </select>
        </div>
      </div>

      {/* Main Grid View */}
      <PropertyList
        properties={properties}
        loading={loading}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onTogglePublish={handleTogglePublish}
        canEdit={canEdit}
        onFlyer={handleFlyerClick}
        onShare={handleShareClick}
        currency={currency}
      />

      {/* Add / Edit Form Modal */}
      <PropertyForm
        open={formOpen}
        onOpenChange={setFormOpen}
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

      {/* Share Property Dialog */}
      <PropertyShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        property={shareProperty}
        onSaved={() => { localCache.clear(); fetchProperties(); fetchGlobalStats(); }}
      />

      {/* Share Showcase Portal Dialog */}
      <ShowcaseShareDialog
        open={showcaseShareOpen}
        onOpenChange={setShowcaseShareOpen}
        accountId={accountId}
        showcaseSettings={showcaseSettings}
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
