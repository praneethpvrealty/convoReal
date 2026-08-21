'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Loader2, Edit, Trash2, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { AgencyService } from '@/types';

export function AgencyServicesManager() {
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<AgencyService[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  const [selectedService, setSelectedService] = useState<AgencyService | null>(null);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [iconName, setIconName] = useState('Plug');
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);

  // Helper to generate a URL-safe slug
  function generateSlug(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    fetchServices(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, accountId]);

  async function fetchServices(accountId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('agency_services')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setServices(data || []);
    } catch (err) {
      console.error('Failed to fetch services:', err);
      toast.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setSelectedService(null);
    setTitle('');
    setSlug('');
    setMetaTitle('');
    setMetaDescription('');
    setDescription('');
    setContent('');
    setIconName('Plug');
    setSortOrder(services.length + 1);
    setIsActive(true);
    setDialogOpen(true);
  }

  function openEdit(service: AgencyService) {
    setSelectedService(service);
    setTitle(service.title);
    setSlug(service.slug || '');
    setMetaTitle(service.meta_title || '');
    setMetaDescription(service.meta_description || '');
    setDescription(service.description || '');
    setContent(service.content || '');
    setIconName(service.icon || 'Plug');
    setSortOrder(service.sort_order);
    setIsActive(service.is_active);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required');
      return;
    }

    try {
      setSaving(true);
      if (!user || !accountId) {
        toast.error('Not authenticated or account not loaded');
        return;
      }

      const finalSlug = slug.trim() || generateSlug(title.trim());

      const payload = {
        account_id: accountId,
        title: title.trim(),
        slug: finalSlug,
        meta_title: metaTitle.trim() || null,
        meta_description: metaDescription.trim() || null,
        description: description.trim(),
        content: content.trim() || null,
        icon: iconName.trim(),
        sort_order: sortOrder,
        is_active: isActive,
      };

      if (selectedService) {
        // Update
        const { data, error } = await supabase
          .from('agency_services')
          .update(payload)
          .eq('id', selectedService.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Update refused or record not found.');
        toast.success('Service updated');
      } else {
        // Insert
        const { error } = await supabase
          .from('agency_services')
          .insert(payload);
        if (error) throw error;
        toast.success('Service created');
      }

      setDialogOpen(false);
      await fetchServices(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save service');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(service: AgencyService) {
    setSelectedService(service);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!selectedService) return;

    try {
      setDeleting(true);
      const { data, error } = await supabase
        .from('agency_services')
        .delete()
        .eq('id', selectedService.id)
        .select('id');

      if (error) throw error;
      if (!data?.length) {
        throw new Error('Could not delete service.');
      }

      toast.success('Service deleted');
      setDeleteDialogOpen(false);
      setSelectedService(null);
      await fetchServices(accountId!);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete service');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="flex flex-col items-center justify-center p-12 text-slate-400">
          <Loader2 className="size-8 animate-spin" />
          <p className="mt-4 text-sm">Loading services...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="space-y-1">
            <CardTitle className="text-lg font-medium text-slate-200">
              Agency Services
            </CardTitle>
            <CardDescription className="text-slate-400">
              Manage the services displayed on your public Showcase page.
            </CardDescription>
          </div>
          <Button
            onClick={openCreate}
            size="sm"
            className="flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            New Service
          </Button>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 p-12 text-center">
              <p className="text-sm text-slate-400">
                You haven&apos;t added any services yet.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={openCreate}
                className="mt-4 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <Plus className="mr-1.5 size-3.5" />
                Add Your First Service
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {services.map((service) => (
                <div
                  key={service.id}
                  className="flex items-center justify-between py-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-300">
                      {service.is_active ? (
                        <span className="text-[10px] font-mono tracking-tighter opacity-50">ICON</span>
                      ) : (
                        <EyeOff className="size-4 opacity-50" />
                      )}
                    </div>
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                        {service.title}
                        {!service.is_active && (
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                            Hidden
                          </span>
                        )}
                      </h4>
                      <p className="mt-1 line-clamp-1 max-w-[400px] text-xs text-slate-400">
                        {service.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="mr-4 text-xs font-mono text-slate-500">
                      Order: {service.sort_order}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(service)}
                      className="text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Edit className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmDelete(service)}
                      className="text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl border-slate-800 bg-slate-950 sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-slate-200">
              {selectedService ? 'Edit Service' : 'New Service'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Title</Label>
                <Input
                  placeholder="e.g. Legal Consultation"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">URL Slug</Label>
                <Input
                  placeholder="e.g. legal-consultation"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Short Description</Label>
                <Textarea
                  placeholder="Describe this service briefly..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-20 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Icon (Lucide)</Label>
                  <Input
                    placeholder="e.g. Scale, Home, Plug"
                    value={iconName}
                    onChange={(e) => setIconName(e.target.value)}
                    className="border-slate-800 bg-slate-900 font-mono text-xs text-slate-200 placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Sort Order</Label>
                  <Input
                    type="number"
                    min="1"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value) || 1)}
                    className="border-slate-800 bg-slate-900 font-mono text-xs text-slate-200"
                  />
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2 flex flex-col h-full">
                <Label className="text-slate-300">Full Content (Optional)</Label>
                <Textarea
                  placeholder="Full page content (Markdown supported)..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[140px] flex-1 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">SEO Title (Optional)</Label>
                <Input
                  placeholder="Custom title for search engines..."
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">SEO Description (Optional)</Label>
                <Textarea
                  placeholder="Meta description for search results..."
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  className="h-16 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="col-span-1 sm:col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-slate-200">
                  Visibility
                </Label>
                <p className="text-[11px] text-slate-400">
                  Show this service on your public showcase.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Service'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm border-slate-800 bg-slate-950 sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-slate-200">Delete Service?</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-400">
            Are you sure you want to remove &quot;{selectedService?.title}&quot;? This cannot be undone.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
