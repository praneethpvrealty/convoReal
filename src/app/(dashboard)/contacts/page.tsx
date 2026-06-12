'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Smartphone,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { BulkImportModal, type BulkImportContact } from '@/components/contacts/bulk-import-modal';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { user, accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';

  const renderClassificationBadge = (classification?: string) => {
    if (!classification) return null;
    
    let styles = '';
    switch (classification) {
      case 'Owner':
        styles = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        break;
      case 'Seller':
        styles = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
        break;
      case 'Buyer':
        styles = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        break;
      case 'Agent':
        styles = 'bg-sky-500/10 text-sky-400 border-sky-500/20';
        break;
      case 'Others':
      default:
        styles = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
        break;
    }
    
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles}`}>
        {classification}
      </span>
    );
  };

  const handleWhatsAppClick = async (e: React.MouseEvent, contact: Contact) => {
    e.stopPropagation();
    if (!accountId) {
      toast.error('Account not loaded');
      return;
    }
    
    try {
      const { data: existing, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error finding conversation:', error);
      }

      if (existing) {
        router.push(`/inbox?c=${existing.id}`);
        return;
      }

      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: user?.id,
          contact_id: contact.id,
        })
        .select('id')
        .single();

      if (createError) {
        toast.error('Failed to start chat thread');
        console.error('Create conversation error:', createError);
        return;
      }

      router.push(`/inbox?c=${newConv.id}`);
    } catch (err) {
      console.error('WhatsApp redirect error:', err);
      toast.error('Something went wrong');
    }
  };

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk Device Import state
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportContacts, setBulkImportContacts] = useState<BulkImportContact[]>([]);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  const fetchTags = useCallback(async () => {
    const supabaseClient = createClient();
    const { data } = await supabaseClient.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    const supabaseClient = createClient();

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabaseClient
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    if (!data || data.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = data.map((c) => c.id);
    const { data: contactTags } = await supabaseClient
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = data.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [page, search, tagsMap]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  const handleDeviceImport = async () => {
    if (typeof navigator === 'undefined' || !('contacts' in navigator)) {
      toast.error('Device contacts picker is not supported on this browser/device.');
      return;
    }

    try {
      const supportedProps = await (navigator.contacts as any).getProperties();
      const fields = ['name', 'tel', 'email'].filter((f) => supportedProps.includes(f));
      
      const picked = await (navigator.contacts as any).select(fields, { multiple: true });
      if (!picked || picked.length === 0) return;

      if (picked.length === 1) {
        const c = picked[0];
        const name = c.name?.[0] || '';
        const phone = c.tel?.[0] || '';
        const email = c.email?.[0] || '';
        
        setEditContact({
          id: '',
          name,
          phone: normalizePhone(phone) || phone,
          email,
          company: '',
          classification: 'Others',
          account_id: accountId || '',
          user_id: user?.id || '',
        } as any);
        setEditContactTags([]);
        setFormOpen(true);
      } else {
        setBulkImportContacts(
          picked.map((c: any) => ({
            name: c.name?.[0] || '',
            phone: normalizePhone(c.tel?.[0]) || c.tel?.[0] || '',
            email: c.email?.[0] || '',
            classification: 'Others' as const,
            selected: true,
          }))
        );
        setBulkImportOpen(true);
      }
    } catch (err: any) {
      console.error('Device contact select failed:', err);
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'Failed to select contacts from device');
      }
    }
  };

  const handleBulkImportSave = async (toImport: BulkImportContact[]) => {
    if (!accountId) {
      toast.error('Account not loaded');
      return;
    }

    try {
      const records = toImport.map((c) => ({
        account_id: accountId,
        user_id: user?.id || null,
        name: c.name,
        phone: normalizePhone(c.phone) || c.phone,
        email: c.email || null,
        classification: c.classification,
        company: '',
      }));

      const { error } = await supabase.from('contacts').insert(records);

      if (error) throw error;

      toast.success(`Successfully imported ${records.length} contacts`);
      fetchContacts();
    } catch (err: any) {
      console.error('Bulk insert failed:', err);
      toast.error(err.message || 'Failed to save contacts');
      throw err;
    }
  };

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete contact');
    } else {
      toast.success('Contact deleted');
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Contacts</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your contact list. {totalCount > 0 && `${totalCount} total contacts.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {typeof navigator !== 'undefined' && 'contacts' in navigator && (
            <GatedButton
              variant="outline"
              canAct={canEdit}
              gateReason="add or import contacts"
              onClick={handleDeviceImport}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Smartphone className="size-4" />
              Import from Phone
            </GatedButton>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <Upload className="size-4" />
            Import
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Add Contact
          </GatedButton>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Reset pagination when the query changes — the result
            // set shrinks/grows, page N may no longer be valid.
            setPage(0);
          }}
          placeholder="Search by name, phone, or email..."
          className="pl-8 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400">Name</TableHead>
              <TableHead className="text-slate-400">Classification</TableHead>
              <TableHead className="text-slate-400">Phone</TableHead>
              <TableHead className="text-slate-400 hidden md:table-cell">Email</TableHead>
              <TableHead className="text-slate-400 hidden lg:table-cell">Company</TableHead>
              <TableHead className="text-slate-400 hidden md:table-cell">Tags</TableHead>
              <TableHead className="text-slate-400 hidden lg:table-cell">Created</TableHead>
              <TableHead className="text-slate-400 w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-slate-500">Loading contacts...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-slate-600" />
                    <p className="text-sm text-slate-500">
                      {search ? 'No contacts match your search.' : 'No contacts yet.'}
                    </p>
                    {!search && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        <Plus className="size-3.5" />
                        Add your first contact
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-slate-800 hover:bg-slate-900/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell className="text-white font-medium">
                    {contact.name || <span className="text-slate-500 italic">Unnamed</span>}
                  </TableCell>
                  <TableCell>
                    {renderClassificationBadge(contact.classification)}
                  </TableCell>
                  <TableCell className="text-slate-300 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <a
                        href={`tel:${contact.phone}`}
                        className="hover:text-primary hover:underline"
                        title="Call number"
                      >
                        {contact.phone}
                      </a>
                      <button
                        onClick={(e) => handleWhatsAppClick(e, contact)}
                        className="inline-flex items-center justify-center rounded-md size-6 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20 transition-all cursor-pointer"
                        title="Chat on WhatsApp"
                      >
                        <MessageSquare className="size-3.5 fill-current" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-400 hidden md:table-cell text-sm">
                    {contact.email || <span className="text-slate-600">-</span>}
                  </TableCell>
                  <TableCell className="text-slate-400 hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-slate-600">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-slate-500">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-500 text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-slate-400 hover:text-white"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-slate-900 border-slate-700"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-700" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
            {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
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
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        contacts={bulkImportContacts}
        onImport={handleBulkImportSave}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Contact</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="text-slate-200 font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
