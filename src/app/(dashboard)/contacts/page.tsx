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
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { BulkImportModal, type BulkImportContact } from '@/components/contacts/bulk-import-modal';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import { CalendarDays } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZE = 25;

const BUDGET_OPTIONS = [
  { label: '5 Lakhs', value: '500000' },
  { label: '10 Lakhs', value: '1000000' },
  { label: '20 Lakhs', value: '2000000' },
  { label: '30 Lakhs', value: '3000000' },
  { label: '40 Lakhs', value: '4000000' },
  { label: '50 Lakhs', value: '5000000' },
  { label: '60 Lakhs', value: '6000000' },
  { label: '80 Lakhs', value: '8000000' },
  { label: '1 Crore', value: '10000000' },
  { label: '1.5 Crores', value: '15000000' },
  { label: '2 Crores', value: '20000000' },
  { label: '3 Crores', value: '30000000' },
  { label: '5 Crores', value: '50000000' },
  { label: '7 Crores', value: '70000000' },
  { label: '10 Crores', value: '100000000' },
  { label: '15 Crores', value: '150000000' },
  { label: '20 Crores', value: '200000000' },
  { label: '30 Crores', value: '300000000' },
  { label: '50 Crores', value: '500000000' },
  { label: '75 Crores', value: '750000000' },
  { label: '100 Crores', value: '1000000000' },
  { label: '150 Crores', value: '1500000000' },
  { label: '200 Crores', value: '2000000000' },
];

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
      case 'Developer':
        styles = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
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

  const renderLeadTempBadge = (leadTemp?: string | null) => {
    if (!leadTemp) return null;
    let styles = '';
    switch (leadTemp) {
      case 'HOT':
        styles = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
        break;
      case 'COLD':
        styles = 'bg-sky-500/10 text-sky-400 border-sky-500/20';
        break;
      case 'Not Responding':
        styles = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        break;
      case 'Dead':
        styles = 'bg-slate-600/10 text-slate-400 border-slate-500/20';
        break;
      default:
        return null;
    }
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium ${styles}`}>
        {leadTemp === 'HOT' && '🔥 '}
        {leadTemp === 'COLD' && '❄️ '}
        {leadTemp === 'Not Responding' && '⏳ '}
        {leadTemp === 'Dead' && '💀 '}
        {leadTemp}
      </span>
    );
  };

  const formatBudget = (contact: Contact) => {
    if (contact.no_budget) return 'No Limit';
    if (!contact.max_budget) return '-';
    const amount = Number(contact.max_budget);
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
    } else if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} L`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  };


  const handleWhatsAppClick = async (e: React.MouseEvent, contact: Contact) => {
    e.stopPropagation();
    if (!accountId) {
      toast.error('Account not loaded');
      return;
    }
    
    const cleanPhone = contact.phone.replace(/\D/g, '');
    if (!cleanPhone) {
      toast.error('Invalid phone number');
      return;
    }

    let appOpened = false;
    const handleBlur = () => {
      appOpened = true;
    };
    window.addEventListener('blur', handleBlur);

    // Try opening native WhatsApp client
    window.location.href = `whatsapp://send?phone=${cleanPhone}`;

    setTimeout(async () => {
      window.removeEventListener('blur', handleBlur);
      if (!appOpened) {
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
      }
    }, 1500);
  };

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'active' | 'pending_review'>('active');
  const [activeCount, setActiveCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  const [filterClassification, setFilterClassification] = useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');
  const [filterMinBudget, setFilterMinBudget] = useState<string>('All');
  const [filterMaxBudget, setFilterMaxBudget] = useState<string>('All');
  const [filterArea, setFilterArea] = useState<string>('All');
  // All unique areas across all contacts for the area filter dropdown
  const [allAreas, setAllAreas] = useState<string[]>([]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleContactId, setScheduleContactId] = useState<string | null>(null);

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

  const fetchAreas = useCallback(async () => {
    if (!accountId) return;
    const supabaseClient = createClient();
    const { data } = await supabaseClient
      .from('contacts')
      .select('areas_of_interest')
      .eq('account_id', accountId)
      .not('areas_of_interest', 'is', null);
    if (data) {
      const unique = Array.from(
        new Set(
          data.flatMap((c) => (c.areas_of_interest as string[] | null) ?? [])
            .filter(Boolean)
            .map((a: string) => a.trim())
        )
      ).sort();
      setAllAreas(unique);
    }
  }, [accountId]);

  const fetchContacts = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabaseClient = createClient();

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabaseClient
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('status', activeTab)
      .order('created_at', { ascending: false });

    if (filterClassification !== 'All') {
      query = query.eq('classification', filterClassification);
    }

    if (filterTag !== 'All') {
      const { data: matchedTags } = await supabaseClient
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', filterTag);
      
      const tagContactIds = matchedTags
        ? Array.from(new Set(matchedTags.map((t) => t.contact_id).filter(Boolean)))
        : [];
      
      if (tagContactIds.length > 0) {
        query = query.in('id', tagContactIds);
      } else {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    }

    if (filterMinBudget !== 'All') {
      const minVal = Number(filterMinBudget);
      query = query.or(`max_budget.gte.${minVal},no_budget.eq.true`);
    }

    if (filterMaxBudget !== 'All') {
      const maxVal = Number(filterMaxBudget);
      query = query.lte('max_budget', maxVal);
    }

    if (filterArea !== 'All') {
      // areas_of_interest is a text[] column — filter contacts whose array contains the selected area
      query = query.contains('areas_of_interest', [filterArea]);
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      const { data: matchedNotes } = await supabaseClient
        .from('contact_notes')
        .select('contact_id')
        .eq('account_id', accountId)
        .ilike('note_text', term);
      
      const noteContactIds = matchedNotes
        ? Array.from(new Set(matchedNotes.map((n) => n.contact_id).filter(Boolean)))
        : [];
      
      let orFilter = `name.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term},source.ilike.${term},requirements.ilike.${term},classification.ilike.${term}`;
      if (noteContactIds.length > 0) {
        orFilter += `,id.in.(${noteContactIds.join(',')})`;
      }
      query = query.or(orFilter);
    }

    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    // Fetch tab totals in the background
    const [actCountRes, revCountRes] = await Promise.all([
      supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'active'),
      supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'pending_review'),
    ]);

    setActiveCount(actCountRes.count ?? 0);
    setReviewCount(revCountRes.count ?? 0);

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
  }, [
    page,
    search,
    tagsMap,
    activeTab,
    accountId,
    filterClassification,
    filterTag,
    filterMinBudget,
    filterMaxBudget,
    filterArea,
  ]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    fetchTags();
    fetchAreas();
  }, [fetchTags, fetchAreas]);


  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Automatically open contact detail modal if contactId is specified in query parameters
  useEffect(() => {
    const cid = searchParams?.get('contactId');
    if (cid && !hasAutoOpened) {
      setDetailContactId(cid);
      setDetailOpen(true);
      setHasAutoOpened(true);
    }
  }, [searchParams, hasAutoOpened]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  interface ContactsManager {
    getProperties(): Promise<string[]>;
    select(
      properties: string[],
      options?: { multiple?: boolean }
    ): Promise<Array<{
      name?: string[];
      tel?: string[];
      email?: string[];
    }>>;
  }

  const handleDeviceImport = async () => {
    if (typeof navigator === 'undefined' || !('contacts' in navigator)) {
      toast.error('Device contacts picker is not supported on this browser/device.');
      return;
    }

    try {
      const manager = (navigator as unknown as { contacts: ContactsManager }).contacts;
      const supportedProps = await manager.getProperties();
      const fields = ['name', 'tel', 'email'].filter((f) => supportedProps.includes(f));
      
      const picked = await manager.select(fields, { multiple: true });
      if (!picked || picked.length === 0) return;

      if (picked.length === 1) {
        const c = picked[0];
        const name = c.name?.[0] || '';
        const phone = c.tel?.[0] || '';
        const email = c.email?.[0] || '';
        
        setEditContact({
          id: '',
          user_id: user?.id || '',
          phone: normalizePhoneWithCountryCode(phone) || phone,
          name,
          email,
          company: '',
          classification: 'Others',
          status: 'active',
          source: 'Phonebook',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Contact);
        setEditContactTags([]);
        setFormOpen(true);
      } else {
        setBulkImportContacts(
          picked.map((c) => ({
            name: c.name?.[0] || '',
            phone: c.tel?.[0] ? (normalizePhoneWithCountryCode(c.tel[0]) || c.tel[0]) : '',
            email: c.email?.[0] || '',
            classification: 'Others' as const,
            selected: true,
          }))
        );
        setBulkImportOpen(true);
      }
    } catch (err) {
      const error = err as Error;
      console.error('Device contact select failed:', error);
      if (error.name !== 'AbortError') {
        toast.error(error.message || 'Failed to select contacts from device');
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
        phone: normalizePhoneWithCountryCode(c.phone) || c.phone,
        email: c.email || null,
        classification: c.classification,
        company: '',
        source: 'Phonebook',
      }));

      const { error } = await supabase.from('contacts').insert(records);

      if (error) throw error;

      toast.success(`Successfully imported ${records.length} contacts`);
      fetchContacts();
    } catch (err) {
      const error = err as Error;
      console.error('Bulk insert failed:', error);
      toast.error(error.message || 'Failed to save contacts');
      throw error;
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

      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search bar */}
          <div className="relative w-full sm:max-w-xs md:max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search by name, phone, or email..."
              className="pl-8 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          {/* Classification Filter */}
          <Select
            value={filterClassification}
            onValueChange={(val) => {
              setFilterClassification(val ?? 'All');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-[160px] bg-slate-900 border-slate-700 text-white">
              <SelectValue placeholder="Classification" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="All">All Classifications</SelectItem>
              <SelectItem value="Owner">Owner</SelectItem>
              <SelectItem value="Seller">Seller</SelectItem>
              <SelectItem value="Buyer">Buyer</SelectItem>
              <SelectItem value="Agent">Agent</SelectItem>
              <SelectItem value="Developer">Developer</SelectItem>
              <SelectItem value="Others">Others</SelectItem>
            </SelectContent>
          </Select>

          {/* Tag Filter */}
          <Select
            value={filterTag}
            onValueChange={(val) => {
              setFilterTag(val ?? 'All');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-[150px] bg-slate-900 border-slate-700 text-white">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="All">All Tags</SelectItem>
              {Object.values(tagsMap).map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="truncate">{tag.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Min Budget Filter */}
          <Select
            value={filterMinBudget}
            onValueChange={(val) => {
              setFilterMinBudget(val ?? 'All');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-[140px] bg-slate-900 border-slate-700 text-white">
              <SelectValue placeholder="Min Budget" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="All">Min Budget: All</SelectItem>
              {BUDGET_OPTIONS.map((opt) => (
                <SelectItem key={`min-${opt.value}`} value={opt.value}>
                  ≥ {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Max Budget Filter */}
          <Select
            value={filterMaxBudget}
            onValueChange={(val) => {
              setFilterMaxBudget(val ?? 'All');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-[140px] bg-slate-900 border-slate-700 text-white">
              <SelectValue placeholder="Max Budget" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="All">Max Budget: All</SelectItem>
              {BUDGET_OPTIONS.map((opt) => (
                <SelectItem key={`max-${opt.value}`} value={opt.value}>
                  ≤ {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Areas of Preference Filter */}
          {allAreas.length > 0 && (
            <Select
              value={filterArea}
              onValueChange={(val) => {
                setFilterArea(val ?? 'All');
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-[170px] bg-slate-900 border-slate-700 text-white">
                <SelectValue placeholder="Area" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                <SelectItem value="All">All Areas</SelectItem>
                {allAreas.map((area) => (
                  <SelectItem key={area} value={area}>
                    {area}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Clear Filters Button */}
          {(filterClassification !== 'All' || filterTag !== 'All' || filterMinBudget !== 'All' || filterMaxBudget !== 'All' || filterArea !== 'All' || search.trim() !== '') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterClassification('All');
                setFilterTag('All');
                setFilterMinBudget('All');
                setFilterMaxBudget('All');
                setFilterArea('All');
                setSearch('');
                setPage(0);
              }}
              className="text-slate-400 hover:text-white text-xs border border-dashed border-slate-700 hover:border-slate-500 rounded-md px-2.5"
            >
              Clear Filters
            </Button>
          )}
        </div>


        {/* Tab Switcher */}
        <div className="flex bg-slate-900/60 p-1 border border-slate-800 rounded-lg self-start">
          <button
            onClick={() => {
              setActiveTab('active');
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'active'
                ? 'bg-slate-800 text-primary shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Contacts ({activeCount})
          </button>
          <button
            onClick={() => {
              setActiveTab('pending_review');
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'pending_review'
                ? 'bg-slate-800 text-amber-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Needs Review ({reviewCount})
            {reviewCount > 0 && (
              <span className="inline-flex items-center justify-center bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded-full text-[9px] min-w-[16px] h-4 leading-none animate-pulse">
                {reviewCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400 text-xs">Name</TableHead>
              <TableHead className="text-slate-400 text-xs">Classification</TableHead>
              <TableHead className="text-slate-400 text-xs">Phone</TableHead>
              <TableHead className="text-slate-400 text-xs">Tags</TableHead>
              <TableHead className="text-slate-400 text-xs">Last Contacted</TableHead>
              <TableHead className="text-slate-400 text-xs">Areas of Interest</TableHead>
              <TableHead className="text-slate-400 text-xs">Property Category Interests</TableHead>
              <TableHead className="text-slate-400 text-xs">Max Budget</TableHead>
              <TableHead className="text-slate-400 w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-slate-500">Loading contacts...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-slate-600" />
                    <p className="text-sm text-slate-500">
                      {search
                        ? 'No contacts match your search.'
                        : activeTab === 'pending_review'
                        ? 'No contacts pending review.'
                        : 'No contacts yet.'}
                    </p>
                    {!search && activeTab === 'active' && (
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
                  <TableCell className="text-white font-medium py-3">
                    <div className="flex flex-col gap-1">
                      <span>{contact.name || <span className="text-slate-500 italic text-xs">Unnamed</span>}</span>
                      {contact.lead_temp && (
                        <div className="mt-0.5">
                          {renderLeadTempBadge(contact.lead_temp)}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    {renderClassificationBadge(contact.classification)}
                  </TableCell>
                  <TableCell className="text-slate-300 font-mono text-xs py-3" onClick={(e) => e.stopPropagation()}>
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
                  <TableCell className="py-3">
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
                  <TableCell className="text-slate-400 text-xs py-3">
                    {contact.last_contacted_at ? (
                      new Date(contact.last_contacted_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      })
                    ) : (
                      <span className="text-slate-600">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs py-3">
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {contact.areas_of_interest && contact.areas_of_interest.length > 0 ? (
                        contact.areas_of_interest.map((area) => (
                          <span
                            key={area}
                            className="inline-flex items-center rounded bg-slate-800 text-slate-300 px-1.5 py-0.5 text-[9px] font-medium border border-slate-700"
                          >
                            {area}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 text-xs">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs py-3">
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {contact.property_interests && contact.property_interests.length > 0 ? (
                        contact.property_interests.map((interest) => (
                          <span
                            key={interest}
                            className="inline-flex items-center rounded bg-slate-800 text-slate-300 px-1.5 py-0.5 text-[9px] font-medium border border-slate-700"
                          >
                            {interest}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 text-xs">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300 font-medium text-xs py-3">
                    {formatBudget(contact)}
                  </TableCell>
                  <TableCell className="py-3">
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
                            setScheduleContactId(contact.id);
                            setScheduleOpen(true);
                          }}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          <CalendarDays className="size-4" />
                          Schedule
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-700" />
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

      {/* Schedule Dialog */}
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        contactId={scheduleContactId}
      />
    </div>
  );
}
