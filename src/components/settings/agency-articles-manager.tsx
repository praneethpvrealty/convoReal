'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Loader2, Edit, Trash2, Image as ImageIcon } from 'lucide-react';
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
import type { AgencyArticle } from '@/types';

export function AgencyArticlesManager() {
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [articles, setArticles] = useState<AgencyArticle[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  const [selectedArticle, setSelectedArticle] = useState<AgencyArticle | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
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
    fetchArticles(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, accountId]);

  async function fetchArticles(accountId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('agency_articles')
        .select('*')
        .eq('account_id', accountId)
        .order('published_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (err) {
      console.error('Failed to fetch articles:', err);
      toast.error('Failed to load articles');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setSelectedArticle(null);
    setTitle('');
    setSlug('');
    setMetaTitle('');
    setMetaDescription('');
    setExcerpt('');
    setContent('');
    setImageUrl('');
    setIsActive(true);
    setDialogOpen(true);
  }

  function openEdit(article: AgencyArticle) {
    setSelectedArticle(article);
    setTitle(article.title);
    setSlug(article.slug || '');
    setMetaTitle(article.meta_title || '');
    setMetaDescription(article.meta_description || '');
    setExcerpt(article.excerpt || '');
    setContent(article.content || '');
    setImageUrl(article.image_url || '');
    setIsActive(article.is_active);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!title.trim() || !excerpt.trim() || !content.trim()) {
      toast.error('Title, excerpt, and content are required');
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
        excerpt: excerpt.trim(),
        content: content.trim(),
        image_url: imageUrl.trim() || null,
        is_active: isActive,
        // When inserting, it takes NOW() via DB default if we don't supply published_at
      };

      if (selectedArticle) {
        // Update
        const { data, error } = await supabase
          .from('agency_articles')
          .update(payload)
          .eq('id', selectedArticle.id)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Update refused or record not found.');
        toast.success('Article updated');
      } else {
        // Insert
        const { error } = await supabase
          .from('agency_articles')
          .insert(payload);
        if (error) throw error;
        toast.success('Article created');
      }

      setDialogOpen(false);
      await fetchArticles(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save article');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(article: AgencyArticle) {
    setSelectedArticle(article);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!selectedArticle) return;

    try {
      setDeleting(true);
      const { data, error } = await supabase
        .from('agency_articles')
        .delete()
        .eq('id', selectedArticle.id)
        .select('id');

      if (error) throw error;
      if (!data?.length) {
        throw new Error('Could not delete article.');
      }

      toast.success('Article deleted');
      setDeleteDialogOpen(false);
      setSelectedArticle(null);
      await fetchArticles(accountId!);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete article');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="flex flex-col items-center justify-center p-12 text-slate-400">
          <Loader2 className="size-8 animate-spin" />
          <p className="mt-4 text-sm">Loading articles...</p>
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
              Agency Articles & Insights
            </CardTitle>
            <CardDescription className="text-slate-400">
              Publish news and updates to your public Showcase page.
            </CardDescription>
          </div>
          <Button
            onClick={openCreate}
            size="sm"
            className="flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            New Article
          </Button>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 p-12 text-center">
              <p className="text-sm text-slate-400">
                You haven&apos;t published any articles yet.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={openCreate}
                className="mt-4 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <Plus className="mr-1.5 size-3.5" />
                Write Your First Article
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {articles.map((article) => (
                <div
                  key={article.id}
                  className="flex items-center justify-between py-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex size-12 shrink-0 overflow-hidden items-center justify-center rounded-xl bg-slate-800 text-slate-300">
                      {article.image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={article.image_url} alt="" className="h-full w-full object-cover opacity-75" />
                      ) : (
                        <ImageIcon className="size-5 opacity-50" />
                      )}
                    </div>
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                        {article.title}
                        {!article.is_active && (
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                            Hidden
                          </span>
                        )}
                      </h4>
                      <p className="mt-1 line-clamp-1 max-w-[400px] text-xs text-slate-400">
                        {article.excerpt}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Published {article.published_at ? new Date(article.published_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(article)}
                      className="text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Edit className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmDelete(article)}
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
              {selectedArticle ? 'Edit Article' : 'New Article'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Title</Label>
                <Input
                  placeholder="Article headline..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">URL Slug</Label>
                <Input
                  placeholder="e.g. my-first-article (auto-generated if empty)"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Excerpt</Label>
                <Textarea
                  placeholder="Short description for the card view..."
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  className="h-20 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Image URL (Optional)</Label>
                <Input
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
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
                  className="h-20 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2 h-full flex flex-col">
                <Label className="text-slate-300">Content</Label>
                <Textarea
                  placeholder="Full article content (Markdown supported on display)..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[220px] flex-1 resize-none border-slate-800 bg-slate-900 text-slate-200 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="col-span-1 sm:col-span-2">
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium text-slate-200">
                    Visibility
                  </Label>
                  <p className="text-[11px] text-slate-400">
                    Show this article on your public showcase.
                  </p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
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
                'Save Article'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm border-slate-800 bg-slate-950 sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-slate-200">Delete Article?</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-400">
            Are you sure you want to remove &quot;{selectedArticle?.title}&quot;? This cannot be undone.
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
