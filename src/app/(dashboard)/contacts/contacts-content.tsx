'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { pushUrl, replaceUrl } from '@/lib/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveConversation } from '@/lib/conversations/resolve';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Contact, Tag, ContactTag, Property } from '@/types';
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
import { ContactsTableSkeleton } from '@/components/contacts/contacts-table-skeleton';
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
  Archive,
  MoreHorizontal,
  ClipboardList,
  Pencil,
  Trash2,
  Loader2,
  Users,
  Building2,
  Star,
  StarOff,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  Sparkles,
  WifiOff,
  Smartphone,
  X,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  SlidersHorizontal,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactCleanupDialog } from '@/components/contacts/cleanup-dialog';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { UnmappedPortalAds } from '@/components/contacts/unmapped-portal-ads';
import { ReengageWizard } from '@/components/contacts/reengage-wizard';
import { useCan } from '@/hooks/useCan';
import { GatedButton } from '@/components/ui/gated-button';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { splitImportedName } from '@/lib/contacts/name-tag-split';
import { contactFullName } from '@/lib/contacts/full-name';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import {
  BulkImportModal,
  type BulkImportContact,
} from '@/components/contacts/bulk-import-modal';
import {
  LogCallPrompt,
  type PendingDial,
} from '@/components/contacts/log-call-prompt';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import { OwnerDetailsRequestDialog } from '@/components/contacts/owner-details-request-dialog';
import { ContactRequirementsDialog } from '@/components/contacts/contact-requirements-dialog';
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
import { BUDGET_OPTIONS } from '@/lib/contacts/budget-options';
import {
  activeContactFilterCount,
  contactSortItems,
} from '@/lib/contacts/contact-sorts';
import {
  effectiveAreas,
  effectiveCategories,
  effectiveMaxBudget,
} from '@/lib/contact-preferences';
import {
  areaFilterVariants,
  areaOptionLabel,
  MAX_SELECTED_AREAS,
} from '@/lib/contacts/area-variants';
import { useT } from '@/hooks/useLocale';
import {
  CONTACTS_PAGE_SIZE,
  loadAreaOptions,
  loadContactsPage,
  loadContactsShowcaseSettings,
  loadProjectChoices,
  loadStarredProperties,
  loadTagsMap,
  type ContactListPage,
  type ContactListParams,
  type ContactListTab,
  type StarredProperty,
} from '@/lib/contacts/list-queries';
import { formatAuditDateTime } from '@/lib/audit-timestamps';
import { splitChips, splitTagChips } from '@/lib/contacts/chip-overflow';
import { formatInrCompact } from '@/lib/format/currency';

