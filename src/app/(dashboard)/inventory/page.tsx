'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Property } from '@/types';
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
} from 'lucide-react';
import { PropertyForm } from '@/components/inventory/property-form';
import { PropertyList } from '@/components/inventory/property-list';
import { FlyerCreatorDialog } from '@/components/inventory/flyer-creator-dialog';
import { PropertyShareDialog } from '@/components/inventory/property-share-dialog';

export default function InventoryPage() {
  const canEdit = useCan('send-messages'); // Agent or higher can write
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  
  // Filters
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showcaseFilter, setShowcaseFilter] = useState('All');

  // Modals state
  const [formOpen, setFormOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);
  const [flyerProperty, setFlyerProperty] = useState<Property | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareProperty, setShareProperty] = useState<Property | null>(null);

  const { accountId } = useAuth();
  const [currency, setCurrency] = useState('INR');

  const fetchCurrency = useCallback(async () => {
    if (!accountId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('showcase_settings')
        .select('currency')
        .eq('account_id', accountId)
        .maybeSingle();
      if (data?.currency) {
        setCurrency(data.currency);
      }
    } catch (err) {
      console.error('Failed to load showcase settings currency:', err);
    }
  }, [accountId]);

  useEffect(() => {
    fetchCurrency();
  }, [fetchCurrency]);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/properties?_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch properties');
      }
      const data = await response.json();
      setProperties(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error loading properties';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

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

  // Handle edit click
  function handleEditClick(property: Property) {
    setSelectedProperty(property);
    setFormOpen(true);
  }

  // Handle add click
  function handleAddClick() {
    setSelectedProperty(null);
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
      fetchProperties();
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
      fetchProperties();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      toast.error(message);
    }
  }

  // Calculate statistics for showcase boxes
  const stats = useMemo(() => {
    const total = properties.length;
    const published = properties.filter((p) => p.is_published).length;
    const available = properties.filter((p) => p.status === 'Available').length;
    const soldOrContract = properties.filter(
      (p) => p.status === 'Sold' || p.status === 'Under Contract'
    ).length;

    return { total, published, available, soldOrContract };
  }, [properties]);

  // Client-side filtering logic for instant search/filter responsiveness
  const filteredProperties = useMemo(() => {
    return properties.filter((prop) => {
      // 1. Search term match
      if (search.trim()) {
        const term = search.toLowerCase();
        const matchesTitle = prop.title.toLowerCase().includes(term);
        const matchesLoc = prop.location.toLowerCase().includes(term);
        const matchesDesc = prop.description?.toLowerCase()?.includes(term) ?? false;
        const matchesProject = prop.project?.toLowerCase()?.includes(term) ?? false;
        const matchesFacing = prop.facing_direction?.toLowerCase()?.includes(term) ?? false;
        const matchesDim = prop.dimensions?.toLowerCase()?.includes(term) ?? false;
        const matchesFeatures = prop.features?.some(f => f.toLowerCase().includes(term)) ?? false;
        const matchesHighlights = prop.nearby_highlights?.some(h => h.toLowerCase().includes(term)) ?? false;

        if (!matchesTitle && !matchesLoc && !matchesDesc && !matchesProject && !matchesFacing && !matchesDim && !matchesFeatures && !matchesHighlights) return false;
      }

      // 2. Type filter match
      if (typeFilter !== 'All') {
        const resTypes = ['Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Residential Land/ Plot', 'Penthouse', 'Studio Apartment'];
        const commTypes = ['Commercial Office Space', 'Office in IT Park/ SEZ', 'Commercial Shop', 'Commercial Showroom', 'Commercial Land', 'Warehouse/ Godown', 'Industrial Land', 'Industrial Building', 'Industrial Shed'];
        const agriTypes = ['Agricultural Land', 'Farm House'];

        if (typeFilter === 'Residential' && !resTypes.includes(prop.type)) return false;
        if (typeFilter === 'Commercial' && !commTypes.includes(prop.type)) return false;
        if (typeFilter === 'Agricultural' && !agriTypes.includes(prop.type)) return false;
      }

      // 3. Status filter match
      if (statusFilter !== 'All' && prop.status !== statusFilter) return false;

      // 4. Showcase filter match
      if (showcaseFilter === 'Showcased' && !prop.is_published) return false;
      if (showcaseFilter === 'Private' && prop.is_published) return false;

      return true;
    });
  }, [properties, search, typeFilter, statusFilter, showcaseFilter]);

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
        {canEdit && (
          <Button
            onClick={handleAddClick}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shrink-0 flex items-center gap-2 shadow"
          >
            <Plus className="size-4" /> Add Property
          </Button>
        )}
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, location or keywords..."
            className="pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
          />
        </div>

        {/* Filter Selection Panel */}
        <div className="grid grid-cols-3 gap-3 shrink-0">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
          >
            <option value="All">All Categories</option>
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
            <option value="Agricultural">Agricultural</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
            onChange={(e) => setShowcaseFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
          >
            <option value="All">All Showcase</option>
            <option value="Showcased">Showcased Only</option>
            <option value="Private">Private Only</option>
          </select>
        </div>
      </div>

      {/* Main Grid View */}
      <PropertyList
        properties={filteredProperties}
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
        onSaved={fetchProperties}
      />

      {/* Flyer Creator Dialog */}
      <FlyerCreatorDialog
        open={flyerOpen}
        onOpenChange={setFlyerOpen}
        property={flyerProperty}
        onSaved={fetchProperties}
      />

      {/* Share Property Dialog */}
      <PropertyShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        property={shareProperty}
        onSaved={fetchProperties}
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
    </div>
  );
}
