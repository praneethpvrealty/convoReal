'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Contact, Tag, ContactTag, ShowcaseSettings, Property } from '@/types';
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
  Star,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  Smartphone,
  X,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  SlidersHorizontal,
  Eye,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';
import { BulkImportModal, type BulkImportContact } from '@/components/contacts/bulk-import-modal';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import { CalendarDays } from 'lucide-react';
import { DuplicatesPanel } from '@/components/contacts/duplicates-panel';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parsePropertyQuery } from '@/lib/search-parser';
import { STARRED_PROPERTY_CAP } from '@/lib/starred-properties';
import { localCache } from '@/lib/cache-store';

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
  const { user, profile, accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

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

  const [showcaseSettings, setShowcaseSettings] = useState<ShowcaseSettings | null>(null);

  const fetchShowcaseSettings = useCallback(async () => {
    if (!accountId) return;
    const supabaseClient = createClient();
    const { data } = await supabaseClient
      .from('showcase_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) {
      setShowcaseSettings(data);
    }
  }, [accountId]);

  const getPrefilledWhatsAppLink = (contact: Contact, propDetails?: Property | null) => {
    const cleanPhone = contact.phone.replace(/\D/g, '');
    if (!cleanPhone) return '';

    const agentName = profile?.full_name || '';
    const displayName = contact.name || 'there';
    
    // Resolve showcase URL
    let finalShowcaseUrl = '';
    let showcaseUrlObj: URL | null = null;
    if (typeof window !== 'undefined') {
      const baseDomain = window.location.host;
      const parts = baseDomain.split('.');
      let hostDomain = baseDomain;
      if (parts.length > 2 && !baseDomain.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(baseDomain)) {
        hostDomain = parts.slice(1).join('.');
      }
      const targetDomain = showcaseSettings?.subdomain 
        ? `${showcaseSettings.subdomain}.${hostDomain}` 
        : baseDomain;
      showcaseUrlObj = new URL(`${window.location.protocol}//${targetDomain}`);
      if (!showcaseSettings?.subdomain && accountId) {
        showcaseUrlObj.searchParams.set('ref', accountId);
      }
      finalShowcaseUrl = showcaseUrlObj.toString();
    }

    let linkSection = '';
    if (showcaseUrlObj) {
      if (propDetails) {
        const singlePropUrl = new URL(showcaseUrlObj.toString());
        singlePropUrl.searchParams.set('property_id', propDetails.property_code || propDetails.id);
        
        const matchingUrl = new URL(showcaseUrlObj.toString());
        if (propDetails.listing_type) {
          matchingUrl.searchParams.set('listing_type', propDetails.listing_type);
        }
        if (propDetails.type) {
          matchingUrl.searchParams.set('category', propDetails.type);
        }
        const searchLocation = propDetails.sublocality || propDetails.city || '';
        if (searchLocation) {
          matchingUrl.searchParams.set('search', searchLocation);
        }
        
        linkSection = `Meanwhile, you can view details for the property you enquired about here:
${singlePropUrl.toString()}

Or browse other matching verified properties here:
${matchingUrl.toString()}`;
      } else {
        const hasInterestFilters = (contact.areas_of_interest && contact.areas_of_interest.length > 0) || 
                                   (contact.property_interests && contact.property_interests.length > 0);
        
        if (hasInterestFilters) {
          const matchingUrl = new URL(showcaseUrlObj.toString());
          if (contact.areas_of_interest && contact.areas_of_interest.length > 0) {
            matchingUrl.searchParams.set('search', contact.areas_of_interest[0]);
          }
          if (contact.property_interests && contact.property_interests.length > 0) {
            matchingUrl.searchParams.set('category', contact.property_interests[0]);
          }
          
          const filterDesc = [
            contact.property_interests?.[0],
            contact.areas_of_interest?.[0] ? `in ${contact.areas_of_interest[0]}` : ''
          ].filter(Boolean).join(' ');
          
          linkSection = `Meanwhile, you can browse verified ${filterDesc || 'matching'} properties here:
${matchingUrl.toString()}`;
        } else {
          linkSection = `Meanwhile, you can browse 500+ verified properties matching different budgets here:
${finalShowcaseUrl}`;
        }
      }
    } else {
      linkSection = `Meanwhile, you can browse 500+ verified properties matching different budgets here:
${finalShowcaseUrl}`;
    }

    const message = `Hi ${displayName} 👋
Thank you for your property enquiry. I'm ${agentName}, your real estate consultant.

To help me suggest the best options, could you please share:
• Preferred location
• Budget
• Flat/Plot/Villa
• Ready-to-move or under-construction

${linkSection}

Once you share your requirements, I'll personally shortlist the best 5–10 properties for you.`;

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  const handlePrefilledWhatsAppClick = async (e: React.MouseEvent, contact: Contact) => {
    e.stopPropagation();
    
    let propDetails: Property | null = null;
    if (contact.last_inquired_property_id) {
      const toastId = toast.loading('Preparing personalized link...');
      try {
        const supabaseClient = createClient();
        const { data } = await supabaseClient
          .from('properties')
          .select('*')
          .eq('id', contact.last_inquired_property_id)
          .maybeSingle();
        propDetails = data as unknown as Property;
      } catch (err) {
        console.error('Failed to fetch property details:', err);
      } finally {
        toast.dismiss(toastId);
      }
    }
    
    const link = getPrefilledWhatsAppLink(contact, propDetails);
    if (link) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else {
      toast.error('Invalid phone number or showcase settings not loaded');
    }
  };

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  // `search` drives the controlled input for instant typing feedback;
  // `debouncedSearch` is what actually triggers fetchContacts (via its
  // dependency array below). Without this split, every keystroke fired a
  // full network round-trip (plus, for NLP-style queries, several extra
  // parallel note/tag lookups) — see the debounce effect further down.
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'active' | 'pending_review' | 'transacted' | 'market_active'>('active');
  const [activeCount, setActiveCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [transactedCount, setTransactedCount] = useState(0);
  const [marketActiveCount, setMarketActiveCount] = useState(0);

  const [filterClassification, setFilterClassification] = useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');
  const [filterMinBudget, setFilterMinBudget] = useState<string>('All');
  const [filterMaxBudget, setFilterMaxBudget] = useState<string>('All');
  const [filterArea, setFilterArea] = useState<string>('All');
  // Starred-property interest chips (fed from Inventory stars): the
  // selected chip narrows the list to contacts who showed interest in
  // that property (last_inquired_property_id ∪ contact_property_inquiries).
  const [starredProps, setStarredProps] = useState<{ id: string; property_code: string | null; title: string }[]>([]);
  const [filterInterestProperty, setFilterInterestProperty] = useState<string>('All');
  // Touch equivalent of the chip's hover-expand: long-press (~450ms)
  // reveals the full property title for 3s. A completed long-press
  // must NOT also toggle the filter, so the click that follows it is
  // swallowed via chipPressFired.
  const [expandedInterestChip, setExpandedInterestChip] = useState<string | null>(null);
  const chipPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipPressFired = useRef(false);

  const beginChipPress = (id: string) => {
    chipPressFired.current = false;
    chipPressTimer.current = setTimeout(() => {
      chipPressFired.current = true;
      setExpandedInterestChip(id);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10);
      if (chipCollapseTimer.current) clearTimeout(chipCollapseTimer.current);
      chipCollapseTimer.current = setTimeout(() => setExpandedInterestChip(null), 3000);
    }, 450);
  };

  const endChipPress = () => {
    if (chipPressTimer.current) {
      clearTimeout(chipPressTimer.current);
      chipPressTimer.current = null;
    }
  };
  // All unique areas across all contacts for the area filter dropdown
  const [allAreas, setAllAreas] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>('created_desc');

  // Debounce the search box: only commit to `debouncedSearch` (and reset to
  // page 0) 350ms after the user stops typing, instead of on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const searchParam = searchParams?.get('search');
    if (searchParam !== null && searchParam !== undefined) {
      setSearch(searchParam);
    }
    const classificationParam = searchParams?.get('classification');
    if (classificationParam) {
      setFilterClassification(classificationParam);
    }
    const tagParam = searchParams?.get('tag');
    if (tagParam) {
      setFilterTag(tagParam);
    }
  }, [searchParams]);

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

  // Populates the "Area" filter dropdown. This has to scan every contact's
  // areas_of_interest column (no cheap indexed DISTINCT-unnest available),
  // so it's cached for 5 minutes and — unlike fetchTags/fetchContacts — only
  // triggered lazily when the user actually opens the Filters panel, instead
  // of unconditionally on every Contacts page mount.
  const fetchAreas = useCallback(async () => {
    if (!accountId) return;
    const cacheKey = `contacts-areas-${accountId}`;
    const cached = localCache.get<string[]>(cacheKey, 5 * 60 * 1000);
    if (cached) {
      setAllAreas(cached);
      return;
    }
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
      localCache.set(cacheKey, unique);
    }
  }, [accountId]);

  // Load the account's starred properties for the quick-filter chips.
  // Errors (e.g. migration 120 not applied yet) just hide the chips.
  const fetchStarredProps = useCallback(async () => {
    if (!accountId) return;
    const supabaseClient = createClient();
    const { data } = await supabaseClient
      .from('properties')
      .select('id, property_code, title')
      .eq('account_id', accountId)
      .eq('is_starred', true)
      .order('updated_at', { ascending: false })
      .limit(STARRED_PROPERTY_CAP);
    setStarredProps(data || []);
  }, [accountId]);

  useEffect(() => {
    fetchStarredProps();
  }, [fetchStarredProps]);

  // If the active chip's property was unstarred elsewhere, drop the filter.
  useEffect(() => {
    if (filterInterestProperty !== 'All' && !starredProps.some((p) => p.id === filterInterestProperty)) {
      setFilterInterestProperty('All');
    }
  }, [starredProps, filterInterestProperty]);

  const fetchContacts = useCallback(async () => {
    if (!accountId) return;
    const supabaseClient = createClient();

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const cacheKey = `contacts-${accountId}-${page}-${activeTab}-${sortBy}-${filterClassification}-${filterTag}-${filterMinBudget}-${filterMaxBudget}-${filterArea}-${filterInterestProperty}-${debouncedSearch}`;
    const cached = localCache.get<{ enriched: ContactWithTags[]; totalCount: number; activeCount: number; reviewCount: number; transactedCount: number; marketActiveCount: number }>(cacheKey);

    if (cached) {
      setContacts(cached.enriched || []);
      setTotalCount(cached.totalCount || 0);
      setActiveCount(cached.activeCount || 0);
      setReviewCount(cached.reviewCount || 0);
      setTransactedCount(cached.transactedCount || 0);
      setMarketActiveCount(cached.marketActiveCount || 0);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      // Fetch profile phone numbers for this account to exclude them
      const { data: profilesData } = await supabaseClient
        .from('profiles')
        .select('phone')
        .eq('account_id', accountId);

      const profilePhones = (profilesData || [])
        .map((p) => p.phone ? p.phone.replace(/\D/g, '') : '')
        .filter((p) => p.length >= 8);

      let internalContactIds: string[] = [];
      if (profilePhones.length > 0) {
        const orConditions = profilePhones.map(p => `phone.like.%${p.slice(-8)}`).join(',');
        const { data: matchingContacts } = await supabaseClient
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .or(orConditions);

        if (matchingContacts) {
          internalContactIds = matchingContacts.map((c) => c.id);
        }
      }

      // Scoped to what the table row, edit form, and delete/WhatsApp actions
      // actually read — dropping `requirements` (free text) and other unused
      // columns cuts payload size meaningfully at 25 rows/page. `.or()` search
      // filters below reference DB columns directly, so they still work even
      // though `requirements` isn't in the returned shape.
      let query = supabaseClient
        .from('contacts')
        .select(
          'id, user_id, name, name_tag, phone, email, company, classification, lead_temp, last_contacted_at, last_inquired_property_id, referrer, referrer_contact_id, min_budget, max_budget, no_budget, areas_of_interest, property_interests, min_roi, source, status, created_at, updated_at',
          { count: 'exact' },
        )
        .eq('account_id', accountId);

      if (internalContactIds.length > 0) {
        query = query.not('id', 'in', `(${internalContactIds.join(',')})`);
      }

      if (activeTab === 'active' || activeTab === 'pending_review') {
        query = query.eq('status', activeTab);
      } else {
        // transacted and market_active are active contacts
        query = query.eq('status', 'active');

        if (activeTab === 'transacted') {
          const { data: wonDeals } = await supabaseClient
            .from('deals')
            .select('contact_id')
            .eq('status', 'won');
          const transactedContactIds = Array.from(new Set(wonDeals?.map((d) => d.contact_id).filter(Boolean) || []));
          if (transactedContactIds.length > 0) {
            query = query.in('id', transactedContactIds);
          } else {
            query = query.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        } else if (activeTab === 'market_active') {
          query = query.or('lead_temp.eq.HOT,last_inquired_property_id.not.is.null');
        }
      }

      // Apply sorting logic
      if (sortBy === 'name_asc') {
        query = query.order('name', { ascending: true, nullsFirst: false });
      } else if (sortBy === 'name_desc') {
        query = query.order('name', { ascending: false, nullsFirst: false });
      } else if (sortBy === 'last_contacted_desc') {
        query = query.order('last_contacted_at', { ascending: false, nullsFirst: false });
      } else if (sortBy === 'last_contacted_asc') {
        query = query.order('last_contacted_at', { ascending: true, nullsFirst: false });
      } else if (sortBy === 'max_budget_desc') {
        query = query.order('max_budget', { ascending: false, nullsFirst: false });
      } else if (sortBy === 'max_budget_asc') {
        query = query.order('max_budget', { ascending: true, nullsFirst: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

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

      if (filterInterestProperty !== 'All') {
        // Interest = the property form's "interested contacts" link OR a
        // recorded inquiry (portal lead email, manual log) for this property.
        const [inquiryRes, lastInquiredRes] = await Promise.all([
          supabaseClient
            .from('contact_property_inquiries')
            .select('contact_id')
            .eq('property_id', filterInterestProperty),
          supabaseClient
            .from('contacts')
            .select('id')
            .eq('account_id', accountId)
            .eq('last_inquired_property_id', filterInterestProperty),
        ]);
        const interestedIds = Array.from(
          new Set([
            ...(inquiryRes.data?.map((r) => r.contact_id) || []),
            ...(lastInquiredRes.data?.map((r) => r.id) || []),
          ].filter(Boolean))
        );
        if (interestedIds.length > 0) {
          query = query.in('id', interestedIds);
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

      if (debouncedSearch.trim()) {
        const parsed = parsePropertyQuery(debouncedSearch.trim());
        const isNlpQuery =
          parsed.locations.length > 0 ||
          parsed.types.length > 0 ||
          parsed.bedrooms !== null ||
          parsed.minPrice !== null ||
          parsed.maxPrice !== null;

        if (isNlpQuery) {
          // 1. Fetch contact IDs from notes matching locations, types, and bedrooms in parallel
          const getLocNotes = async (): Promise<{ contact_id: string }[]> => {
            if (parsed.locations.length === 0) return [];
            const locFilters = parsed.locations.map(loc => `note_text.ilike.%${loc}%`).join(',');
            const { data } = await supabaseClient
              .from('contact_notes')
              .select('contact_id')
              .eq('account_id', accountId)
              .or(locFilters);
            return (data as { contact_id: string }[]) || [];
          };

          const getTypeNotes = async (): Promise<{ contact_id: string }[]> => {
            if (parsed.types.length === 0) return [];
            const typeFilters = parsed.types.map(type => `note_text.ilike.%${type}%`).join(',');
            const { data } = await supabaseClient
              .from('contact_notes')
              .select('contact_id')
              .eq('account_id', accountId)
              .or(typeFilters);
            return (data as { contact_id: string }[]) || [];
          };

          const getBedNotes = async (): Promise<{ contact_id: string }[]> => {
            if (parsed.bedrooms === null) return [];
            const b = parsed.bedrooms;
            const bedFilters = `note_text.ilike.%${b}%bhk%,note_text.ilike.%${b}%bedroom%,note_text.ilike.%${b}%bed%`;
            const { data } = await supabaseClient
              .from('contact_notes')
              .select('contact_id')
              .eq('account_id', accountId)
              .or(bedFilters);
            return (data as { contact_id: string }[]) || [];
          };

          // 2. Fetch contact IDs from tags matching types
          const getTagContactIds = async (): Promise<string[]> => {
            if (parsed.types.length === 0) return [];
            const tagFilters = parsed.types.map(t => `name.ilike.${t}`).join(',');
            const { data: tags } = await supabaseClient
              .from('tags')
              .select('id')
              .or(tagFilters);
            
            const tagIds = (tags || []).map(t => t.id);
            if (tagIds.length === 0) return [];
            const { data: ctData } = await supabaseClient
              .from('contact_tags')
              .select('contact_id')
              .in('tag_id', tagIds);
            return (ctData || []).map(ct => ct.contact_id).filter(Boolean);
          };

          const [locNotes, typeNotes, bedNotes, tagContactIds] = await Promise.all([
            getLocNotes(),
            getTypeNotes(),
            getBedNotes(),
            getTagContactIds(),
          ]);

          const locNoteContactIds = Array.from(new Set(locNotes.map(n => n.contact_id).filter(Boolean)));
          const typeNoteContactIds = Array.from(new Set(typeNotes.map(n => n.contact_id).filter(Boolean)));
          const bedNoteContactIds = Array.from(new Set(bedNotes.map(n => n.contact_id).filter(Boolean)));

          // Combine type note and tag IDs
          const typeContactIds = Array.from(new Set([...typeNoteContactIds, ...tagContactIds]));

          // Limit lists to prevent URL length limits (HTTP 414)
          const safeLocIds = locNoteContactIds.slice(0, 150);
          const safeTypeIds = typeContactIds.slice(0, 150);
          const safeBedIds = bedNoteContactIds.slice(0, 150);

          // 3. Apply location filters
          if (parsed.locations.length > 0) {
            let locOrs = parsed.locations.map(loc => `requirements.ilike.%${loc}%,areas_of_interest.cs.{"${loc}"}`).join(',');
            if (safeLocIds.length > 0) {
              locOrs += `,id.in.(${safeLocIds.join(',')})`;
            }
            query = query.or(locOrs);
          }

          // 4. Apply type filters
          if (parsed.types.length > 0) {
            let typeOrs = parsed.types.map(t => `requirements.ilike.%${t}%,property_interests.cs.{"${t}"}`).join(',');
            if (safeTypeIds.length > 0) {
              typeOrs += `,id.in.(${safeTypeIds.join(',')})`;
            }
            query = query.or(typeOrs);
          }

          // 5. Apply bedroom filters
          if (parsed.bedrooms !== null) {
            const b = parsed.bedrooms;
            let bedOrs = `requirements.ilike.%${b}%bhk%,requirements.ilike.%${b}%bedroom%,requirements.ilike.%${b}%bed%`;
            if (safeBedIds.length > 0) {
              bedOrs += `,id.in.(${safeBedIds.join(',')})`;
            }
            query = query.or(bedOrs);
          }

          // 6. Apply budget filters (overlap logic)
          if (parsed.maxPrice !== null) {
            query = query.or(`min_budget.lte.${parsed.maxPrice},min_budget.is.null`);
          }
          if (parsed.minPrice !== null) {
            query = query.or(`max_budget.gte.${parsed.minPrice},max_budget.is.null,no_budget.eq.true`);
          }

          // 7. Fallback for remaining search text
          if (parsed.remainingSearch) {
            const term = `%${parsed.remainingSearch}%`;
            const cleanSearch = parsed.remainingSearch.trim().replace(/["'{}\\]/g, '');
            const { data: matchedNotes } = await supabaseClient
              .from('contact_notes')
              .select('contact_id')
              .eq('account_id', accountId)
              .ilike('note_text', term);

            const remainingNoteContactIds = matchedNotes
              ? Array.from(new Set(matchedNotes.map((n) => n.contact_id).filter(Boolean)))
              : [];
            const safeRemainingIds = remainingNoteContactIds.slice(0, 150);

            let orFilter = `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term},source.ilike.${term},requirements.ilike.${term},classification.ilike.${term}`;
            if (cleanSearch) {
              orFilter += `,secondary_phones.cs.{"${cleanSearch}"}`;
            }
            if (safeRemainingIds.length > 0) {
              orFilter += `,id.in.(${safeRemainingIds.join(',')})`;
            }
            query = query.or(orFilter);
          }
        } else {
          // Simple text-search query fallback
          const term = `%${debouncedSearch.trim()}%`;
          const cleanSearch = debouncedSearch.trim().replace(/["'{}\\]/g, '');
          const { data: matchedNotes } = await supabaseClient
              .from('contact_notes')
              .select('contact_id')
              .eq('account_id', accountId)
              .ilike('note_text', term);

          const noteContactIds = matchedNotes
            ? Array.from(new Set(matchedNotes.map((n) => n.contact_id).filter(Boolean)))
            : [];
          const safeNoteIds = noteContactIds.slice(0, 150);

          let orFilter = `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term},source.ilike.${term},requirements.ilike.${term},classification.ilike.${term}`;
          if (cleanSearch) {
            orFilter += `,secondary_phones.cs.{"${cleanSearch}"}`;
          }
          if (safeNoteIds.length > 0) {
            orFilter += `,id.in.(${safeNoteIds.join(',')})`;
          }
          query = query.or(orFilter);
        }
      }

      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) {
        toast.error('Failed to load contacts');
        setLoading(false);
        return;
      }

      setTotalCount(count ?? 0);

      // Fetch won deals first
      const { data: wonDeals } = await supabaseClient
        .from('deals')
        .select('contact_id')
        .eq('status', 'won');
      const transactedIds = Array.from(new Set(wonDeals?.map((d) => d.contact_id).filter(Boolean) || []));

      // Fetch tab totals in the background
      let actQuery = supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'active');
      
      let revQuery = supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'pending_review');

      let transactedQuery = supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'active')
        .in('id', transactedIds.length > 0 ? transactedIds : ['00000000-0000-0000-0000-000000000000']);

      let marketActiveQuery = supabaseClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'active')
        .or('lead_temp.eq.HOT,last_inquired_property_id.not.is.null');

      if (internalContactIds.length > 0) {
        const notInString = `(${internalContactIds.join(',')})`;
        actQuery = actQuery.not('id', 'in', notInString);
        revQuery = revQuery.not('id', 'in', notInString);
        transactedQuery = transactedQuery.not('id', 'in', notInString);
        marketActiveQuery = marketActiveQuery.not('id', 'in', notInString);
      }

      const [actCountRes, revCountRes, transactedCountRes, marketActiveCountRes] = await Promise.all([
        actQuery,
        revQuery,
        transactedQuery,
        marketActiveQuery,
      ]);

      setActiveCount(actCountRes.count ?? 0);
      setReviewCount(revCountRes.count ?? 0);
      setTransactedCount(transactedCountRes.count ?? 0);
      setMarketActiveCount(marketActiveCountRes.count ?? 0);

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

      localCache.set(cacheKey, {
        enriched,
        totalCount: count ?? 0,
        activeCount: actCountRes.count ?? 0,
        reviewCount: revCountRes.count ?? 0,
        transactedCount: transactedCountRes.count ?? 0,
        marketActiveCount: marketActiveCountRes.count ?? 0,
      });

      setContacts(enriched);
      setLoading(false);
    } catch (err: unknown) {
      console.error('Error fetching contacts:', err);
      toast.error('An unexpected error occurred while loading contacts');
      setLoading(false);
    }
  }, [
    page,
    debouncedSearch,
    tagsMap,
    activeTab,
    accountId,
    filterClassification,
    filterTag,
    filterMinBudget,
    filterMaxBudget,
    filterArea,
    filterInterestProperty,
    sortBy,
  ]);

  const fetchContactsWithInvalidate = useCallback(() => {
    localCache.clear();
    fetchContacts();
  }, [fetchContacts]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  // Note: fetchAreas is intentionally NOT called here — it's a full-table
  // scan just to populate the Area filter dropdown, so it's deferred until
  // the user actually opens the Filters panel (see the isFiltersOpen effect
  // below).
  useEffect(() => {
    fetchTags();
    fetchShowcaseSettings();
  }, [fetchTags, fetchShowcaseSettings]);

  // Lazily load the Area filter options only when the Filters panel opens.
  useEffect(() => {
    if (isFiltersOpen) {
      fetchAreas();
    }
  }, [isFiltersOpen, fetchAreas]);


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
        const rawName = c.name?.[0] || '';
        const split = suggestNameTagSplit(rawName);
        const phone = c.tel?.[0] || '';
        const email = c.email?.[0] || '';

        setEditContact({
          id: '',
          user_id: user?.id || '',
          phone: normalizePhoneWithCountryCode(phone) || phone,
          name: split?.name ?? rawName,
          name_tag: split?.nameTag ?? null,
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
          picked.map((c) => {
            const rawName = c.name?.[0] || '';
            const split = suggestNameTagSplit(rawName);
            return {
              name: split?.name ?? rawName,
              name_tag: split?.nameTag ?? '',
              phone: c.tel?.[0] ? (normalizePhoneWithCountryCode(c.tel[0]) || c.tel[0]) : '',
              email: c.email?.[0] || '',
              classification: 'Others' as const,
              selected: true,
            };
          })
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
        name_tag: c.name_tag.trim() || null,
        phone: normalizePhoneWithCountryCode(c.phone) || c.phone,
        email: c.email || null,
        classification: c.classification,
        company: '',
        source: 'Phonebook',
      }));

      const { error } = await supabase.from('contacts').insert(records);

      if (error) throw error;

      toast.success(`Successfully imported ${records.length} contacts`);
      fetchContactsWithInvalidate();
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

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.delete('contactId');
      const queryString = params.toString();
      router.push(`/contacts${queryString ? `?${queryString}` : ''}`, { scroll: false });
      setDetailContactId(null);
    }
  };

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
      fetchContactsWithInvalidate();
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
          <h1 className="text-2xl font-bold text-white flex items-center">
            Contacts
            <InfoHint text="Your address book containing all clients, agents, and other contacts, where you can log budgets, locations of interest, and custom notes." />
          </h1>
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
            data-tour="add-contact"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Add Contact
          </GatedButton>
        </div>
      </div>

      {/* Duplicate detection panel — only visible to agents+ when dupes exist */}
      <DuplicatesPanel onMergeComplete={fetchContactsWithInvalidate} />

      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 w-full">
          {/* Search bar */}
          <div className="relative flex-1 max-w-sm sm:max-w-xs md:max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email..."
              className="pl-8.5 pr-10 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-1 h-9.5 rounded-xl"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  // Explicit clear — apply instantly instead of waiting for
                  // the debounce timeout typing goes through.
                  setSearch('');
                  setDebouncedSearch('');
                  setPage(0);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white hover:bg-slate-800 p-1 rounded-md transition-all cursor-pointer"
                title="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filters Toggle Button */}
          {(() => {
            const activeCount = [
              filterClassification !== 'All',
              filterTag !== 'All',
              filterMinBudget !== 'All',
              filterMaxBudget !== 'All',
              filterArea !== 'All',
            ].filter(Boolean).length;

            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFiltersOpen(true)}
                className={cn(
                  "h-9.5 rounded-xl border-slate-700 bg-slate-900 text-slate-350 hover:text-white hover:bg-slate-800 flex items-center gap-2 px-3.5 font-bold transition-all relative shrink-0",
                  activeCount > 0 && "border-primary/40 text-white bg-primary/5 hover:bg-primary/10"
                )}
              >
                <SlidersHorizontal className="size-4 text-slate-400 group-hover:text-white" />
                <span>Filters</span>
                {activeCount > 0 && (
                  <span className="flex items-center justify-center bg-primary text-primary-foreground font-black text-[9px] size-4.5 rounded-full shadow-[0_0_8px_hsl(var(--primary)/0.6)]">
                    {activeCount}
                  </span>
                )}
              </Button>
            );
          })()}

          {/* Quick Sort Selector (Desktop Only) */}
          <div className="hidden sm:block shrink-0">
            <Select
              value={sortBy}
              onValueChange={(val) => {
                setSortBy(val ?? 'created_desc');
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9.5 w-[160px] bg-slate-900 border-slate-700 text-white rounded-xl text-xs font-bold">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                <SelectItem value="created_desc">Newest Created</SelectItem>
                <SelectItem value="name_asc">Name (A - Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z - A)</SelectItem>
                <SelectItem value="last_contacted_desc">Last Contacted</SelectItem>
                <SelectItem value="max_budget_desc">Budget (Highest)</SelectItem>
                <SelectItem value="max_budget_asc">Budget (Lowest)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Starred-property interest chips — starred in Inventory, each
            chip filters to contacts who showed interest in that listing.
            The label is the property code; hovering (or long-pressing on
            touch devices) expands the full title. */}
        {starredProps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-1">
            <span className="flex items-center text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
              <Star className="size-3 text-amber-400 fill-amber-400 mr-1" />
              Interested in:
              <InfoHint text="These quick filters are the properties you starred on the Inventory page (star icon on a listing's photo, up to 6). Tap a chip to see contacts who showed interest in that property — from the property form's interested-contacts links and logged portal/email inquiries. Unstar the property in Inventory and its chip disappears." />
            </span>
            {starredProps.map((p) => {
              const active = filterInterestProperty === p.id;
              const expanded = expandedInterestChip === p.id;
              const label = p.property_code || p.title.split(/\s+/).slice(0, 2).join(' ');
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    // A completed long-press only expands — it must not
                    // also toggle the filter on release.
                    if (chipPressFired.current) {
                      chipPressFired.current = false;
                      return;
                    }
                    setFilterInterestProperty(active ? 'All' : p.id);
                    setPage(0);
                  }}
                  onTouchStart={() => beginChipPress(p.id)}
                  onTouchEnd={endChipPress}
                  onTouchMove={endChipPress}
                  onTouchCancel={endChipPress}
                  onContextMenu={(e) => {
                    // Long-press on Android fires contextmenu — swallow it
                    // so the expand isn't covered by the browser menu.
                    if (expanded || chipPressFired.current) e.preventDefault();
                  }}
                  title={`${p.title}\n\nHere because you starred it in Inventory — click to filter contacts who showed interest; unstar to remove.`}
                  style={{ WebkitTouchCallout: 'none' }}
                  className={cn(
                    'group flex items-center overflow-hidden rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold transition-all cursor-pointer select-none',
                    active
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500/40 hover:text-amber-300'
                  )}
                >
                  <span className="whitespace-nowrap">{label}</span>
                  <span
                    className={cn(
                      'max-w-0 overflow-hidden whitespace-nowrap font-sans font-medium text-slate-400 transition-all duration-300 ease-out group-hover:max-w-[260px] group-hover:pl-1.5',
                      expanded && 'max-w-[260px] pl-1.5'
                    )}
                  >
                    {p.title}
                  </span>
                  {active && <X className="ml-1 size-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Filters Dialog Drawer */}
        <Dialog open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
          <DialogContent className="bg-slate-950 border-slate-850 text-white max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                <SlidersHorizontal className="size-5 text-primary" />
                Filter Contacts
              </DialogTitle>
              <DialogDescription className="text-slate-450 text-xs mt-0.5">
                Narrow down your contact list by classification, tag, budget, or preferred location.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4.5 my-4">
              {/* Classification */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Classification</label>
                <Select
                  value={filterClassification}
                  onValueChange={(val) => {
                    setFilterClassification(val ?? 'All');
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
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
              </div>

              {/* Tag */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tag</label>
                <Select
                  value={filterTag}
                  onValueChange={(val) => {
                    setFilterTag(val ?? 'All');
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
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
              </div>

              {/* Budget Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Min Budget</label>
                  <Select
                    value={filterMinBudget}
                    onValueChange={(val) => {
                      setFilterMinBudget(val ?? 'All');
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
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
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Max Budget</label>
                  <Select
                    value={filterMaxBudget}
                    onValueChange={(val) => {
                      setFilterMaxBudget(val ?? 'All');
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
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
                </div>
              </div>

              {/* Area Preference */}
              {allAreas.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Area Preference</label>
                  <Select
                    value={filterArea}
                    onValueChange={(val) => {
                      setFilterArea(val ?? 'All');
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
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
                </div>
              )}

              {/* Sort By (Mobile Only inside drawer) */}
              <div className="space-y-1.5 sm:hidden">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Sort By</label>
                <Select
                  value={sortBy}
                  onValueChange={(val) => {
                    setSortBy(val ?? 'created_desc');
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white rounded-xl h-10">
                    <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="created_desc">Newest Created</SelectItem>
                    <SelectItem value="name_asc">Name (A - Z)</SelectItem>
                    <SelectItem value="name_desc">Name (Z - A)</SelectItem>
                    <SelectItem value="last_contacted_desc">Last Contacted</SelectItem>
                    <SelectItem value="max_budget_desc">Budget (Highest)</SelectItem>
                    <SelectItem value="max_budget_asc">Budget (Lowest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="flex flex-row items-center justify-between gap-4 mt-6">
              {(() => {
                const activeCount = [
                  filterClassification !== 'All',
                  filterTag !== 'All',
                  filterMinBudget !== 'All',
                  filterMaxBudget !== 'All',
                  filterArea !== 'All',
                ].filter(Boolean).length;

                return (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setFilterClassification('All');
                      setFilterTag('All');
                      setFilterMinBudget('All');
                      setFilterMaxBudget('All');
                      setFilterArea('All');
                      setSortBy('created_desc');
                      setPage(0);
                    }}
                    disabled={activeCount === 0 && sortBy === 'created_desc'}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Clear All
                  </Button>
                );
              })()}
              <Button
                type="button"
                onClick={() => setIsFiltersOpen(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 rounded-xl"
              >
                Apply Filters
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Tab Switcher */}
        <div className="flex bg-slate-900/60 p-1 border border-slate-800 rounded-lg self-start gap-1 flex-wrap">
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
          <button
            onClick={() => {
              setActiveTab('transacted');
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'transacted'
                ? 'bg-slate-800 text-emerald-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Transacted ({transactedCount})
          </button>
          <button
            onClick={() => {
              setActiveTab('market_active');
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'market_active'
                ? 'bg-slate-800 text-blue-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active Buyers ({marketActiveCount})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead 
                className="text-slate-400 text-xs font-semibold cursor-pointer hover:text-white select-none transition-colors group"
                onClick={() => {
                  setSortBy(sortBy === 'name_asc' ? 'name_desc' : 'name_asc');
                  setPage(0);
                }}
              >
                <div className="flex items-center gap-1">
                  Name
                  {sortBy === 'name_asc' ? (
                    <ArrowUp className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : sortBy === 'name_desc' ? (
                    <ArrowDown className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : (
                    <ArrowUpDown className="size-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                  )}
                </div>
              </TableHead>
              <TableHead className="text-slate-400 text-xs select-none">Classification</TableHead>
              <TableHead className="text-slate-400 text-xs select-none">Phone</TableHead>
              <TableHead className="text-slate-400 text-xs select-none">Tags</TableHead>
              <TableHead 
                className="text-slate-400 text-xs font-semibold cursor-pointer hover:text-white select-none transition-colors group"
                onClick={() => {
                  setSortBy(sortBy === 'last_contacted_desc' ? 'last_contacted_asc' : 'last_contacted_desc');
                  setPage(0);
                }}
              >
                <div className="flex items-center gap-1">
                  Last Contacted
                  {sortBy === 'last_contacted_desc' ? (
                    <ArrowDown className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : sortBy === 'last_contacted_asc' ? (
                    <ArrowUp className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : (
                    <ArrowUpDown className="size-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                  )}
                </div>
              </TableHead>
              <TableHead className="text-slate-400 text-xs select-none">Areas of Interest</TableHead>
              <TableHead className="text-slate-400 text-xs select-none">Property Category Interests</TableHead>
              <TableHead 
                className="text-slate-400 text-xs font-semibold cursor-pointer hover:text-white select-none transition-colors group"
                onClick={() => {
                  setSortBy(sortBy === 'max_budget_desc' ? 'max_budget_asc' : 'max_budget_desc');
                  setPage(0);
                }}
              >
                <div className="flex items-center gap-1">
                  Max Budget
                  {sortBy === 'max_budget_desc' ? (
                    <ArrowDown className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : sortBy === 'max_budget_asc' ? (
                    <ArrowUp className="size-3.5 text-primary shrink-0 animate-in fade-in zoom-in duration-200" />
                  ) : (
                    <ArrowUpDown className="size-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                  )}
                </div>
              </TableHead>
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
                        : activeTab === 'transacted'
                        ? 'No transacted contacts found.'
                        : activeTab === 'market_active'
                        ? 'No active buyers found.'
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{contact.name || <span className="text-slate-500 italic text-xs">Unnamed</span>}</span>
                        {contact.name_tag && (
                          <span
                            className="inline-flex items-center bg-slate-700/40 border border-slate-600/50 text-slate-300 font-medium px-1.5 py-0.5 rounded text-[10px] select-none"
                            title="Name Tag — internal label, not sent in messages"
                          >
                            {contact.name_tag}
                          </span>
                        )}
                        {contact.tags?.some((t) => t.name.toUpperCase() === 'VIP') && (
                          <span className="inline-flex items-center gap-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider select-none">
                            ⭐ VIP
                          </span>
                        )}
                      </div>
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
                      <button
                        onClick={(e) => handlePrefilledWhatsAppClick(e, contact)}
                        className="inline-flex items-center justify-center rounded-md size-6 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20 transition-all cursor-pointer"
                        title="Send pre-filled welcome message on WhatsApp"
                      >
                        <MessageSquarePlus className="size-3.5 fill-current stroke-slate-950" />
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
                        contact.areas_of_interest.slice(0, 3).map((area) => (
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
                      {contact.areas_of_interest && contact.areas_of_interest.length > 3 && (
                        <span className="text-[10px] text-slate-500">
                          +{contact.areas_of_interest.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs py-3">
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {contact.property_interests && contact.property_interests.length > 0 ? (
                        contact.property_interests.slice(0, 3).map((interest) => (
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
                      {contact.property_interests && contact.property_interests.length > 3 && (
                        <span className="text-[10px] text-slate-500">
                          +{contact.property_interests.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300 font-medium text-xs py-3">
                    {formatBudget(contact)}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(contact.id);
                        }}
                        className="text-slate-400 hover:text-primary"
                        title="View Details"
                      >
                        <Eye className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditForm(contact);
                        }}
                        className="text-slate-400 hover:text-blue-400"
                        title="Edit Contact"
                      >
                        <Pencil className="size-4" />
                      </Button>
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
                    </div>
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
          fetchContactsWithInvalidate();
          fetchTags();
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
        contactId={detailContactId}
        onUpdated={fetchContactsWithInvalidate}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContactsWithInvalidate}
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