const INTEREST_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const t = useT();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user, profile, accountId, profileLoading, profileError } = useAuth();

  // Watchdog for the loading state. Two silent failure shapes used to
  // leave the spinner up forever with zero diagnostics: (a) auth's
  // legacy profile fallback loads a profile WITHOUT account_id, so the
  // `enabled` guard on the contacts query never lets it run; (b) a
  // Supabase request that never settles (no client-side timeout).
  // Surface both instead of spinning.
  const [slowLoad, setSlowLoad] = useState(false);
  const accountMissing = !profileLoading && !accountId;
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
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles}`}
      >
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
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles}`}
      >
        {leadTemp === 'HOT' && '🔥 '}
        {leadTemp === 'COLD' && '❄️ '}
        {leadTemp === 'Not Responding' && '⏳ '}
        {leadTemp === 'Dead' && '💀 '}
        {leadTemp}
      </span>
    );
  };

  // Chip list for the Areas / Property-interest columns. AI-derived
  // values (from the requirements text, not the contact form) render
  // in the primary tint with a ✨ so provenance stays visible.
  const renderPreferenceChips = (
    effective: { value: string[]; source: 'explicit' | 'ai' } | null
  ) => {
    if (!effective) return <span className="text-xs text-slate-600">-</span>;
    const ai = effective.source === 'ai';
    const chips = splitChips(effective.value);
    return (
      <div className="flex items-center gap-1 whitespace-nowrap">
        {chips.visible.map((label) => (
          <span
            key={label}
            title={
              ai ? `${label} — extracted by AI from requirements text` : label
            }
            className={`inline-flex max-w-[120px] items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-medium ${
              ai
                ? 'border-primary/25 bg-primary/5 text-primary/90'
                : 'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            {ai && <Sparkles className="size-2.5 shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
        ))}
        {chips.hidden.length > 0 && (
          <span
            className="text-[11px] text-slate-500"
            title={chips.hiddenTitle}
          >
            +{chips.hidden.length}
          </span>
        )}
      </div>
    );
  };

  // Explicit field first, AI-extracted fallback (marked ✨) — same
  // merge the matching engine and the Requirements tab use, so a
  // budget typed only into the demands statement still shows here.
  const formatBudget = (contact: Contact) => {
    if (resolveRequirementSource(contact).no_budget) return 'No Limit';
    const budget = effectiveMaxBudget(contact);
    if (!budget) return '-';
    return (
      <span className="inline-flex items-center gap-1">
        {formatInrCompact(budget.value)}
        {budget.source === 'ai' && (
          <span title="Extracted by AI from requirements text">
            <Sparkles className="text-primary size-3" />
          </span>
        )}
      </span>
    );
  };

  const handleWhatsAppClick = async (e: React.MouseEvent, contact: Contact) => {
    e.stopPropagation();
    if (!accountId) {
      toast.error('Account not loaded');
      return;
    }

    const cleanPhone = contact.phone?.replace(/\D/g, '') ?? '';
    if (!cleanPhone) {
      toast.error('This contact has no phone number');
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
          const { conversation, error } = await resolveConversation<{
            id: string;
          }>(supabase, {
            accountId,
            contactId: contact.id,
            userId: user?.id ?? null,
            columns: 'id',
          });

          if (!conversation) {
            toast.error('Failed to start chat thread');
            console.error('Create conversation error:', error);
            return;
          }

          router.push(`/inbox?c=${conversation.id}`);
        } catch (err) {
          console.error('WhatsApp redirect error:', err);
          toast.error('Something went wrong');
        }
      }
    }, 1500);
  };

  const showcaseQuery = useQuery({
    queryKey: ['contacts', 'showcase-settings', accountId],
    queryFn: () => loadContactsShowcaseSettings(supabase, accountId!),
    enabled: Boolean(accountId),
  });
  const showcaseSettings = showcaseQuery.data ?? null;

  const getPrefilledWhatsAppLink = (
    contact: Contact,
    propDetails?: Property | null
  ) => {
    const cleanPhone = contact.phone?.replace(/\D/g, '') ?? '';
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
      if (
        parts.length > 2 &&
        !baseDomain.includes('localhost') &&
        !/^\d+\.\d+\.\d+\.\d+$/.test(baseDomain)
      ) {
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
        singlePropUrl.searchParams.set(
          'property_id',
          propDetails.property_code || propDetails.id
        );

        const matchingUrl = new URL(showcaseUrlObj.toString());
        if (propDetails.listing_type) {
          matchingUrl.searchParams.set(
            'listing_type',
            propDetails.listing_type
          );
        }
        if (propDetails.type) {
          matchingUrl.searchParams.set('category', propDetails.type);
        }
        const searchLocation =
          propDetails.sublocality || propDetails.city || '';
        if (searchLocation) {
          matchingUrl.searchParams.set('search', searchLocation);
        }

        linkSection = `Meanwhile, you can view details for the property you enquired about here:
${singlePropUrl.toString()}

Or browse other matching verified properties here:
${matchingUrl.toString()}`;
      } else {
        const source = resolveRequirementSource(contact);
        const areaHints = [
          ...(source.areas_of_interest || []),
          ...(source.pref_areas || []),
        ];
        const preferenceHints = [
          ...(source.property_interests || []),
          ...(source.pref_property_types || []),
          ...(source.pref_property_categories || []).map(
            (category) =>
              `${category[0]?.toUpperCase()}${category.slice(1).toLowerCase()}`
          ),
        ].filter(Boolean);
        const hasInterestFilters =
          areaHints.length > 0 || preferenceHints.length > 0;

        if (hasInterestFilters) {
          const matchingUrl = new URL(showcaseUrlObj.toString());
          if (areaHints.length > 0) {
            matchingUrl.searchParams.set('search', areaHints[0]);
          }
          if (preferenceHints.length > 0) {
            matchingUrl.searchParams.set('category', preferenceHints[0]);
          }

          const filterDesc = [
            preferenceHints[0],
            areaHints[0] ? `in ${areaHints[0]}` : '',
          ]
            .filter(Boolean)
            .join(' ');

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

  const handlePrefilledWhatsAppClick = async (
    e: React.MouseEvent,
    contact: Contact
  ) => {
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

  const [pendingDial, setPendingDial] = useState<PendingDial | null>(null);
  const [search, setSearch] = useState(initialSearch);
  // `search` drives the controlled input for instant typing feedback;
  // `debouncedSearch` is what actually keys the contacts query (via its
  // query key below). Without this split, every keystroke fired a
  // full network round-trip (plus, for NLP-style queries, several extra
  // parallel note/tag lookups) — see the debounce effect further down.
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<ContactListTab>('active');

  /** Keeps the quick-filter tab (All/Needs Review/Favourites/Transacted/Active Buyers)
   *  in the URL — so it survives a refresh, can be shared, and so the
   *  page-level Favorite button (contacts/page.tsx) can capture exactly
   *  this view instead of always favoriting the default "All Contacts". */
  const setActiveTabAndSync = (tab: ContactListTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setPage(0);
    const params = new URLSearchParams(searchParams?.toString());
    if (tab === 'active') {
      params.delete('filter');
    } else {
      params.set('filter', tab);
    }
    const qs = params.toString();
    replaceUrl(router, qs ? `/contacts?${qs}` : '/contacts');
  };

  const [cleanupOpen, setCleanupOpen] = useState(false);

  /** " (42)" once known, "" while loading. */
  const countSuffix = (n: number | null) => (n === null ? '' : ` (${n})`);

  const [filterClassification, setFilterClassification] =
    useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');
  const [filterMinBudget, setFilterMinBudget] = useState<string>('All');
  const [filterMaxBudget, setFilterMaxBudget] = useState<string>('All');
  const [filterAreas, setFilterAreas] = useState<string[]>([]);
  // Starred-property interest chips (fed from Inventory stars): the
  // selected chip narrows the list to contacts who showed interest in
  // that property (last_inquired_property_id ∪ contact_property_inquiries).
  const starredKey = ['contacts', 'starred', accountId];
  const starredQuery = useQuery({
    queryKey: starredKey,
    queryFn: () => loadStarredProperties(supabase, accountId!),
    enabled: Boolean(accountId),
  });
  const starredProps = useMemo(
    () => starredQuery.data ?? [],
    [starredQuery.data]
  );
  // Seeded from ?interest= so a refresh (or shared link) keeps the chip.
  // The value reaches uuid columns (property_id, last_inquired_property_id)
  // before the unstar-guard below can clear it, so anything that is not a
  // property id is dropped at the door rather than sent to Postgres.
  const [filterInterestProperty, setFilterInterestProperty] = useState<string>(
    () => {
      const seed = searchParams?.get('interest');
      return seed && INTEREST_UUID_RE.test(seed) ? seed : 'All';
    }
  );
  // Project axis of the interest filter — a project NAME, matching
  // properties.project (TEXT), which stays authoritative even for units
  // never linked to a project row (migration 227). Only ever used as a
  // bound query parameter, so any string is safe to carry.
  const [filterInterestProject, setFilterInterestProject] = useState<string>(
    () => searchParams?.get('interest_project')?.trim().slice(0, 120) || 'All'
  );
  const projectsQuery = useQuery({
    queryKey: ['contacts', 'projects', accountId],
    queryFn: () => loadProjectChoices(supabase, accountId!),
    enabled: Boolean(accountId),
  });
  const projectChoices = projectsQuery.data ?? [];

  // Single entry point for changing the interest chip: updates state and
  // mirrors it into the ?interest= URL param (history.replaceState, like
  // the inbox, to avoid a router round-trip on every chip tap).
  const applyInterestFilter = useCallback((id: string) => {
    setFilterInterestProperty(id);
    if (id !== 'All') setFilterInterestProject('All');
    setPage(0);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (id === 'All') params.delete('interest');
    else {
      params.set('interest', id);
      params.delete('interest_project');
    }
    const qs = params.toString();
    window.history.replaceState(null, '', `/contacts${qs ? `?${qs}` : ''}`);
  }, []);

  // The project axis of the same filter: a tower's buyers are spread
  // across its units, so a per-unit chip finds a fraction of them.
  // Mutually exclusive with the property chip; mirrored to
  // ?interest_project= the same way.
  const applyProjectFilter = useCallback((name: string) => {
    setFilterInterestProject(name);
    if (name !== 'All') setFilterInterestProperty('All');
    setPage(0);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (name === 'All') params.delete('interest_project');
    else {
      params.set('interest_project', name);
      params.delete('interest');
    }
    const qs = params.toString();
    window.history.replaceState(null, '', `/contacts${qs ? `?${qs}` : ''}`);
  }, []);
  // Unstar straight from the chip, so removing a quick filter no longer
  // means a round trip to Inventory. Optimistic: the chip goes first and
  // comes back if the write fails. Dropping the active filter is left to
  // the unstar-guard effect below, which already handles the property
  // being unstarred elsewhere.
  const [unstarringId, setUnstarringId] = useState<string | null>(null);

  const handleUnstarProperty = async (property: {
    id: string;
    property_code: string | null;
    title: string;
  }) => {
    const previous = starredProps;
    setUnstarringId(property.id);
    queryClient.setQueryData<StarredProperty[]>(starredKey, (prev) =>
      (prev ?? []).filter((p) => p.id !== property.id)
    );
    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_starred: false }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to remove quick filter');
      }
      toast.success(
        `Removed ${property.property_code || property.title} from quick filters`
      );
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'starred'] });
    } catch (err: unknown) {
      queryClient.setQueryData(starredKey, previous);
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove quick filter'
      );
    } finally {
      setUnstarringId(null);
    }
  };

  // Favourites star on a contact row. Optimistic, and on the Favourites
  // tab the row leaves the list immediately — a row showing an empty
  // star inside the Favourites tab reads as a failed write.
  const [favoritingId, setFavoritingId] = useState<string | null>(null);

  const handleToggleFavorite = async (contact: ContactWithTags) => {
    const next = !contact.is_favorite;
    const previousPage = queryClient.getQueryData<ContactListPage>(listKey);

    setFavoritingId(contact.id);
    queryClient.setQueryData<ContactListPage>(listKey, (prev) =>
      prev
        ? {
            ...prev,
            contacts:
              activeTab === 'favorites' && !next
                ? prev.contacts.filter((c) => c.id !== contact.id)
                : prev.contacts.map((c) =>
                    c.id === contact.id ? { ...c, is_favorite: next } : c
                  ),
            counts: {
              ...prev.counts,
              favoritesCount: Math.max(
                0,
                prev.counts.favoritesCount + (next ? 1 : -1)
              ),
            },
          }
        : prev
    );

    try {
      const response = await fetch(`/api/contacts/${contact.id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: next }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update favourite');
      }
      void invalidateList();
      toast.success(
        next
          ? `Added ${contact.name || contact.phone} to Favourites`
          : `Removed ${contact.name || contact.phone} from Favourites`
      );
    } catch (err: unknown) {
      queryClient.setQueryData(listKey, previousPage);
      toast.error(
        err instanceof Error ? err.message : 'Failed to update favourite'
      );
    } finally {
      setFavoritingId(null);
    }
  };

  // Touch equivalent of the chip's hover-expand: long-press (~450ms)
  // reveals the full property title for 3s. A completed long-press
  // must NOT also toggle the filter, so the click that follows it is
  // swallowed via chipPressFired.
  const [expandedInterestChip, setExpandedInterestChip] = useState<
    string | null
  >(null);
  const chipPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipPressFired = useRef(false);

  const beginChipPress = (id: string) => {
    chipPressFired.current = false;
    chipPressTimer.current = setTimeout(() => {
      chipPressFired.current = true;
      setExpandedInterestChip(id);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator)
        navigator.vibrate(10);
      if (chipCollapseTimer.current) clearTimeout(chipCollapseTimer.current);
      chipCollapseTimer.current = setTimeout(
        () => setExpandedInterestChip(null),
        3000
      );
    }, 450);
  };

  const endChipPress = () => {
    if (chipPressTimer.current) {
      clearTimeout(chipPressTimer.current);
      chipPressTimer.current = null;
    }
  };
  // The "Area" filter chips and the search box's locality expansion:
  // every stored locality, distinct-counted in SQL and grouped by
  // spelling by /api/contacts/area-options. Cached for 5 minutes and —
  // unlike the tags and contacts queries — only loaded when the Filters
  // panel opens or a search runs, not on every Contacts page mount.
  const areaOptionsQuery = queryOptions({
    queryKey: ['contacts', 'area-options', accountId],
    queryFn: loadAreaOptions,
    staleTime: 5 * 60_000,
  });
  const areaOptionsResult = useQuery({
    ...areaOptionsQuery,
    enabled:
      Boolean(accountId) &&
      (isFiltersOpen || debouncedSearch.trim().length > 0),
  });
  const areaOptions = useMemo(
    () => areaOptionsResult.data ?? [],
    [areaOptionsResult.data]
  );
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
    const filterParam = searchParams?.get('filter');
    if (
      filterParam === 'active' ||
      filterParam === 'pending_review' ||
      filterParam === 'favorites' ||
      filterParam === 'transacted' ||
      filterParam === 'market_active' ||
      filterParam === 'archived'
    ) {
      setActiveTab(filterParam);
    }
  }, [searchParams]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const [reengageOpen, setReengageOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleContactId, setScheduleContactId] = useState<string | null>(
    null
  );
  const [detailsRequestContact, setDetailsRequestContact] =
    useState<Contact | null>(null);
  const [requirementsContact, setRequirementsContact] =
    useState<Contact | null>(null);

  // Bulk Device Import state
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportContacts, setBulkImportContacts] = useState<
    BulkImportContact[]
  >([]);

  // Deep link from onboarding: /contacts?import=1 lands with the CSV
  // import dialog already open.
  const importParam = searchParams?.get('import') === '1';
  useEffect(() => {
    if (importParam) setReengageOpen(true);
  }, [importParam]);

  // All tags for display
  const tagsQuery = useQuery({
    queryKey: ['contacts', 'tags'],
    queryFn: () => loadTagsMap(supabase),
  });
  const tagsMap = useMemo(() => tagsQuery.data ?? {}, [tagsQuery.data]);

  // The stored spellings behind the selected area groups — part of the
  // list query key, so the list only refetches when the selection itself
  // changes, not when the options load or refresh.
  const selectedAreaVariants = useMemo(
    () => areaFilterVariants(filterAreas, areaOptions),
    [filterAreas, areaOptions]
  );

  // If the active chip's property was unstarred elsewhere, drop the filter.
  // Waits for the first starred-props fetch so a URL-restored filter isn't
  // cleared against the initial empty array.
  useEffect(() => {
    if (!starredQuery.isSuccess) return;
    if (
      filterInterestProperty !== 'All' &&
      !starredProps.some((p) => p.id === filterInterestProperty)
    ) {
      applyInterestFilter('All');
    }
  }, [
    starredQuery.isSuccess,
    starredProps,
    filterInterestProperty,
    applyInterestFilter,
  ]);

  const listParams: ContactListParams | null = accountId
    ? {
        accountId,
        page,
        tab: activeTab,
        sort: sortBy,
        search: debouncedSearch,
        classification: filterClassification,
        tag: filterTag,
        minBudget: filterMinBudget,
        maxBudget: filterMaxBudget,
        areas: filterAreas,
        areaVariants: selectedAreaVariants,
        interestProperty: filterInterestProperty,
        interestProject: filterInterestProject,
      }
    : null;
  const listKey = ['contacts', 'list', listParams];
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () =>
      loadContactsPage(supabase, listParams!, () =>
        queryClient.fetchQuery(areaOptionsQuery)
      ),
    enabled: listParams !== null,
    placeholderData: keepPreviousData,
  });
  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: ['contacts', 'list'] });

  const contacts = useMemo<ContactWithTags[]>(() => {
    const loaded = listQuery.data;
    if (!loaded) return [];
    return loaded.contacts.map((c) => ({
      ...c,
      tags: (loaded.contactTagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));
  }, [listQuery.data, tagsMap]);
  const totalCount = listQuery.data?.totalCount ?? 0;
  // null = not fetched yet. The tab labels render plain ("All
  // Contacts") until real numbers exist — a "(0)"/"(...)" placeholder
  // while counts load reads as broken data.
  const counts = listQuery.data?.counts ?? null;
  const activeCount = counts?.activeCount ?? null;
  const reviewCount = counts?.reviewCount ?? null;
  const favoritesCount = counts?.favoritesCount ?? null;
  const transactedCount = counts?.transactedCount ?? null;
  const marketActiveCount = counts?.marketActiveCount ?? null;
  const archivedCount = counts?.archivedCount ?? null;
  const loading =
    listQuery.isPending || (listQuery.isError && listQuery.isFetching);
  // True when the last contacts load errored — renders an inline retry
  // card instead of an eternal spinner / empty state.
  const fetchFailed = listQuery.isError && !listQuery.isFetching;

  useEffect(() => {
    if (!listQuery.isError) return;
    console.error('Error fetching contacts:', listQuery.error);
    toast.error('An unexpected error occurred while loading contacts');
  }, [listQuery.isError, listQuery.error]);

  // Arm the slow-load notice while a load is in flight; disarm on settle.
  useEffect(() => {
    if (!listQuery.isFetching) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 12_000);
    return () => clearTimeout(t);
  }, [listQuery.isFetching]);

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
    ): Promise<
      Array<{
        name?: string[];
        tel?: string[];
        email?: string[];
      }>
    >;
  }

  const handleDeviceImport = async () => {
    if (typeof navigator === 'undefined' || !('contacts' in navigator)) {
      toast.error(
        'Device contacts picker is not supported on this browser/device.'
      );
      return;
    }

    try {
      const manager = (navigator as unknown as { contacts: ContactsManager })
        .contacts;
      const supportedProps = await manager.getProperties();
      const fields = ['name', 'tel', 'email'].filter((f) =>
        supportedProps.includes(f)
      );

      const picked = await manager.select(fields, { multiple: true });
      if (!picked || picked.length === 0) return;

      if (picked.length === 1) {
        const c = picked[0];
        const split = splitImportedName(c.name?.[0] || '');
        const phone = c.tel?.[0] || '';
        const email = c.email?.[0] || '';

        setEditContact({
          id: '',
          user_id: user?.id || '',
          phone: normalizePhoneWithCountryCode(phone) || phone,
          name: split.name,
          second_name: split.secondName,
          name_tag: split.nameTag,
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
            const split = splitImportedName(c.name?.[0] || '');
            return {
              name: split.name,
              second_name: split.secondName ?? '',
              name_tag: split.nameTag ?? '',
              phone: c.tel?.[0]
                ? normalizePhoneWithCountryCode(c.tel[0]) || c.tel[0]
                : '',
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
        second_name: c.second_name.trim() || null,
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
      void invalidateList();
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
      // Read from window.location, not useSearchParams — the interest-chip
      // filter updates the URL via history.replaceState, which the hook
      // doesn't see, and a stale snapshot here would wipe ?interest=.
      const params = new URLSearchParams(window.location.search);
      params.delete('contactId');
      const queryString = params.toString();
      pushUrl(router, `/contacts${queryString ? `?${queryString}` : ''}`);
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

    // Routed through the API rather than deleting straight from the
    // browser: a delete the RLS policy refuses removes zero rows and
    // reports no error, so the client cannot tell success from refusal
    // and used to claim the contact was deleted either way. The route
    // resolves ownership first and answers 403/404.
    try {
      const response = await fetch(`/api/contacts/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete contact');
      }
      toast.success('Contact deleted');
      void invalidateList();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete contact'
      );
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / CONTACTS_PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  const slowLoadNotice = slowLoad ? (
    <div className="flex flex-col items-center gap-2 py-6">
      <p className="text-xs text-slate-500">
        This is taking longer than usual — the connection may have stalled.
      </p>
      <Button
        onClick={() => listQuery.refetch()}
        variant="outline"
        className="h-8 cursor-pointer border-slate-700 px-4 text-xs text-slate-300 hover:bg-slate-800"
      >
        Retry
      </Button>
    </div>
  ) : null;

  const activeFilterCount = activeContactFilterCount({
    classification: filterClassification,
    tag: filterTag,
    minBudget: filterMinBudget,
    maxBudget: filterMaxBudget,
    areas: filterAreas,
    interestProperty: filterInterestProperty,
    interestProject: filterInterestProject,
  });
  const scoped = activeFilterCount > 0 || debouncedSearch.trim().length > 0;
  const sortItems = contactSortItems(sortBy);
  const classificationItems = [
    { value: 'All', label: 'All Classifications' },
    ...['Owner', 'Seller', 'Buyer', 'Agent', 'Developer', 'Others'].map(
      (value) => ({ value, label: value })
    ),
  ];
  const tagItems = [
    { value: 'All', label: 'All Tags' },
    ...Object.values(tagsMap).map((tag) => ({
      value: tag.id,
      label: tag.name,
    })),
  ];
  const minBudgetItems = [
    { value: 'All', label: 'Min Budget: All' },
    ...BUDGET_OPTIONS.map((opt) => ({
      value: opt.value,
      label: `≥ ${opt.label}`,
    })),
  ];
  const maxBudgetItems = [
    { value: 'All', label: 'Max Budget: All' },
    ...BUDGET_OPTIONS.map((opt) => ({
      value: opt.value,
      label: `≤ ${opt.label}`,
    })),
  ];
  const toggleArea = (key: string) => {
    if (
      !filterAreas.includes(key) &&
      filterAreas.length >= MAX_SELECTED_AREAS
    ) {
      toast.info(`Up to ${MAX_SELECTED_AREAS} areas at a time`);
      return;
    }
    setFilterAreas((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    setPage(0);
  };
  const projectItems = [
    { value: 'All', label: t('contacts.allProjects') },
    ...projectChoices.map((project) => ({
      value: project.name,
      label: `${project.name} (${project.count} ${project.count === 1 ? 'unit' : 'units'})`,
    })),
  ];
  const clearAllFilters = () => {
    setFilterClassification('All');
    setFilterTag('All');
    setFilterMinBudget('All');
    setFilterMaxBudget('All');
    setFilterAreas([]);
    applyInterestFilter('All');
    applyProjectFilter('All');
    setSearch('');
    setDebouncedSearch('');
    setPage(0);
  };

  return (
    <div className="space-y-6">
      {/* Duplicate detection panel — only visible to agents+ when dupes exist */}
      <DuplicatesPanel
        onMergeComplete={invalidateList}
        onOpenContact={openDetail}
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1">
            <button
              onClick={() => setActiveTabAndSync('active')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'active'
                  ? 'text-primary bg-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active{countSuffix(activeCount)}
            </button>
            <button
              onClick={() => setActiveTabAndSync('pending_review')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'pending_review'
                  ? 'bg-slate-800 text-amber-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Needs Review{countSuffix(reviewCount)}
              {(reviewCount ?? 0) > 0 && (
                <span className="inline-flex h-4 min-w-[16px] animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] leading-none font-bold text-slate-950">
                  {reviewCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTabAndSync('favorites')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'favorites'
                  ? 'bg-slate-800 text-amber-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star
                className={`size-3 ${activeTab === 'favorites' ? 'fill-amber-400' : ''}`}
              />
              Favourites{countSuffix(favoritesCount)}
            </button>
            <button
              onClick={() => setActiveTabAndSync('transacted')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'transacted'
                  ? 'bg-slate-800 text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Transacted{countSuffix(transactedCount)}
            </button>
            <button
              onClick={() => setActiveTabAndSync('market_active')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'market_active'
                  ? 'bg-slate-800 text-blue-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active Buyers{countSuffix(marketActiveCount)}
            </button>
            <button
              onClick={() => setActiveTabAndSync('archived')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === 'archived'
                  ? 'bg-slate-800 text-slate-200 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Archive className="size-3" />
              Archived{countSuffix(archivedCount)}
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
            {/* One door for both jobs — the wizard asks whether to just
                  import or to import and message, so neither is reachable by
                  accident. */}
            <GatedButton
              variant="outline"
              canAct={canEdit}
              gateReason="add or import contacts"
              onClick={() => setReengageOpen(true)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Upload className="size-4" />
              Import
            </GatedButton>
            <GatedButton
              variant="outline"
              canAct={canEdit}
              gateReason="archive or delete contacts"
              onClick={() => setCleanupOpen(true)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Archive className="size-4" />
              Clean up
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
        <div className="flex w-full items-center gap-3">
          {/* Search bar */}
          <div className="relative max-w-sm flex-1 sm:max-w-xs md:max-w-sm">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email..."
              className="h-9.5 rounded-xl border-slate-700 bg-slate-900 pr-10 pl-8.5 text-white placeholder:text-slate-500 focus-visible:ring-1"
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
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
                title="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filters Toggle Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFiltersOpen(true)}
            aria-label={
              activeFilterCount > 0
                ? `Filters, ${activeFilterCount} active`
                : 'Filters'
            }
            className={cn(
              'text-slate-350 relative flex h-9.5 shrink-0 items-center gap-2 rounded-xl border-slate-700 bg-slate-900 px-3.5 font-bold transition-all hover:bg-slate-800 hover:text-white',
              activeFilterCount > 0 &&
                'border-primary/40 bg-primary/5 hover:bg-primary/10 text-white'
            )}
          >
            <SlidersHorizontal className="size-4 text-slate-400 group-hover:text-white" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground flex size-4.5 items-center justify-center rounded-full text-[11px] font-black shadow-[0_0_8px_hsl(var(--primary)/0.6)]">
                {activeFilterCount}
              </span>
            )}
          </Button>

          {/* Quick Sort Selector (Desktop Only) */}
          <div className="hidden shrink-0 sm:block">
            <Select
              value={sortBy}
              items={sortItems}
              onValueChange={(val) => {
                setSortBy(String(val ?? 'created_desc'));
                setPage(0);
              }}
            >
              <SelectTrigger
                aria-label="Sort contacts"
                className="h-9.5 w-[180px] rounded-xl border-slate-700 bg-slate-900 text-xs font-bold text-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                {sortItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Starred-property interest chips — starred in Inventory, each
            chip filters to contacts who showed interest in that listing.
            The label is the property code; hovering (or long-pressing on
            touch devices) expands the full title. */}
        {(starredProps.length > 0 || projectChoices.length > 0) && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5">
            <span className="flex shrink-0 items-center text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              <Star className="mr-1 size-3 fill-amber-400 text-amber-400" />
              Interested in:
              <InfoHint text="Quick filters by first-choice interest — linked as interested on the property form, top match of a portal/email inquiry, or manually logged on the contact. The chips are the properties you starred on the Inventory page (star icon on a listing's photo, up to 6); hover a chip (or long-press on touch) and tap the star-off icon to unstar it. The Project picker filters across EVERY unit of a project, plus contacts who named the project in their preferences — a tower's buyers are spread across its units, so a single listing's chip only finds a fraction of them. The active filter survives a page refresh." />
            </span>
            {starredProps.map((p) => {
              const active = filterInterestProperty === p.id;
              const expanded = expandedInterestChip === p.id;
              const label =
                p.property_code || p.title.split(/\s+/).slice(0, 2).join(' ');
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
                    applyInterestFilter(active ? 'All' : p.id);
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
                  title={`${p.title}\n\nHere because you starred it in Inventory — click to filter contacts whose first-choice interest is this property.${canEdit ? ' Use the star-off icon to remove it from the quick filters.' : ''}`}
                  style={{ WebkitTouchCallout: 'none' }}
                  className={cn(
                    'group flex cursor-pointer items-center overflow-hidden rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold transition-all select-none',
                    active
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500/40 hover:text-amber-300'
                  )}
                >
                  <span className="whitespace-nowrap">{label}</span>
                  <span
                    className={cn(
                      'max-w-0 overflow-hidden font-sans font-medium whitespace-nowrap text-slate-400 transition-all duration-300 ease-out group-hover:max-w-[260px] group-hover:pl-1.5',
                      expanded && 'max-w-[260px] pl-1.5'
                    )}
                  >
                    {p.title}
                  </span>
                  {active && <X className="ml-1 size-3 shrink-0" />}
                  {canEdit && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${label} from quick filters`}
                      title={`Remove ${p.property_code || p.title} from the quick filters (unstars it in Inventory)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (unstarringId) return;
                        handleUnstarProperty(p);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          if (unstarringId) return;
                          handleUnstarProperty(p);
                        }
                      }}
                      className={cn(
                        'max-w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-4 group-hover:opacity-100 hover:text-rose-300 focus:ml-1.5 focus:max-w-4 focus:opacity-100 focus:outline-none',
                        expanded && 'ml-1.5 max-w-4 opacity-100'
                      )}
                    >
                      <StarOff className="size-3 shrink-0" />
                    </span>
                  )}
                </button>
              );
            })}
            {projectChoices.length > 0 && (
              <Select
                value={filterInterestProject}
                items={projectItems}
                onValueChange={(value) =>
                  applyProjectFilter(String(value ?? 'All'))
                }
              >
                <SelectTrigger
                  aria-label={t('contacts.projectFilter')}
                  className={cn(
                    'h-7 w-auto gap-1 rounded-full border px-2.5 text-[11px] font-bold',
                    filterInterestProject !== 'All'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500/40 hover:text-amber-300'
                  )}
                >
                  <Building2 className="size-3 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                  <SelectItem value="All">
                    {t('contacts.allProjects')}
                  </SelectItem>
                  {projectChoices.map((project) => (
                    <SelectItem key={project.name} value={project.name}>
                      {project.name} ({project.count}{' '}
                      {project.count === 1 ? 'unit' : 'units'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* Filters Dialog Drawer */}
        <Dialog open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
          <DialogContent className="border-slate-850 max-w-md rounded-2xl bg-slate-950 p-6 text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-white">
                <SlidersHorizontal className="text-primary size-5" />
                Filter Contacts
              </DialogTitle>
              <DialogDescription className="text-slate-450 mt-0.5 text-xs">
                Narrow down your contact list by classification, tag, budget, or
                preferred location.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-4.5">
              {/* Classification */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Classification
                </label>
                <Select
                  value={filterClassification}
                  items={classificationItems}
                  onValueChange={(val) => {
                    setFilterClassification(String(val ?? 'All'));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-slate-700 bg-slate-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
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
                <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Tag
                </label>
                <Select
                  value={filterTag}
                  items={tagItems}
                  onValueChange={(val) => {
                    setFilterTag(String(val ?? 'All'));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-slate-700 bg-slate-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                    <SelectItem value="All">All Tags</SelectItem>
                    {Object.values(tagsMap).map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
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
                  <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    Min Budget
                  </label>
                  <Select
                    value={filterMinBudget}
                    items={minBudgetItems}
                    onValueChange={(val) => {
                      setFilterMinBudget(String(val ?? 'All'));
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="h-10 w-full rounded-xl border-slate-700 bg-slate-900 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
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
                  <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    Max Budget
                  </label>
                  <Select
                    value={filterMaxBudget}
                    items={maxBudgetItems}
                    onValueChange={(val) => {
                      setFilterMaxBudget(String(val ?? 'All'));
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="h-10 w-full rounded-xl border-slate-700 bg-slate-900 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
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
              {areaOptions.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                      Area Preference
                    </label>
                    {filterAreas.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterAreas([]);
                          setPage(0);
                        }}
                        className="cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-slate-200"
                      >
                        Clear {filterAreas.length}
                      </button>
                    )}
                  </div>
                  <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-2">
                    {areaOptions.map((option) => {
                      const active = filterAreas.includes(option.key);
                      return (
                        <button
                          type="button"
                          key={option.key}
                          aria-pressed={active}
                          onClick={() => toggleArea(option.key)}
                          title={
                            option.variants.length > 1
                              ? `Also matches: ${option.variants.slice(1).join(', ')}`
                              : undefined
                          }
                          className={cn(
                            'cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                            active
                              ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                              : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:text-white'
                          )}
                        >
                          {areaOptionLabel(option)}
                          <span className="ml-1 text-slate-500">
                            {option.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sort By (Mobile Only inside drawer) */}
              <div className="space-y-1.5 sm:hidden">
                <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Sort By
                </label>
                <Select
                  value={sortBy}
                  items={sortItems}
                  onValueChange={(val) => {
                    setSortBy(String(val ?? 'created_desc'));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-slate-700 bg-slate-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                    {sortItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="mt-6 flex flex-row items-center justify-between gap-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFilterClassification('All');
                  setFilterTag('All');
                  setFilterMinBudget('All');
                  setFilterMaxBudget('All');
                  setFilterAreas([]);
                  applyInterestFilter('All');
                  applyProjectFilter('All');
                  setPage(0);
                }}
                disabled={activeFilterCount === 0}
                className="text-xs text-slate-400 hover:text-white"
              >
                Clear All
              </Button>
              <Button
                type="button"
                onClick={() => setIsFiltersOpen(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-6 font-bold"
              >
                Apply Filters
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Portal ads still waiting on their first assertion. Renders
          nothing when there are none, so it costs a clean account no
          space — and it sits above the queue it explains. */}
      <UnmappedPortalAds onMapped={invalidateList} />

      {!accountMissing && !loading && !fetchFailed && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {totalCount} {totalCount === 1 ? 'contact' : 'contacts'}
            {scoped ? ' match the current search and filters' : ''}
          </span>
          {scoped && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="font-semibold text-slate-400 hover:text-white"
            >
              Clear search and filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-800">
        {/* Loading / empty states live OUTSIDE the Table — the ui/table
            wrapper scrolls horizontally, so anything centered inside a
            colSpan cell centers against the full multi-viewport-wide
            table and lands off-screen on mobile. Same pattern as the
            Broadcasts and Ads pages. */}
        {accountMissing ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Users className="size-8 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">
              Your account context didn&apos;t load
            </p>
            <p className="max-w-sm text-xs text-slate-500">
              {profileError
                ? 'The profile lookup failed — usually a temporary network or database blip.'
                : 'Your profile loaded without its workspace link, so contacts can’t be fetched.'}{' '}
              Reloading normally fixes this.
            </p>
            <Button
              onClick={() => window.location.reload()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer px-4 text-xs font-bold"
            >
              Reload page
            </Button>
          </div>
        ) : loading ? (
          <div className="flex flex-col text-slate-400">
            <ContactsTableSkeleton />
            {slowLoadNotice}
          </div>
        ) : fetchFailed ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <WifiOff className="size-8 text-amber-400" />
            <p className="max-w-xs text-center text-sm text-slate-400">
              Couldn&apos;t load contacts — your connection looks slow or
              dropped. Your data is safe; try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => listQuery.refetch()}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Retry
            </Button>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Users className="size-8 text-slate-600" />
            <p className="text-sm text-slate-500">
              {search
                ? 'No contacts match your search.'
                : activeTab === 'pending_review'
                  ? 'No contacts pending review.'
                  : activeTab === 'favorites'
                    ? 'No favourites yet — star a contact to keep it here.'
                    : activeTab === 'transacted'
                      ? 'No transacted contacts found.'
                      : activeTab === 'market_active'
                        ? 'No active buyers found.'
                        : activeTab === 'archived'
                          ? 'No archived contacts.'
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
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead
                  className="group cursor-pointer text-xs font-semibold text-slate-400 transition-colors select-none hover:text-white"
                  onClick={() => {
                    setSortBy(sortBy === 'name_asc' ? 'name_desc' : 'name_asc');
                    setPage(0);
                  }}
                >
                  <div className="flex items-center gap-1">
                    Name
                    {sortBy === 'name_asc' ? (
                      <ArrowUp className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : sortBy === 'name_desc' ? (
                      <ArrowDown className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 text-slate-600 opacity-0 transition-all duration-200 group-hover:text-slate-400 group-hover:opacity-100" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-xs text-slate-400 select-none">
                  Classification
                </TableHead>
                <TableHead className="text-xs text-slate-400 select-none">
                  Phone
                </TableHead>
                <TableHead className="text-xs text-slate-400 select-none">
                  Tags
                </TableHead>
                <TableHead
                  className="group cursor-pointer text-xs font-semibold text-slate-400 transition-colors select-none hover:text-white"
                  onClick={() => {
                    setSortBy(
                      sortBy === 'last_contacted_desc'
                        ? 'last_contacted_asc'
                        : 'last_contacted_desc'
                    );
                    setPage(0);
                  }}
                >
                  <div className="flex items-center gap-1">
                    Last Contacted
                    {sortBy === 'last_contacted_desc' ? (
                      <ArrowDown className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : sortBy === 'last_contacted_asc' ? (
                      <ArrowUp className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 text-slate-600 opacity-0 transition-all duration-200 group-hover:text-slate-400 group-hover:opacity-100" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-xs text-slate-400 select-none">
                  Areas
                </TableHead>
                <TableHead className="text-xs text-slate-400 select-none">
                  Categories
                </TableHead>
                <TableHead
                  className="group cursor-pointer text-xs font-semibold text-slate-400 transition-colors select-none hover:text-white"
                  onClick={() => {
                    setSortBy(
                      sortBy === 'max_budget_desc'
                        ? 'max_budget_asc'
                        : 'max_budget_desc'
                    );
                    setPage(0);
                  }}
                >
                  <div className="flex items-center gap-1">
                    Max Budget
                    {sortBy === 'max_budget_desc' ? (
                      <ArrowDown className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : sortBy === 'max_budget_asc' ? (
                      <ArrowUp className="text-primary animate-in fade-in zoom-in size-3.5 shrink-0 duration-200" />
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 text-slate-600 opacity-0 transition-all duration-200 group-hover:text-slate-400 group-hover:opacity-100" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="w-12 text-slate-400" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => {
                const tagChips = splitTagChips(contact.tags ?? []);
                return (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer border-slate-800 hover:bg-slate-900/50"
                    onClick={() => openDetail(contact.id)}
                  >
                    <TableCell className="py-3 font-medium text-white">
                      <div className="flex flex-col gap-1">
                        <div
                          className="flex items-center gap-1.5 whitespace-nowrap"
                          title={`Added ${formatAuditDateTime(contact.created_at)} · Modified ${formatAuditDateTime(contact.updated_at)}`}
                        >
                          <span className="hover:text-primary transition-colors">
                            {contactFullName(contact) || (
                              <span className="text-xs text-slate-500 italic">
                                Unnamed
                              </span>
                            )}
                          </span>
                          {contact.name_tag && (
                            <span
                              className="inline-flex items-center rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 text-[11px] font-medium text-slate-300 select-none"
                              title="Name Tag — internal label, not sent in messages"
                            >
                              {contact.name_tag}
                            </span>
                          )}
                          {contact.tags?.some(
                            (t) => t.name.toUpperCase() === 'VIP'
                          ) && (
                            <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-amber-400 uppercase select-none">
                              ⭐ VIP
                            </span>
                          )}
                          {renderLeadTempBadge(contact.lead_temp)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {renderClassificationBadge(contact.classification)}
                    </TableCell>
                    <TableCell
                      className="py-3 font-mono text-xs text-slate-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${contact.phone}`}
                          className="hover:text-primary hover:underline"
                          title="Call number"
                          onClick={() =>
                            setPendingDial({
                              contactId: contact.id,
                              name: contact.name,
                              phone: contact.phone ?? '',
                              dialedAt: new Date().toISOString(),
                            })
                          }
                        >
                          {contact.phone}
                        </a>
                        <button
                          onClick={(e) => handleWhatsAppClick(e, contact)}
                          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-emerald-500/20 text-emerald-500 transition-all hover:bg-emerald-500/10 hover:text-emerald-400"
                          title="Chat on WhatsApp"
                        >
                          <MessageSquare className="size-3.5 fill-current" />
                        </button>
                        <button
                          onClick={(e) =>
                            handlePrefilledWhatsAppClick(e, contact)
                          }
                          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400"
                          title="Send pre-filled welcome message on WhatsApp"
                        >
                          <MessageSquarePlus className="size-3.5" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        {tagChips.visible.length > 0 ? (
                          tagChips.visible.map((tag) => (
                            <span
                              key={tag.id}
                              title={tag.name}
                              className="inline-flex max-w-[120px] items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                              style={{
                                backgroundColor: tag.color + '20',
                                color: tag.color,
                              }}
                            >
                              <span className="truncate">{tag.name}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                        {tagChips.hidden.length > 0 && (
                          <span
                            className="text-[11px] text-slate-500"
                            title={tagChips.hiddenTitle}
                          >
                            +{tagChips.hidden.length}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-slate-400">
                      {contact.last_contacted_at ? (
                        new Date(contact.last_contacted_at).toLocaleString(
                          'en-US',
                          {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          }
                        )
                      ) : (
                        <span className="text-slate-600">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-slate-400">
                      {renderPreferenceChips(effectiveAreas(contact))}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-slate-400">
                      {renderPreferenceChips(effectiveCategories(contact))}
                    </TableCell>
                    <TableCell className="py-3 text-xs font-medium text-slate-300">
                      {formatBudget(contact)}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={favoritingId === contact.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(contact);
                          }}
                          className={
                            contact.is_favorite
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-slate-400 hover:text-amber-400'
                          }
                          title={
                            contact.is_favorite
                              ? 'Remove from Favourites'
                              : 'Add to Favourites'
                          }
                        >
                          <Star
                            className={`size-4 ${contact.is_favorite ? 'fill-amber-400' : ''}`}
                          />
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
                            aria-label={`More actions for ${contactFullName(contact) || contact.phone || 'contact'}`}
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
                            className="border-slate-700 bg-slate-900"
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
                            {contact.phone &&
                              !['Buyer', 'Owner & Buyer'].includes(
                                contact.classification ?? ''
                              ) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailsRequestContact(contact);
                                  }}
                                  className="text-slate-300 focus:bg-slate-800 focus:text-white"
                                >
                                  <ClipboardList className="size-4" />
                                  Ask for property details
                                </DropdownMenuItem>
                              )}
                            {['Buyer', 'Owner & Buyer'].includes(
                              contact.classification ?? ''
                            ) && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRequirementsContact(contact);
                                }}
                                className="text-slate-300 focus:bg-slate-800 focus:text-white"
                              >
                                <ClipboardList className="size-4" />
                                Requirements
                              </DropdownMenuItem>
                            )}
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!loading && slowLoadNotice}

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {page * CONTACTS_PAGE_SIZE + 1}-
            {Math.min((page + 1) * CONTACTS_PAGE_SIZE, totalCount)} of{' '}
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
            <span className="px-2 text-xs text-slate-400">
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

      {/* Log-on-dial prompt: the browser gets nothing back from the
          phone app, so the outcome comes from the agent in one tap. */}
      <LogCallPrompt
        dial={pendingDial}
        onOpenChange={(open) => {
          if (!open) setPendingDial(null);
        }}
        onLogged={(contactId, calledAt) => {
          queryClient.setQueryData<ContactListPage>(listKey, (prev) =>
            prev
              ? {
                  ...prev,
                  contacts: prev.contacts.map((c) =>
                    c.id === contactId &&
                    (!c.last_contacted_at ||
                      new Date(calledAt) > new Date(c.last_contacted_at))
                      ? { ...c, last_contacted_at: calledAt }
                      : c
                  ),
                }
              : prev
          );
        }}
      />

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          void invalidateList();
          void queryClient.invalidateQueries({
            queryKey: ['contacts', 'tags'],
          });
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
        contactId={detailContactId}
        onUpdated={invalidateList}
      />

      {/* Import / re-engage wizard */}
      <ReengageWizard
        open={reengageOpen}
        onOpenChange={setReengageOpen}
        onImported={invalidateList}
      />

      <ContactCleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        onDone={invalidateList}
      />

      <BulkImportModal
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        contacts={bulkImportContacts}
        onImport={handleBulkImportSave}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Contact</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="font-medium text-slate-200">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-700 bg-slate-900">
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

      {/* The first ask, straight off the row — the same message the
          contact page sends, so an agent working the list does not have
          to open each contact to send it. */}
      {detailsRequestContact ? (
        <OwnerDetailsRequestDialog
          open
          onOpenChange={(next) => {
            if (!next) setDetailsRequestContact(null);
          }}
          contactId={detailsRequestContact.id}
          contactName={detailsRequestContact.name ?? ''}
          contactPhone={detailsRequestContact.phone ?? ''}
        />
      ) : null}
      {requirementsContact ? (
        <ContactRequirementsDialog
          open
          onOpenChange={(next) => {
            if (!next) setRequirementsContact(null);
          }}
          contact={requirementsContact}
          onChanged={() => {
            setRequirementsContact(null);
            void invalidateList();
          }}
        />
      ) : null}
    </div>
  );
}
