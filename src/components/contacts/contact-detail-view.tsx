'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createElement,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { resolveConversation } from '@/lib/conversations/resolve';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactNote,
  Deal,
  Property,
  CallLog,
  CallDirection,
  CallOutcome,
  ShowcaseSettings,
  AreaOfInterestGeo,
} from '@/types';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import { PropertyForm } from '@/components/inventory/property-form';
import { AreasOfInterestInput } from '@/components/contacts/areas-of-interest-input';
import { PROPERTY_INTEREST_OPTIONS } from '@/lib/property-interests';
import { ProjectsOfInterestInput } from '@/components/contacts/projects-of-interest-input';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { PartyPanel } from '@/components/contacts/party-panel';
import { useCan } from '@/hooks/use-can';
import {
  LogCallPrompt,
  type PendingDial,
} from '@/components/contacts/log-call-prompt';
import { contactFullName } from '@/lib/contacts/full-name';
import { hasPhone } from '@/lib/contacts/reachability';
import { pruneAreasGeo } from '@/lib/contacts/area-geo';
import {
  LANGUAGE_CODES,
  languageDisplay,
  type LanguageCode,
} from '@/lib/languages';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PriceHint } from '@/components/ui/price-hint';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Star,
  Link as LinkIcon,
  Loader2,
  Plus,
  Trash2,
  Save,
  MessageSquare,
  MessageSquarePlus,
  Users,
  Building,
  Unlink,
  Link,
  Edit,
  CalendarDays,
  Share2,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  Clock,
  ArrowUp,
  Waypoints,
  ArrowRightLeft,
  ClipboardList,
  Send,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getCurrencyIcon } from '@/lib/currency-utils';
import {
  buildInquiryDetailsMessage,
  propertyShowcaseUrl,
} from '@/lib/share-message-builder';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isReengagementError,
} from '@/lib/whatsapp/customer-window';
import { scanMessagesForProperties } from '@/lib/journey/chat-scan';
import { BRANDING } from '@/config/branding';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import { PropertyShareDialog } from '@/components/inventory/property-share-dialog';
import { LogExternalShareDialog } from '@/components/contacts/log-external-share-dialog';
import {
  CallRecordingAnalyzer,
  CallAnalysisSection,
} from '@/components/contacts/call-analysis';
import { GreetingsGeneratorDialog } from '@/components/contacts/greetings-generator-dialog';
import { OwnerDetailsRequestDialog } from '@/components/contacts/owner-details-request-dialog';
import { ContactRequirementsDialog } from '@/components/contacts/contact-requirements-dialog';
import { MoveToEngineDialog } from '@/components/contacts/move-to-engine-dialog';
import { ShareInventoryDialog } from '@/components/contacts/share-inventory-dialog';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import { isLocationGuarded } from '@/lib/inventory/location-guard';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();
  const { user, profile, accountId, canViewGuardedLocations } = useAuth();
  const router = useRouter();

  const [currency, setCurrency] = useState('INR');
  const [contact, setContact] = useState<Contact | null>(null);
  const autoMapAttemptedRef = useRef<Record<string, boolean>>({});
  // Which contact the edit fields were last initialized from. Refetches for
  // the same contact (after a save, approve, auto-map, ...) must NOT re-sync
  // the edit fields — that would wipe unsaved edits on the other tabs.
  const initializedContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      autoMapAttemptedRef.current = {};
      // Closing the panel discards unsaved edits: re-sync on next open.
      initializedContactIdRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    setActiveTab('details');
  }, [contactId]);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  // Controlled so the active tab survives re-renders and refetches
  const [activeTab, setActiveTab] = useState('details');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Which listing the share dialog is composing for. Any Interested
  // Properties row can drive it, not just the last-inquired one, so it
  // holds the property rather than a bare open flag.
  const [shareProperty, setShareProperty] = useState<Property | null>(null);
  const [logShareOpen, setLogShareOpen] = useState(false);
  const [greetingsOpen, setGreetingsOpen] = useState(false);
  const [moveToEngineOpen, setMoveToEngineOpen] = useState(false);
  const [detailsRequestOpen, setDetailsRequestOpen] = useState(false);
  const [inventoryShareOpen, setInventoryShareOpen] = useState(false);
  const collectsBuyerRequirements =
    contact?.classification === 'Buyer' ||
    contact?.classification === 'Owner & Buyer';

  // Details tab
  const [editName, setEditName] = useState('');
  const [editSecondName, setEditSecondName] = useState('');
  const [editNameTag, setEditNameTag] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSecondaryPhones, setEditSecondaryPhones] = useState<string[]>([]);
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editSource, setEditSource] = useState('');

  const [showcaseSettings, setShowcaseSettings] =
    useState<ShowcaseSettings | null>(null);

  const fetchShowcaseSettings = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('showcase_settings')
        .select('*')
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
  }, [supabase]);
  const [editClassification, setEditClassification] = useState<
    | 'Owner'
    | 'Seller'
    | 'Buyer'
    | 'Agent'
    | 'Developer'
    | 'Owner & Buyer'
    | 'Others'
  >('Others');

  // A classification change can hide the active tab's trigger — fall back
  useEffect(() => {
    if (
      activeTab === 'properties' &&
      ![
        'Owner',
        'Seller',
        'Agent',
        'Developer',
        'Buyer',
        'Owner & Buyer',
      ].includes(editClassification)
    ) {
      setActiveTab('details');
    }
  }, [activeTab, editClassification]);
  const [editLeadTemp, setEditLeadTemp] = useState<
    'HOT' | 'COLD' | 'Not Responding' | 'Dead' | ''
  >('');
  const [editPreferredLanguage, setEditPreferredLanguage] = useState<
    LanguageCode | ''
  >('');
  const [editLastInquiredPropertyId, setEditLastInquiredPropertyId] = useState<
    string | null
  >(null);
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [editReferrer, setEditReferrer] = useState('');
  const [editReferrerContactId, setEditReferrerContactId] = useState<
    string | null
  >(null);
  const [showReferrerSuggestions, setShowReferrerSuggestions] = useState(false);
  const [contactsList, setContactsList] = useState<Contact[]>([]);
  const [savingDetails, setSavingDetails] = useState(false);
  const [approving, setApproving] = useState(false);
  const [inquiredProperty, setInquiredProperty] = useState<Property | null>(
    null
  );
  const [portalAdLink, setPortalAdLink] = useState<{
    property_id: string;
  } | null>(null);
  const [mapAdOpen, setMapAdOpen] = useState(false);
  const [mappingAd, setMappingAd] = useState(false);
  const [inquiredProperties, setInquiredProperties] = useState<Property[]>([]);
  const [sendDetailsOnApprove, setSendDetailsOnApprove] = useState(true);
  const [propertyMessageStatus, setPropertyMessageStatus] = useState<
    Record<
      string,
      { sent: boolean; responded: boolean; lastSentAt: string | null }
    >
  >({});

  // Requirements for Agent/Owner/Seller/etc
  const [editRequirements, setEditRequirements] = useState('');
  const [editMinBudget, setEditMinBudget] = useState('');
  const [editMaxBudget, setEditMaxBudget] = useState('');
  const [editNoBudget, setEditNoBudget] = useState(false);
  const [editStrictAreaMatch, setEditStrictAreaMatch] = useState(false);
  const [editAreasOfInterest, setEditAreasOfInterest] = useState<string[]>([]);
  const [editAreasText, setEditAreasText] = useState('');
  const [editAreasGeo, setEditAreasGeo] = useState<AreaOfInterestGeo[]>([]);
  const [editProjectsOfInterest, setEditProjectsOfInterest] = useState<
    string[]
  >([]);
  const [editProjectsText, setEditProjectsText] = useState('');
  const [editStrictProjectMatch, setEditStrictProjectMatch] = useState(false);
  const [editPropertyInterests, setEditPropertyInterests] = useState<string[]>(
    []
  );
  const [editMinRoi, setEditMinRoi] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [editDob, setEditDob] = useState('');
  const [editFeedbackStatus, setEditFeedbackStatus] = useState<
    'not_requested' | 'requested' | 'collected'
  >('not_requested');

  // Associated Properties for Owner/Seller/Agent
  const [associatedProperties, setAssociatedProperties] = useState<Property[]>(
    []
  );
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertyFormOpen, setPropertyFormOpen] = useState(false);
  const [selectedPropertyForEdit, setSelectedPropertyForEdit] =
    useState<Property | null>(null);
  const [linkExistingOpen, setLinkExistingOpen] = useState(false);
  const [hoveredPropId, setHoveredPropId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Shared properties via WhatsApp
  const [sharedProperties, setSharedProperties] = useState<
    Array<Property & { sharedAt: string }>
  >([]);
  const [loadingSharedProperties, setLoadingSharedProperties] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [pinnedTagIds, setPinnedTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  // Calls tab
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [pendingDial, setPendingDial] = useState<PendingDial | null>(null);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const callHistoryRef = useRef<HTMLDivElement | null>(null);
  const [callForm, setCallForm] = useState<{
    direction: CallDirection;
    outcome: CallOutcome;
    duration_seconds: string;
    notes: string;
    called_at: string;
  }>({
    direction: 'outbound',
    outcome: 'connected',
    duration_seconds: '',
    notes: '',
    called_at: new Date().toISOString().slice(0, 16),
  });
  const [savingCall, setSavingCall] = useState(false);

  const fetchAllProperties = useCallback(async () => {
    const { data } = await supabase
      .from('properties')
      .select('*')
      .order('title');
    if (data) setAllProperties(data);
  }, [supabase]);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    // Show the spinner only when switching to a different contact; refetches
    // of the current contact keep the tree mounted (and the active tab).
    setContact((prev) => (prev && prev.id !== contactId ? null : prev));

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);

      // Initialize the edit fields only when a different contact loads.
      // Refetches for the same contact (after saving one tab, approving,
      // auto-mapping, ...) must not overwrite unsaved edits on other tabs.
      if (initializedContactIdRef.current !== data.id) {
        initializedContactIdRef.current = data.id;
        setEditName(data.name ?? '');
        setEditSecondName(data.second_name ?? '');
        setEditNameTag(data.name_tag ?? '');
        setEditPreferredLanguage(data.preferred_language ?? '');
        setEditPhone(data.phone);
        setEditSecondaryPhones(data.secondary_phones ?? []);
        setEditEmail(data.email ?? '');
        setEditCompany(data.company ?? '');
        setEditSource(data.source ?? '');
        setEditClassification((data as Contact).classification ?? 'Others');
        setEditLeadTemp((data as Contact).lead_temp ?? '');
        setEditLastInquiredPropertyId(data.last_inquired_property_id ?? null);
        setEditReferrer(data.referrer ?? '');
        setEditReferrerContactId(data.referrer_contact_id ?? null);
        const sourceContact = resolveRequirementSource(data);
        setEditRequirements(sourceContact.requirements ?? '');
        setEditMinBudget(
          sourceContact.pref_budget_min != null
            ? String(sourceContact.pref_budget_min)
            : sourceContact.min_budget != null
              ? String(sourceContact.min_budget)
              : ''
        );
        setEditMaxBudget(
          sourceContact.pref_budget_max != null
            ? String(sourceContact.pref_budget_max)
            : sourceContact.max_budget != null
              ? String(sourceContact.max_budget)
              : ''
        );
        setEditNoBudget(Boolean(sourceContact.no_budget));
        setEditStrictAreaMatch(!!data.strict_area_match);
        const initialProjects = Array.from(
          new Set([
            ...(sourceContact.projects_of_interest ?? []),
            ...(sourceContact.pref_projects ?? []),
          ])
        );
        setEditProjectsOfInterest(initialProjects);
        setEditProjectsText(
          initialProjects.join(', ') + (initialProjects.length > 0 ? ', ' : '')
        );
        setEditStrictProjectMatch(!!data.strict_project_match);
        const initialAreas = Array.from(
          new Set([
            ...(sourceContact.areas_of_interest ?? []),
            ...(sourceContact.pref_areas ?? []),
          ])
        );
        setEditAreasOfInterest(initialAreas);
        setEditAreasText(
          initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : '')
        );
        setEditAreasGeo((data as Contact).areas_of_interest_geo ?? []);
        const initialPropertyInterests = Array.from(
          new Set([
            ...(sourceContact.property_interests ?? []),
            ...(sourceContact.pref_property_types ?? []),
            ...(sourceContact.pref_property_categories ?? []),
          ])
        );
        setEditPropertyInterests(initialPropertyInterests);
        setEditMinRoi(data.min_roi ? String(data.min_roi) : '');
        setEditDob(data.dob ?? '');
        setEditFeedbackStatus(
          (data as Contact).feedback_status ?? 'not_requested'
        );
      }

      // Fetch last inquired property details (for backward compatibility)
      if (data.last_inquired_property_id) {
        const { data: propData } = await supabase
          .from('properties')
          .select('*')
          .eq('id', data.last_inquired_property_id)
          .maybeSingle();
        setInquiredProperty(propData || null);
      } else {
        setInquiredProperty(null);
      }

      // Is the portal ad this lead quoted already mapped to a listing?
      // A mapped ad needs no assertion — the webhook resolved this lead
      // through it, and will resolve every later one the same way.
      if (data.lead_portal && data.lead_portal_listing_id) {
        const { data: link } = await supabase
          .from('property_portal_listings')
          .select('property_id')
          .eq('portal', data.lead_portal)
          .eq('portal_listing_id', data.lead_portal_listing_id)
          .maybeSingle();
        setPortalAdLink(link ?? null);
      } else {
        setPortalAdLink(null);
      }

      // Fetch all inquired properties from junction table
      const { data: inquiries } = await supabase
        .from('contact_property_inquiries')
        .select('property_id')
        .eq('contact_id', contactId);

      if (inquiries && inquiries.length > 0) {
        const propertyIds = inquiries.map((i) => i.property_id);
        const { data: props } = await supabase
          .from('properties')
          .select('*')
          .in('id', propertyIds);
        setInquiredProperties(props || []);
      } else {
        setInquiredProperties([]);
      }
    }
  }, [contactId, supabase]);

  const fetchAssociatedProperties = useCallback(async () => {
    if (!contactId) return;
    setLoadingProperties(true);
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('owner_contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching associated properties:', error);
    } else {
      setAssociatedProperties(data || []);
    }
    setLoadingProperties(false);
  }, [contactId, supabase]);

  const fetchPropertyMessageStatus = useCallback(async () => {
    if (!contactId || inquiredProperties.length === 0) return;

    // Fetch all messages in conversations with this contact
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId);

    if (!conversations || conversations.length === 0) {
      setPropertyMessageStatus({});
      return;
    }

    const conversationIds = conversations.map((c) => c.id);
    const { data: messages } = await supabase
      .from('messages')
      .select('content_text, sender_type, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });

    if (!messages || messages.length === 0) {
      setPropertyMessageStatus({});
      return;
    }

    // Build status map for each property
    const statusMap: Record<
      string,
      { sent: boolean; responded: boolean; lastSentAt: string | null }
    > = {};

    inquiredProperties.forEach((prop) => {
      const searchTerms = [
        prop.title?.toLowerCase(),
        prop.property_code?.toLowerCase(),
        prop.location?.toLowerCase(),
      ].filter(Boolean);

      let lastSentAt: string | null = null;
      let hasResponse = false;

      messages.forEach((msg, idx) => {
        const content = (msg.content_text || '').toLowerCase();
        const isPropertyMentioned = searchTerms.some(
          (term) => term && content.includes(term)
        );

        if (isPropertyMentioned && msg.sender_type === 'agent') {
          lastSentAt = msg.created_at;
          // Check if there's any inbound message after this outbound message
          const laterMessages = messages.slice(idx + 1);
          hasResponse = laterMessages.some((m) => m.sender_type === 'customer');
        }
      });

      statusMap[prop.id] = {
        sent: lastSentAt !== null,
        responded: hasResponse,
        lastSentAt,
      };
    });

    setPropertyMessageStatus(statusMap);
  }, [contactId, inquiredProperties, supabase]);

  // Fetch message status when inquired properties change
  useEffect(() => {
    fetchPropertyMessageStatus();
  }, [fetchPropertyMessageStatus]);

  const fetchSharedProperties = useCallback(async () => {
    if (!contactId || allProperties.length === 0) return;
    setLoadingSharedProperties(true);
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .maybeSingle();

      if (!conv) {
        setSharedProperties([]);
        setLoadingSharedProperties(false);
        return;
      }

      const { data: messages, error } = await supabase
        .from('messages')
        .select('content_text, created_at')
        .eq('conversation_id', conv.id)
        .eq('sender_type', 'agent')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Shared scan logic with /journey's "Import from chat"
      // (src/lib/journey/chat-scan.ts): matches by showcase
      // property_id link, property code, or long exact title.
      const found = scanMessagesForProperties(messages ?? [], allProperties);
      const sharedProps: Array<Property & { sharedAt: string }> = [];
      found.forEach((sharedAt, propId) => {
        const prop = allProperties.find((p) => p.id === propId);
        if (prop) sharedProps.push({ ...prop, sharedAt });
      });

      setSharedProperties(sharedProps);
    } catch (err) {
      console.error('Error fetching shared properties:', err);
    } finally {
      setLoadingSharedProperties(false);
    }
  }, [contactId, allProperties, supabase]);

  async function handleUnlinkProperty(propertyId: string) {
    try {
      const { data, error } = await supabase
        .from('properties')
        .update({ owner_contact_id: null })
        .eq('id', propertyId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That property is no longer there.');
      toast.success('Property unlinked successfully');
      fetchAssociatedProperties();
      onUpdated();
    } catch (err) {
      console.error('Failed to unlink property:', err);
      toast.error('Failed to unlink property');
    }
  }

  async function handleLinkExistingProperty(propertyId: string | null) {
    if (!propertyId || !contactId) return;
    try {
      const { data, error } = await supabase
        .from('properties')
        .update({ owner_contact_id: contactId })
        .eq('id', propertyId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That property is no longer there.');
      toast.success('Property linked to contact');
      setLinkExistingOpen(false);
      fetchAssociatedProperties();
      onUpdated();
    } catch (err) {
      console.error('Failed to link existing property:', err);
      toast.error('Failed to link property');
    }
  }

  const handleLinkInterestProperty = useCallback(
    async (propertyId: string | null) => {
      try {
        const { data, error } = await supabase
          .from('contacts')
          .update({ last_inquired_property_id: propertyId })
          .eq('id', contactId)
          .select('id');

        if (error) throw error;
        if (!data?.length) throw new Error('That contact is no longer there.');

        // Also add to junction table if linking a property
        if (propertyId) {
          await supabase.from('contact_property_inquiries').upsert(
            {
              account_id: accountId,
              contact_id: contactId,
              property_id: propertyId,
              inquiry_source: 'Manual',
            },
            { onConflict: 'contact_id,property_id' }
          );
        }

        toast.success(
          propertyId
            ? 'Interest property linked successfully'
            : 'Interest property cleared'
        );
        setEditLastInquiredPropertyId(propertyId);

        if (propertyId) {
          const { data: propData } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .maybeSingle();
          setInquiredProperty(propData || null);

          // Update inquired properties list
          if (
            propData &&
            !inquiredProperties.find((p) => p.id === propertyId)
          ) {
            setInquiredProperties((prev) => [...prev, propData]);
          }
        } else {
          setInquiredProperty(null);
        }
        onUpdated();
      } catch (err) {
        console.error('Failed to update interest property:', err);
        toast.error('Failed to update interest property');
      }
    },
    [supabase, contactId, accountId, onUpdated, inquiredProperties]
  );

  // Dropping the junction row and clearing the headline pointer are one
  // correction, not two writes a client can half-apply — the route owns
  // the pair so mobile cannot diverge from it.
  const handleRemoveInquiredProperty = useCallback(
    async (propertyId: string) => {
      try {
        const res = await fetch(
          `/api/contacts/${contactId}/inquiries/${propertyId}`,
          {
            method: 'DELETE',
          }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(body?.error || 'Failed to remove property interest');

        setInquiredProperties((prev) =>
          prev.filter((p) => p.id !== propertyId)
        );
        if (body?.data?.pointerCleared) {
          setEditLastInquiredPropertyId(null);
          setInquiredProperty(null);
        }

        toast.success('Property removed from interests');
        onUpdated();
      } catch (err) {
        console.error('Failed to remove property interest:', err);
        toast.error(
          err instanceof Error
            ? err.message
            : 'Failed to remove property interest'
        );
      }
    },
    [contactId, onUpdated]
  );

  // The agent's one-time assertion that a portal ad IS a listing. From
  // then on the lead webhook resolves every enquiry quoting that ad
  // exactly, and the leads already waiting on it move across now.
  const handleMapPortalAd = useCallback(
    async (propertyId: string) => {
      setMappingAd(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/portal-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Could not map the ad');

        const others = (body.data?.taggedContacts ?? 1) - 1;
        toast.success(
          `Ad mapped to "${body.data?.propertyTitle}".` +
            (others > 0
              ? ` ${others} waiting lead${others === 1 ? '' : 's'} moved across.`
              : '')
        );
        setMapAdOpen(false);
        await fetchContact();
        onUpdated();
      } catch (err) {
        console.error('Failed to map portal ad:', err);
        toast.error(
          err instanceof Error ? err.message : 'Could not map the ad'
        );
      } finally {
        setMappingAd(false);
      }
    },
    [contactId, fetchContact, onUpdated]
  );

  useEffect(() => {
    async function loadContacts() {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .order('name');
      if (data) setContactsList(data);
    }
    if (contactId) {
      loadContacts();
    }
  }, [contactId, supabase]);

  // Linking a party writes contact data, so it takes the same agent+
  // gate the API route enforces.
  const canEditContacts = useCan('send-messages');

  const filteredReferrerContacts = useMemo(() => {
    if (!editReferrer.trim()) return [];
    return contactsList
      .filter(
        (c) =>
          c.id !== contactId &&
          (contactFullName(c)
            .toLowerCase()
            .includes(editReferrer.toLowerCase()) ||
            (c.phone && c.phone.includes(editReferrer)))
      )
      .slice(0, 5);
  }, [contactsList, editReferrer, contactId]);

  // Applied tags lead; the rest keep their alphabetical order behind
  // them (sort is stable, and the query already orders by name).
  const orderedTags = useMemo(() => {
    const lead = new Set(pinnedTagIds);
    return [...allTags].sort(
      (a, b) => Number(lead.has(b.id)) - Number(lead.has(a.id))
    );
  }, [allTags, pinnedTagIds]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      const ids = contactTagsRes.data.map((ct) => ct.tag_id);
      setContactTagIds(ids);
      // Snapshot for ordering only. Pinned at load rather than tracking
      // contactTagIds, so toggling a tag doesn't slide the next one out
      // from under the cursor mid-click.
      setPinnedTagIds(ids);
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  const fetchCalls = useCallback(async () => {
    if (!contactId) return;
    setLoadingCalls(true);
    const res = await fetch(`/api/contacts/${contactId}/calls`);
    if (res.ok) {
      const data = await res.json();
      setCalls(data.calls ?? []);
    }
    setLoadingCalls(false);
  }, [contactId]);

  useEffect(() => {
    if (open && contactId) {
      fetchShowcaseSettings();
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchDeals();
      fetchCalls();
      fetchAssociatedProperties();
      fetchAllProperties();
    }
  }, [
    open,
    contactId,
    fetchShowcaseSettings,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchDeals,
    fetchCalls,
    fetchAssociatedProperties,
    fetchAllProperties,
  ]);

  useEffect(() => {
    if (open && contactId && allProperties.length > 0) {
      fetchSharedProperties();
    }
  }, [open, contactId, allProperties, fetchSharedProperties]);

  // Auto-map inquired property from contact notes if none is assigned
  useEffect(() => {
    if (
      open &&
      contactId &&
      !editLastInquiredPropertyId &&
      notes.length > 0 &&
      allProperties.length > 0 &&
      !autoMapAttemptedRef.current[contactId]
    ) {
      // Mark as attempted so we don't scan again for this contactId during this drawer session
      autoMapAttemptedRef.current[contactId] = true;
      // Find matching property in notes
      let matchedProperty: Property | null = null;

      for (const note of notes) {
        const text = note.note_text || '';
        if (!text) continue;

        // Try to match one of the properties
        const match = allProperties.find((prop) => {
          const textLower = text.toLowerCase();

          // 1. Property code match (e.g. PROP-1002) - strongest match
          if (
            prop.property_code &&
            textLower.includes(prop.property_code.toLowerCase())
          ) {
            return true;
          }

          // 2. Title match
          if (textLower.includes(prop.title.toLowerCase())) {
            return true;
          }

          // 3. Full project match (minimum 3 characters)
          if (prop.project && prop.project.trim().length >= 3) {
            const proj = prop.project.trim().toLowerCase();
            if (textLower.includes(proj)) return true;
          }

          // 4. First 2 words of project match (e.g. "SJR Blue" for "SJR Blue Waters")
          if (prop.project) {
            const projectWords = prop.project.trim().toLowerCase().split(/\s+/);
            if (projectWords.length >= 2) {
              const firstTwoWords = projectWords.slice(0, 2).join(' ');
              if (
                firstTwoWords.length >= 5 &&
                textLower.includes(firstTwoWords)
              ) {
                return true;
              }
            }
          }

          // 5. Cleaned title keywords match (ignores prepositions and common specifiers)
          const stopWords = new Set([
            'in',
            'at',
            'to',
            'on',
            'of',
            'a',
            'an',
            'the',
            'with',
            'by',
            'for',
            'and',
            'or',
            'is',
            'are',
            'am',
            'was',
            'were',
          ]);
          const cleanTitle = prop.title
            .toLowerCase()
            .replace(
              /(?:\d+\s*(?:bhk|bedroom|bath|bathroom)|apartment|villa|plot|house|for\s+sale|for\s+rent|luxurious|luxury|beautiful|spacious|rent|sale)/gi,
              ' '
            )
            .replace(/[^\w\s]/g, ' ')
            .trim();

          const cleanWords = cleanTitle
            .split(/\s+/)
            .filter((w) => w.length > 1 && !stopWords.has(w));
          if (cleanWords.length >= 2) {
            const phrase2 = cleanWords.slice(0, 2).join(' ');
            if (phrase2.length >= 6 && textLower.includes(phrase2)) {
              return true;
            }
            if (cleanWords.length >= 3) {
              const phrase3 = cleanWords.slice(0, 3).join(' ');
              if (phrase3.length >= 8 && textLower.includes(phrase3)) {
                return true;
              }
            }
          }

          // 6. Fallback project keywords from title
          const projectKeywords = prop.title
            .replace(
              /(?:\d+\s*(?:BHK|bhk)|apartment|villa|plot|house|for\s+sale|for\s+rent)/gi,
              ''
            )
            .trim();
          if (
            projectKeywords.length > 5 &&
            textLower.includes(projectKeywords.toLowerCase())
          ) {
            return true;
          }

          return false;
        });

        if (match) {
          matchedProperty = match;
          break;
        }
      }

      if (matchedProperty) {
        toast.info(
          `Auto-mapping "${matchedProperty.title}" as inquired property from notes...`
        );
        handleLinkInterestProperty(matchedProperty.id);
      }
    }
  }, [
    open,
    contactId,
    editLastInquiredPropertyId,
    notes,
    allProperties,
    handleLinkInterestProperty,
  ]);

  async function copyPhone() {
    if (!contact) return;
    if (!hasPhone(contact)) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  // Same star as the Contacts table row, mirrored here because the
  // detail panel covers that column while it is open.
  async function toggleFavorite() {
    if (!contact || favoriting) return;
    const next = !contact.is_favorite;
    setFavoriting(true);
    setContact((prev) => (prev ? { ...prev, is_favorite: next } : prev));
    try {
      const res = await fetch(`/api/contacts/${contact.id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: next }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update favourite');
      }
      toast.success(next ? 'Added to Favourites' : 'Removed from Favourites');
      onUpdated();
    } catch (err) {
      setContact((prev) => (prev ? { ...prev, is_favorite: !next } : prev));
      toast.error(
        err instanceof Error ? err.message : 'Failed to update favourite'
      );
    } finally {
      setFavoriting(false);
    }
  }

  async function handleWhatsAppClick() {
    if (!contact || !accountId) {
      toast.error('Account not loaded or contact not loaded');
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
  }

  // Resolve the account's public showcase base URL (subdomain-aware,
  // `?ref=` fallback) — shared by the welcome link and the approval
  // details message.
  const getShowcaseBaseUrl = (): string => {
    if (typeof window === 'undefined') return '';
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
    const url = new URL(`${window.location.protocol}//${targetDomain}`);
    if (!showcaseSettings?.subdomain && accountId) {
      url.searchParams.set('ref', accountId);
    }
    return url.toString();
  };

  const getPrefilledWhatsAppLink = () => {
    if (!contact) return '';
    const cleanPhone = contact.phone?.replace(/\D/g, '') ?? '';
    if (!cleanPhone) return '';

    const agentName = profile?.full_name || '';
    const displayName = contact.name || 'there';

    const finalShowcaseUrl = getShowcaseBaseUrl();
    const showcaseUrlObj: URL | null = finalShowcaseUrl
      ? new URL(finalShowcaseUrl)
      : null;

    let linkSection = '';
    if (showcaseUrlObj) {
      if (inquiredProperty) {
        const singlePropUrl = new URL(showcaseUrlObj.toString());
        singlePropUrl.searchParams.set(
          'property_id',
          inquiredProperty.property_code || inquiredProperty.id
        );

        const matchingUrl = new URL(showcaseUrlObj.toString());
        if (inquiredProperty.listing_type) {
          matchingUrl.searchParams.set(
            'listing_type',
            inquiredProperty.listing_type
          );
        }
        if (inquiredProperty.type) {
          matchingUrl.searchParams.set('category', inquiredProperty.type);
        }
        const searchLocation =
          inquiredProperty.sublocality || inquiredProperty.city || '';
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

  const handlePrefilledWhatsAppClick = () => {
    const link = getPrefilledWhatsAppLink();
    if (link) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else {
      toast.error('Invalid phone number or showcase settings not loaded');
    }
  };

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setSavingDetails(true);

    const defaultCc =
      showcaseSettings?.default_country_code ||
      BRANDING.defaultCountryCode ||
      '91';
    const normalizedPrimary = normalizePhoneWithCountryCode(
      editPhone.trim(),
      defaultCc
    );
    if (!normalizedPrimary) {
      toast.error('Invalid primary phone number format');
      setSavingDetails(false);
      return;
    }

    const normalizedSecondary = editSecondaryPhones
      .filter((p) => p.trim().length > 0)
      .map((p) => normalizePhoneWithCountryCode(p.trim(), defaultCc))
      .filter(Boolean);

    const { data, error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        second_name: editSecondName.trim() || null,
        name_tag: editNameTag.trim() || null,
        preferred_language: editPreferredLanguage || null,
        phone: normalizedPrimary,
        secondary_phones: normalizedSecondary,
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        classification: editClassification,
        source: editSource.trim() || null,
        lead_temp: editLeadTemp || null,
        last_inquired_property_id: editLastInquiredPropertyId,
        referrer: editReferrer.trim() || null,
        referrer_contact_id: editReferrerContactId,
        requirements: editRequirements.trim() || null,
        dob: editDob || null,
        feedback_status: editFeedbackStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .select('id');

    if (error || !data?.length) {
      toast.error(
        error?.code === '23505'
          ? `A contact named "${editName.trim()} ${editSecondName.trim()}" already exists. Use a different second name to tell them apart.`
          : 'Failed to update contact'
      );
    } else {
      toast.success('Contact updated');
      // Reflect server-side phone normalization locally — the refetch below
      // intentionally no longer overwrites edit fields.
      setEditPhone(normalizedPrimary);
      setEditSecondaryPhones(normalizedSecondary);
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  const handleSwapSecondaryToPrimary = (idx: number) => {
    const currentPrimary = editPhone;
    const selectedSecondary = editSecondaryPhones[idx];

    setEditPhone(selectedSecondary);
    const updated = [...editSecondaryPhones];
    updated[idx] = currentPrimary;
    setEditSecondaryPhones(updated);

    toast.success('Phone numbers swapped! Remember to save changes.');
  };

  // Template-first, server-side: an open window sends the composed
  // details as free text, a closed one sends the approved property-alert
  // template instead of dead-ending. Only when the window is closed AND
  // no approved template exists does this throw, so the caller falls back
  // to manual template selection.
  async function sendPropertyDetailsHelper() {
    if (!contactId || !inquiredProperty) return;

    const showcaseBase = getShowcaseBaseUrl();
    const messageText = buildInquiryDetailsMessage({
      property: inquiredProperty,
      url: showcaseBase
        ? propertyShowcaseUrl(showcaseBase, inquiredProperty)
        : '',
      currency: showcaseSettings?.currency,
    });

    const res = await fetch('/api/whatsapp/share-property', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contactId,
        property_id: inquiredProperty.id,
        message: messageText,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || 'Failed to send WhatsApp message');
    }
    if (!payload?.data?.sent) {
      throw new Error(CUSTOMER_WINDOW_EXPIRED_MESSAGE);
    }
    return payload.data.channel as 'freeform' | 'template' | undefined;
  }

  async function handleSendPropertyDetails() {
    setApproving(true);
    try {
      const channel = await sendPropertyDetailsHelper();
      toast.success(
        channel === 'template'
          ? 'Chat is past the 24-hour window — details sent as the approved property template.'
          : 'Property details sent successfully via WhatsApp!'
      );
    } catch (err) {
      console.error(err);
      if (isReengagementError(err)) {
        toast.warning(
          'WhatsApp session has expired (over 24 hours). Redirecting to template selection...'
        );
        setShareProperty(inquiredProperty);
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Failed to send property details'
        );
      }
    } finally {
      setApproving(false);
    }
  }

  async function approveContact() {
    if (!contactId) return;
    setApproving(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId)
        .select('id');

      if (error) throw error;
      if (!data?.length) {
        throw new Error('You do not have permission to approve this contact.');
      }

      if (sendDetailsOnApprove && inquiredProperty) {
        try {
          await sendPropertyDetailsHelper();
          toast.success('Approved & property details sent via WhatsApp!');
        } catch (waErr) {
          console.error('Failed to auto-send WhatsApp details:', waErr);
          if (isReengagementError(waErr)) {
            toast.warning(
              'Contact approved, but WhatsApp free-text failed (session >24 hrs). Redirecting to templates...'
            );
            setShareProperty(inquiredProperty);
          } else {
            toast.warning(
              'Contact approved, but failed to send WhatsApp details (check WhatsApp configuration).'
            );
          }
        }
      } else {
        toast.success('Contact approved and added to the Engine!');
      }

      fetchContact();
      onUpdated();
    } catch (err) {
      console.error('Failed to approve contact:', err);
      toast.error('Failed to approve contact');
    } finally {
      setApproving(false);
    }
  }

  async function savePreferences() {
    if (!contactId) return;
    setSavingPreferences(true);

    const prunedAreasGeo = pruneAreasGeo(editAreasGeo, editAreasOfInterest);
    const { data: saved, error } = await supabase
      .from('contacts')
      .update({
        min_budget: editMinBudget ? Number(editMinBudget) : null,
        max_budget: editMaxBudget ? Number(editMaxBudget) : null,
        no_budget: editNoBudget,
        strict_area_match: editStrictAreaMatch,
        projects_of_interest: editProjectsOfInterest,
        strict_project_match:
          editProjectsOfInterest.length > 0 && editStrictProjectMatch,
        areas_of_interest: editAreasOfInterest,
        areas_of_interest_geo: prunedAreasGeo,
        property_interests: editPropertyInterests,
        min_roi: editMinRoi ? Number(editMinRoi) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .select('id');

    if (error || !saved?.length) {
      toast.error('Failed to update advanced matching options');
    } else {
      toast.success('Advanced matching options updated');
      setEditAreasGeo(prunedAreasGeo);
      fetchContact();
      onUpdated();
    }
    setSavingPreferences(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { data, error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId)
        .select('tag_id');
      if (!error && data?.length) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      } else {
        toast.error('Could not remove that tag.');
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    if (!user || !accountId) {
      toast.error('Not authenticated or account not loaded');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: user.id,
      account_id: accountId,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('Failed to add note');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Note added');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { data, error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId)
      .select('id');

    if (error || !data?.length) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-lg"
      >
        {!contact ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-primary size-6 animate-spin" />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Header */}
            <SheetHeader className="border-b border-slate-700/50 p-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 border border-slate-700 bg-slate-800">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex items-center gap-2 truncate text-white">
                    <button
                      onClick={toggleFavorite}
                      disabled={favoriting}
                      className={`shrink-0 cursor-pointer transition-colors disabled:opacity-50 ${
                        contact.is_favorite
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-slate-500 hover:text-amber-400'
                      }`}
                      title={
                        contact.is_favorite
                          ? 'Remove from Favourites'
                          : 'Add to Favourites'
                      }
                    >
                      <Star
                        className={`size-4 ${contact.is_favorite ? 'fill-amber-400' : ''}`}
                      />
                    </button>
                    <span className="truncate">
                      {contactFullName(contact) || 'Unknown'}
                    </span>
                    {contact.name_tag && (
                      <span
                        className="ml-2 inline-flex items-center rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 align-middle text-[10px] font-medium text-slate-300 select-none"
                        title="Name Tag — internal label, not sent in messages"
                      >
                        {contact.name_tag}
                      </span>
                    )}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 text-xs text-slate-400">
                    Contact details
                  </SheetDescription>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <a
                      href={`tel:${contact.phone}`}
                      className="hover:text-primary flex cursor-pointer items-center gap-1 text-slate-300 transition-colors"
                      onClick={() =>
                        setPendingDial({
                          contactId: contact.id,
                          name: contact.name,
                          phone: contact.phone ?? '',
                          dialedAt: new Date().toISOString(),
                        })
                      }
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                    </a>
                    <button
                      onClick={copyPhone}
                      className="hover:text-primary flex cursor-pointer items-center gap-1 transition-colors"
                      title="Copy phone number"
                    >
                      {copiedPhone ? (
                        <Check className="text-primary size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    <button
                      onClick={handleWhatsAppClick}
                      className="hover:text-emerald-350 flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/20 px-2 py-0.5 font-medium text-emerald-400 transition-all hover:bg-emerald-500/10"
                    >
                      <MessageSquare className="size-3 fill-current text-emerald-400" />
                      WhatsApp Chat
                    </button>
                    <button
                      onClick={handlePrefilledWhatsAppClick}
                      className="hover:text-emerald-350 flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/20 px-2 py-0.5 font-medium text-emerald-400 transition-all hover:bg-emerald-500/10"
                    >
                      <MessageSquarePlus className="size-3 fill-current stroke-slate-950 text-emerald-400" />
                      Send Welcome
                    </button>
                    <button
                      onClick={() => setMoveToEngineOpen(true)}
                      className="hover:text-emerald-350 flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/20 px-2 py-0.5 font-medium text-emerald-400 transition-all hover:bg-emerald-500/10"
                      title="Invite them to message the Engine number, so their replies land in the inbox"
                    >
                      <ArrowRightLeft className="size-3 text-emerald-400" />
                      Move to Engine
                    </button>
                    <button
                      onClick={() => setScheduleOpen(true)}
                      className="text-primary hover:text-primary-foreground hover:bg-primary/10 border-primary/20 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium transition-all"
                    >
                      <CalendarDays className="text-primary size-3" />
                      Schedule
                    </button>
                    <button
                      onClick={() => setLogShareOpen(true)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/20 px-2 py-0.5 font-medium text-amber-400 transition-all hover:bg-amber-500/10 hover:text-amber-300"
                    >
                      <Share2 className="size-3 text-amber-400" />
                      Share Listing
                    </button>
                    {contact.classification === 'Agent' && (
                      <button
                        onClick={() => setInventoryShareOpen(true)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-violet-500/20 px-2 py-0.5 font-medium text-violet-400 transition-all hover:bg-violet-500/10 hover:text-violet-300"
                      >
                        <Send className="size-3 text-violet-400" />
                        Share Inventory
                      </button>
                    )}
                    {collectsBuyerRequirements ? (
                      <button
                        onClick={() => setActiveTab('requirements')}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/20 px-2 py-0.5 font-medium text-sky-400 transition-all hover:bg-sky-500/10 hover:text-sky-300"
                        title="Review, edit, add or request this buyer's requirements"
                      >
                        <ClipboardList className="size-3 text-sky-400" />
                        Requirements
                      </button>
                    ) : (
                      <button
                        onClick={() => setDetailsRequestOpen(true)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/20 px-2 py-0.5 font-medium text-amber-400 transition-all hover:bg-amber-500/10 hover:text-amber-300"
                        title="Ask this owner for the full property details, and tell them what updates this number will send back"
                      >
                        <ClipboardList className="size-3 text-amber-400" />
                        Ask for Details
                      </button>
                    )}
                    <button
                      onClick={() =>
                        router.push(`/journey?contact=${contact.id}`)
                      }
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/20 px-2 py-0.5 font-medium text-sky-400 transition-all hover:bg-sky-500/10 hover:text-sky-300"
                    >
                      <Waypoints className="size-3 text-sky-400" />
                      Journey Map
                    </button>
                    <button
                      onClick={() => setGreetingsOpen(true)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-rose-500/20 px-2 py-0.5 font-medium text-rose-400 transition-all hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      <span className="flex size-3 items-center justify-center text-[10px]">
                        🎉
                      </span>
                      Send Greeting
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                    {contact.referrer && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Users className="size-3 text-slate-500" />
                        Ref: {contact.referrer}
                      </span>
                    )}
                    {contact.source && (
                      <span className="bg-primary/10 text-primary border-primary/20 inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold">
                        {contact.source}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* Review Status Banner */}
            {contact.status === 'pending_review' && (
              <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex shrink-0 animate-pulse items-center rounded-full border border-amber-500/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                      Needs Review
                    </span>
                    <span className="truncate text-[11px] text-amber-300">
                      From {contact.referrer || 'External Source'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {inquiredProperty && (
                      <label className="flex cursor-pointer items-center gap-1 text-[11px] whitespace-nowrap text-slate-400 select-none">
                        <input
                          type="checkbox"
                          checked={sendDetailsOnApprove}
                          onChange={(e) =>
                            setSendDetailsOnApprove(e.target.checked)
                          }
                          className="text-primary size-3 rounded border-slate-700 bg-slate-800 focus:ring-0 focus:ring-offset-0"
                        />
                        Send details
                      </label>
                    )}
                    <Button
                      size="sm"
                      onClick={approveContact}
                      disabled={approving}
                      className="flex h-6 cursor-pointer items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-600 disabled:bg-amber-500/50"
                    >
                      {approving && <Loader2 className="size-3 animate-spin" />}
                      Approve
                    </Button>
                  </div>
                </div>

                {/* What the lead was filed against, and the two
                    corrections that matter before approving sends them
                    its details: un-tag a wrong guess, and map the portal
                    ad once so no later lead on it has to be guessed. */}
                {inquiredProperty && (
                  <div className="mt-1.5 flex min-w-0 items-center gap-2 border-t border-amber-500/15 pt-1.5 text-[11px]">
                    <span className="shrink-0 text-slate-500">
                      Contacted about
                    </span>
                    <span className="truncate font-semibold text-slate-300">
                      {inquiredProperty.title}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveInquiredProperty(inquiredProperty.id)
                      }
                      className="shrink-0 cursor-pointer font-bold text-red-400 hover:text-red-300"
                    >
                      Wrong listing?
                    </button>
                  </div>
                )}

                {contact.lead_portal_listing_id && (
                  <div className="mt-1.5 flex min-w-0 items-center gap-2 border-t border-amber-500/15 pt-1.5 text-[11px]">
                    <LinkIcon
                      className={`size-3 shrink-0 ${portalAdLink ? 'text-emerald-400' : 'text-amber-400'}`}
                    />
                    <span className="shrink-0 font-semibold text-slate-300">
                      {contact.source || contact.lead_portal} ad{' '}
                      {contact.lead_portal_listing_id}
                    </span>
                    {portalAdLink ? (
                      <span className="truncate text-slate-500">
                        mapped — enquiries on it match automatically
                      </span>
                    ) : (
                      <>
                        <span className="truncate text-slate-500">
                          not mapped yet
                        </span>
                        <button
                          type="button"
                          onClick={() => setMapAdOpen((v) => !v)}
                          className="text-primary hover:text-primary/80 shrink-0 cursor-pointer font-bold"
                        >
                          {mapAdOpen ? 'Cancel' : 'Map to a listing'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {mapAdOpen && !portalAdLink && (
                  <div className="space-y-1.5 pt-2">
                    <SearchablePropertySelect
                      properties={allProperties}
                      value={null}
                      onChange={(propertyId) =>
                        propertyId && handleMapPortalAd(propertyId)
                      }
                      placeholder={
                        mappingAd ? 'Mapping…' : 'Which listing is this ad?'
                      }
                    />
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      Asserted once. Every future enquiry quoting this ad id
                      resolves to that listing exactly, and the leads already
                      waiting on it are tagged now.
                    </p>
                  </div>
                )}
              </div>
            )}

            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(String(v))}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mx-0 mt-3 w-full scrollbar-none flex-nowrap justify-start overflow-x-auto rounded-none border-b border-slate-700 bg-slate-800/50 px-4">
                <TabsTrigger
                  value="details"
                  className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                >
                  Details
                </TabsTrigger>
                {collectsBuyerRequirements && (
                  <TabsTrigger
                    value="requirements"
                    className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                  >
                    Requirements
                  </TabsTrigger>
                )}
                {[
                  'Owner',
                  'Seller',
                  'Agent',
                  'Developer',
                  'Buyer',
                  'Owner & Buyer',
                ].includes(editClassification) && (
                  <TabsTrigger
                    value="properties"
                    className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                  >
                    Properties
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="tags"
                  className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                >
                  Tags
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                >
                  Deals
                </TabsTrigger>
                <TabsTrigger
                  value="calls"
                  className="data-active:text-primary shrink-0 text-slate-400 data-active:bg-slate-800"
                >
                  Calls
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent
                value="details"
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  <div className="space-y-3">
                    <div className="grid grid-cols-6 gap-2">
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs text-slate-400">Name</Label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs text-slate-400">
                          Second Name
                        </Label>
                        <Input
                          value={editSecondName}
                          onChange={(e) => setEditSecondName(e.target.value)}
                          placeholder="Doe"
                          className="h-8 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-600"
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs text-slate-400">
                          Name Tag
                        </Label>
                        <Input
                          value={editNameTag}
                          onChange={(e) => setEditNameTag(e.target.value)}
                          placeholder="Bank DSA"
                          className="h-8 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-600"
                        />
                      </div>
                      <p className="col-span-6 -mt-0.5 text-[10px] text-slate-500">
                        Messages always use the Name alone — Second Name and
                        Name Tag show only inside the Engine. Name + Second Name
                        must be unique.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        Phone <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-slate-400">
                          Secondary Phone Numbers
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditSecondaryPhones([...editSecondaryPhones, ''])
                          }
                          className="text-primary hover:text-primary-hover flex h-5 items-center gap-1 border border-slate-700/50 px-1.5 text-[10px] hover:bg-slate-800"
                        >
                          <Plus className="h-2.5 w-2.5" />
                          Add Number
                        </Button>
                      </div>

                      {editSecondaryPhones.length > 0 && (
                        <div className="mt-1 space-y-1.5">
                          {editSecondaryPhones.map((secPhone, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1.5"
                            >
                              <Input
                                value={secPhone}
                                onChange={(e) => {
                                  const updated = [...editSecondaryPhones];
                                  updated[idx] = e.target.value;
                                  setEditSecondaryPhones(updated);
                                }}
                                placeholder="+91 98765 43210"
                                className="h-8 flex-1 border-slate-700 bg-slate-800 text-sm text-white"
                              />
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                          handleSwapSecondaryToPrimary(idx)
                                        }
                                        className="hover:text-primary h-8 w-8 shrink-0 animate-none text-slate-400 hover:bg-slate-800"
                                      />
                                    }
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    Make primary (swap with current primary)
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          setEditSecondaryPhones(
                                            editSecondaryPhones.filter(
                                              (_, i) => i !== idx
                                            )
                                          );
                                        }}
                                        className="h-8 w-8 shrink-0 animate-none text-slate-400 hover:bg-slate-800 hover:text-red-400"
                                      />
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    Delete secondary number
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">Email</Label>
                      <Input
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">Company</Label>
                      <Input
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                      />
                    </div>
                    <div className="relative space-y-1.5">
                      <Label className="text-xs text-slate-400">Referer</Label>
                      <div className="relative">
                        <Input
                          value={editReferrer}
                          onChange={(e) => {
                            setEditReferrer(e.target.value);
                            setEditReferrerContactId(null);
                            setShowReferrerSuggestions(true);
                          }}
                          onFocus={() => setShowReferrerSuggestions(true)}
                          onBlur={() => {
                            setTimeout(
                              () => setShowReferrerSuggestions(false),
                              200
                            );
                          }}
                          className="h-8 w-full animate-none border-slate-700 bg-slate-800 pr-16 text-sm text-white"
                          placeholder="Search existing contact or type a name..."
                        />
                        {editReferrerContactId && (
                          <span className="bg-primary/20 text-primary border-primary/30 absolute top-1/2 right-3 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                            Linked
                          </span>
                        )}

                        {/* Hover property preview — rendered via portal so it escapes the Sheet overflow */}
                        {hoveredPropId &&
                          hoverPos &&
                          typeof document !== 'undefined' &&
                          (() => {
                            const prop = inquiredProperties.find(
                              (p) => p.id === hoveredPropId
                            );
                            if (!prop) return null;
                            const el = (
                              <div
                                className="bg-slate-850 pointer-events-none fixed z-[200] w-64 rounded-lg border border-slate-700 p-3 shadow-xl shadow-black/40"
                                style={{
                                  top: hoverPos.top,
                                  left: hoverPos.left,
                                }}
                              >
                                <div className="mb-2 flex items-center gap-1.5">
                                  {prop.property_code && (
                                    <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                                      {prop.property_code}
                                    </span>
                                  )}
                                  <span className="rounded border border-slate-700 bg-slate-800 px-1 py-0 text-[10px] font-semibold text-slate-400 uppercase">
                                    {prop.type}
                                  </span>
                                  {prop.listing_type && (
                                    <span className="bg-primary/10 text-primary border-primary/20 rounded border px-1 py-0 text-[9px] font-semibold uppercase">
                                      {prop.listing_type}
                                    </span>
                                  )}
                                </div>
                                <h6 className="mb-1 text-xs leading-snug font-bold text-white">
                                  {prop.title}
                                </h6>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                  {prop.area_sqft && (
                                    <div className="text-slate-400">
                                      <span className="text-slate-500">
                                        Area:
                                      </span>{' '}
                                      {prop.area_sqft}{' '}
                                      {prop.area_unit || 'sqft'}
                                    </div>
                                  )}
                                  {prop.bedrooms != null && (
                                    <div className="text-slate-400">
                                      <span className="text-slate-500">
                                        Beds:
                                      </span>{' '}
                                      {prop.bedrooms}
                                    </div>
                                  )}
                                  {prop.bathrooms != null && (
                                    <div className="text-slate-400">
                                      <span className="text-slate-500">
                                        Baths:
                                      </span>{' '}
                                      {prop.bathrooms}
                                    </div>
                                  )}
                                  {prop.facing_direction && (
                                    <div className="text-slate-400">
                                      <span className="text-slate-500">
                                        Facing:
                                      </span>{' '}
                                      {prop.facing_direction}
                                    </div>
                                  )}
                                </div>
                                <p className="mt-1.5 truncate text-[10px] text-slate-400">
                                  📍 {prop.location}
                                  {prop.sublocality
                                    ? `, ${prop.sublocality}`
                                    : ''}
                                </p>
                                <div className="mt-1.5 flex items-center gap-2 border-t border-slate-800 pt-1.5">
                                  <span className="text-primary text-xs font-bold">
                                    {prop.price >= 10000000
                                      ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                      : prop.price >= 100000
                                        ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                        : `₹${prop.price.toLocaleString('en-IN')}`}
                                  </span>
                                  <span className="rounded border border-slate-700 bg-slate-800 px-1 py-0 text-[9px] text-slate-300 uppercase">
                                    {prop.status}
                                  </span>
                                </div>
                              </div>
                            );
                            return createPortal(el, document.body);
                          })()}
                      </div>
                      {showReferrerSuggestions &&
                        filteredReferrerContacts.length > 0 && (
                          <div className="absolute z-50 mt-1 max-h-48 w-full space-y-0.5 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-lg">
                            <div className="mb-1 border-b border-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-500">
                              Link to existing contact:
                            </div>
                            {filteredReferrerContacts.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onMouseDown={() => {
                                  setEditReferrer(c.name || 'Unnamed');
                                  setEditReferrerContactId(c.id);
                                  setShowReferrerSuggestions(false);
                                }}
                                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold">
                                    {contactFullName(c) || 'Unnamed'}
                                  </span>
                                  <NameTagBadge tag={c.name_tag} />
                                  <span className="ml-1.5 text-[10px] text-slate-400">
                                    ({c.phone})
                                  </span>
                                </div>
                                <span className="rounded bg-slate-800 px-1 py-0.5 text-[10px] font-bold text-slate-400">
                                  {c.classification}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                    </div>
                    {contactId && (
                      <PartyPanel
                        contactId={contactId}
                        contacts={contactsList}
                        canEdit={canEditContacts}
                      />
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        Classification
                      </Label>
                      <select
                        value={editClassification}
                        onChange={(e) =>
                          setEditClassification(
                            e.target.value as
                              | 'Owner'
                              | 'Seller'
                              | 'Buyer'
                              | 'Agent'
                              | 'Developer'
                              | 'Owner & Buyer'
                              | 'Others'
                          )
                        }
                        className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        <option value="Others">Others</option>
                        <option value="Owner">Owner</option>
                        <option value="Seller">Seller</option>
                        <option value="Buyer">Buyer</option>
                        <option value="Agent">Agent</option>
                        <option value="Developer">Developer</option>
                        <option value="Owner & Buyer">Owner & Buyer</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">Source</Label>
                      <select
                        value={editSource}
                        onChange={(e) => setEditSource(e.target.value)}
                        className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        <option value="">Select Source</option>
                        <option value="Magic Bricks">Magic Bricks</option>
                        <option value="Housing">Housing</option>
                        <option value="99acres">99acres</option>
                        <option value="Facebook">Facebook</option>
                        <option value="Instagram">Instagram</option>
                        <option value="Reference">Reference</option>
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Others">Others</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        Lead Temperature / Status
                      </Label>
                      <select
                        value={editLeadTemp}
                        onChange={(e) =>
                          setEditLeadTemp(
                            e.target.value as
                              | 'HOT'
                              | 'COLD'
                              | 'Not Responding'
                              | 'Dead'
                              | ''
                          )
                        }
                        className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        <option value="">None</option>
                        <option value="HOT">🔥 HOT</option>
                        <option value="COLD">❄️ COLD</option>
                        <option value="Not Responding">
                          ⏳ Not Responding
                        </option>
                        <option value="Dead">💀 Dead</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        Preferred Language
                      </Label>
                      <select
                        value={editPreferredLanguage}
                        onChange={(e) =>
                          setEditPreferredLanguage(
                            e.target.value as LanguageCode | ''
                          )
                        }
                        className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        <option value="">Use account default</option>
                        {LANGUAGE_CODES.map((code) => (
                          <option key={code} value={code}>
                            {languageDisplay(code)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">
                        Date of Birth
                      </Label>
                      <div className="space-y-1">
                        <Input
                          type="date"
                          value={editDob}
                          onChange={(e) => setEditDob(e.target.value)}
                          className="focus:border-primary h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                        />
                        {editDob &&
                          (() => {
                            const today = new Date();
                            const dobDate = new Date(editDob);
                            const isBirthdayToday =
                              today.getDate() === dobDate.getDate() &&
                              today.getMonth() === dobDate.getMonth();
                            if (isBirthdayToday) {
                              return (
                                <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                                  🎂 Today is their birthday!
                                </p>
                              );
                            }
                            return null;
                          })()}
                      </div>
                    </div>

                    {deals.some((d) => d.status === 'won') && (
                      <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                        <Label className="text-xs font-semibold text-slate-400">
                          Feedback &amp; Review
                        </Label>
                        <select
                          value={editFeedbackStatus}
                          onChange={(e) =>
                            setEditFeedbackStatus(
                              e.target.value as
                                | 'not_requested'
                                | 'requested'
                                | 'collected'
                            )
                          }
                          className="focus:border-primary mt-1 h-8 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none"
                        >
                          <option value="not_requested">Not Requested</option>
                          <option value="requested">Requested</option>
                          <option value="collected">Collected</option>
                        </select>
                        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                          This contact has transacted successfully. Collect
                          feedback or review to post on your showcase page.
                        </p>
                      </div>
                    )}

                    {editClassification !== 'Owner' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-400">
                          Shown Interest / Inquired Property
                        </Label>
                        <SearchablePropertySelect
                          properties={allProperties}
                          value={editLastInquiredPropertyId}
                          onChange={setEditLastInquiredPropertyId}
                          placeholder="Select inquired property..."
                        />
                      </div>
                    )}
                    {editClassification === 'Agent' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-400">
                          Agent Requirements
                        </Label>
                        <Textarea
                          value={editRequirements}
                          onChange={(e) => setEditRequirements(e.target.value)}
                          placeholder="Enter agent requirements, focus areas, or client requests..."
                          className="min-h-[100px] resize-y border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                        />
                      </div>
                    )}
                    {inquiredProperty &&
                      contact?.status !== 'pending_review' && (
                        <div className="border-slate-850/60 mb-4 space-y-2 rounded-lg border bg-slate-950/20 p-3 text-xs">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <span className="block text-[9px] font-bold tracking-wider text-slate-500 uppercase">
                                Inquired Property
                              </span>
                              <span className="text-xs font-bold text-white">
                                {inquiredProperty.title}
                              </span>
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={handleSendPropertyDetails}
                                disabled={approving}
                                className="text-slate-350 flex h-6 cursor-pointer items-center gap-1 border-slate-800 bg-slate-900 px-2 py-0 text-[10px]"
                              >
                                <MessageSquare className="size-3 fill-green-500 text-green-500" />
                                Send Free-text
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  setShareProperty(inquiredProperty)
                                }
                                disabled={approving}
                                className="text-slate-350 flex h-6 cursor-pointer items-center gap-1 border-slate-800 bg-slate-900 px-2 py-0 text-[10px]"
                              >
                                <Share2 className="text-primary size-3" />
                                Send Template
                              </Button>
                            </div>
                          </div>
                          {!isLocationGuarded(inquiredProperty) ||
                          canViewGuardedLocations ||
                          inquiredProperty.user_id === user?.id ? (
                            <div className="grid grid-cols-1 gap-1.5 border-t border-slate-800/40 pt-1.5 text-[10px] text-slate-400">
                              <div>
                                <span className="text-slate-500">
                                  Exact Location:{' '}
                                </span>
                                <span className="text-slate-300">
                                  {inquiredProperty.location}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">
                                  Google Map Link:{' '}
                                </span>
                                {inquiredProperty.google_map_link ? (
                                  <a
                                    href={inquiredProperty.google_map_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary block max-w-xs truncate hover:underline"
                                  >
                                    {inquiredProperty.google_map_link}
                                  </a>
                                ) : (
                                  <span className="text-slate-500 italic">
                                    No link configured
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="border-t border-slate-800/40 pt-1.5 text-[10px] text-amber-400/90">
                              Exact location restricted — visible to admins and
                              the listing agent only.
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </div>

                {/* Sticky save footer — always visible while editing */}
                <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-2.5">
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </TabsContent>

              {/* Requirements Tab */}
              {collectsBuyerRequirements && contact && (
                <TabsContent
                  value="requirements"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <ContactRequirementsDialog
                    embedded
                    open
                    onOpenChange={() => setActiveTab('details')}
                    contact={contact}
                    onChanged={() => {
                      fetchContact();
                      onUpdated();
                    }}
                  />
                  <details className="group shrink-0 border-t border-slate-800 bg-slate-900/80">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-200 [&::-webkit-details-marker]:hidden">
                      <span>Advanced matching options</span>
                      <span className="text-[10px] font-normal text-slate-500 group-open:hidden">
                        Budget, ROI, areas and property type
                      </span>
                    </summary>
                    <div className="max-h-72 space-y-3 overflow-y-auto px-4 pb-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-xs font-semibold text-slate-400">
                            Budget Range (INR)
                          </Label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400 select-none">
                            <input
                              type="checkbox"
                              checked={editNoBudget}
                              onChange={(event) => {
                                setEditNoBudget(event.target.checked);
                                if (event.target.checked) {
                                  setEditMinBudget('');
                                  setEditMaxBudget('');
                                }
                              }}
                              className="text-primary size-3.5 rounded border-slate-700 bg-slate-800"
                            />
                            No budget limit
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Input
                              type="number"
                              disabled={editNoBudget}
                              value={editMinBudget}
                              onChange={(event) =>
                                setEditMinBudget(event.target.value)
                              }
                              placeholder="Min budget"
                              className="h-8 border-slate-700 bg-slate-800 text-xs text-white disabled:opacity-40"
                            />
                            <PriceHint
                              value={editMinBudget}
                              compact
                              className="block text-[10px]"
                            />
                          </div>
                          <div>
                            <Input
                              type="number"
                              disabled={editNoBudget}
                              value={editMaxBudget}
                              onChange={(event) =>
                                setEditMaxBudget(event.target.value)
                              }
                              placeholder="Max budget"
                              className="h-8 border-slate-700 bg-slate-800 text-xs text-white disabled:opacity-40"
                            />
                            <PriceHint
                              value={editMaxBudget}
                              compact
                              className="block text-[10px]"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-400">
                          Expected minimum ROI (%)
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editMinRoi}
                          onChange={(event) =>
                            setEditMinRoi(event.target.value)
                          }
                          placeholder="e.g. 4.5"
                          className="h-8 border-slate-700 bg-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-400">
                          Areas of interest
                        </Label>
                        <AreasOfInterestInput
                          areasText={editAreasText}
                          areasOfInterest={editAreasOfInterest}
                          onChange={(text, areas) => {
                            setEditAreasText(text);
                            setEditAreasOfInterest(areas);
                          }}
                          onPickGeo={(geo) =>
                            setEditAreasGeo((current) => [
                              ...current.filter(
                                (item) =>
                                  item.name.toLowerCase() !==
                                  geo.name.toLowerCase()
                              ),
                              geo,
                            ])
                          }
                        />
                        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400 select-none">
                          <input
                            type="checkbox"
                            checked={editStrictAreaMatch}
                            onChange={(event) =>
                              setEditStrictAreaMatch(event.target.checked)
                            }
                            className="text-primary size-3.5 rounded border-slate-700 bg-slate-800"
                          />
                          Strict area match (5 km instead of 20 km)
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-400">
                          Projects of interest
                        </Label>
                        <ProjectsOfInterestInput
                          projectsText={editProjectsText}
                          projects={editProjectsOfInterest}
                          strict={editStrictProjectMatch}
                          onChange={(text, projects) => {
                            setEditProjectsText(text);
                            setEditProjectsOfInterest(projects);
                          }}
                          onStrictChange={setEditStrictProjectMatch}
                          idPrefix="contact-requirements"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-400">
                          Property categories
                        </Label>
                        <div className="grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
                          {PROPERTY_INTEREST_OPTIONS.map((option) => (
                            <label
                              key={option}
                              className="flex cursor-pointer items-start gap-2 text-xs text-slate-300 select-none"
                            >
                              <input
                                type="checkbox"
                                checked={editPropertyInterests.includes(option)}
                                onChange={(event) =>
                                  setEditPropertyInterests((current) =>
                                    event.target.checked
                                      ? [...current, option]
                                      : current.filter(
                                          (item) => item !== option
                                        )
                                  )
                                }
                                className="text-primary mt-0.5 size-3.5 rounded border-slate-700 bg-slate-800"
                              />
                              {option}
                            </label>
                          ))}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        onClick={savePreferences}
                        disabled={savingPreferences}
                        className="w-full"
                      >
                        {savingPreferences ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        Save advanced options
                      </Button>
                    </div>
                  </details>
                </TabsContent>
              )}

              {/* Properties Tab (Owner / Seller / Agent / Buyer / Owner & Buyer) */}
              {[
                'Owner',
                'Seller',
                'Agent',
                'Developer',
                'Buyer',
                'Owner & Buyer',
              ].includes(editClassification) && (
                <TabsContent
                  value="properties"
                  className="h-full min-h-0 flex-1"
                >
                  <div className="flex h-full min-h-0 flex-col px-4 py-3">
                    {['Buyer', 'Agent', 'Owner & Buyer'].includes(
                      editClassification
                    ) ? (
                      // Shown Interest Properties Layout (also shown for Owner & Buyer)
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="mb-4 flex shrink-0 flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <Label
                            htmlFor="detail-interest-property"
                            className="text-slate-350 text-xs font-semibold"
                          >
                            Assign Shown Interest / Inquired Property
                          </Label>
                          <SearchablePropertySelect
                            properties={allProperties}
                            value={editLastInquiredPropertyId}
                            onChange={handleLinkInterestProperty}
                            placeholder="No Property Selected"
                          />
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            Linking a property associates this contact as an
                            Interested Lead for that listing.
                          </p>
                        </div>

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                          <h4 className="mb-2 text-xs font-semibold text-slate-400">
                            Interested Properties ({inquiredProperties.length})
                          </h4>
                          {inquiredProperties.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 py-8 text-center">
                              <Building className="mx-auto mb-2 size-8 text-slate-700 opacity-50" />
                              <p className="mx-auto max-w-[240px] text-xs text-slate-500">
                                No inquiry or interest property is currently
                                assigned. Select a property above to assign
                                interest.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {inquiredProperties.map((prop) => (
                                <div
                                  key={prop.id}
                                  className="bg-slate-850/60 rounded-lg border border-slate-800 p-3 transition-all duration-200 hover:border-slate-700/80"
                                  onMouseEnter={(e) => {
                                    const rect = (
                                      e.currentTarget as HTMLElement
                                    ).getBoundingClientRect();
                                    setHoveredPropId(prop.id);
                                    setHoverPos({
                                      top: rect.bottom + 4,
                                      left: rect.left,
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPropId(null);
                                    setHoverPos(null);
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <span className="py-0.2 mb-1.5 inline-block rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 text-[9px] font-bold tracking-wider text-emerald-400 uppercase">
                                        SHOWN INTEREST
                                      </span>
                                      <h5 className="truncate text-xs font-semibold text-white">
                                        {prop.property_code
                                          ? `[${prop.property_code}] `
                                          : ''}
                                        {prop.title}
                                      </h5>
                                      <p className="mt-0.5 truncate text-[10px] text-slate-400">
                                        {prop.location}
                                      </p>
                                      <div className="mt-1.5 flex items-center gap-2">
                                        <span className="text-primary text-[10px] font-bold">
                                          {prop.price >= 10000000
                                            ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                            : prop.price >= 100000
                                              ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                              : `₹${prop.price.toLocaleString('en-IN')}`}
                                        </span>
                                        <span className="py-0.2 rounded border border-slate-700 bg-slate-800 px-1.5 text-[9px] font-semibold text-slate-300 uppercase">
                                          {prop.status}
                                        </span>
                                        {propertyMessageStatus[prop.id]
                                          ?.sent && (
                                          <span className="py-0.2 rounded border border-blue-500/25 bg-blue-500/10 px-1.5 text-[9px] font-semibold text-blue-400">
                                            Sent{' '}
                                            {propertyMessageStatus[prop.id]
                                              .lastSentAt &&
                                              new Date(
                                                propertyMessageStatus[prop.id]
                                                  .lastSentAt!
                                              ).toLocaleDateString('en-IN', {
                                                day: '2-digit',
                                                month: 'short',
                                              })}
                                          </span>
                                        )}
                                        {propertyMessageStatus[prop.id]
                                          ?.responded && (
                                          <span className="py-0.2 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 text-[9px] font-semibold text-emerald-400">
                                            Responded
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setShareProperty(prop)}
                                        className="hover:text-primary h-7 w-7 p-0 text-slate-400 hover:bg-slate-800"
                                        title={`Send these details to ${contact?.name || contact?.phone || 'this contact'}`}
                                      >
                                        <Share2 className="size-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          handleRemoveInquiredProperty(prop.id)
                                        }
                                        className="h-7 w-7 p-0 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                                        title="Remove interest link"
                                      >
                                        <Unlink className="size-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Shared Properties Section */}
                          <div className="mt-4 border-t border-slate-800/60 pt-4">
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                              <Share2 className="text-primary size-3.5" />
                              Shared Properties
                            </h4>
                            {loadingSharedProperties ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="size-4 animate-spin text-slate-500" />
                              </div>
                            ) : sharedProperties.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/10 py-6 text-center">
                                <p className="mx-auto max-w-[220px] text-[10px] text-slate-500">
                                  No properties have been shared with this
                                  contact via WhatsApp yet.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {sharedProperties.map((prop) => (
                                  <div
                                    key={prop.id}
                                    className="bg-slate-850/40 border-slate-850 rounded-lg border p-3 transition-all duration-205 hover:border-slate-700/60"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <h5 className="truncate text-xs font-semibold text-white">
                                          {prop.property_code
                                            ? `[${prop.property_code}] `
                                            : ''}
                                          {prop.title}
                                        </h5>
                                        <p className="text-slate-450 mt-0.5 truncate text-[10px]">
                                          {prop.location}
                                        </p>
                                        <div className="mt-1.5 flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="text-primary text-[10px] font-bold">
                                              {prop.price >= 10000000
                                                ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                                : prop.price >= 100000
                                                  ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                                  : `₹${prop.price.toLocaleString('en-IN')}`}
                                            </span>
                                            <span className="py-0.2 text-slate-350 rounded border border-slate-700 bg-slate-800 px-1.5 text-[9px] font-semibold uppercase">
                                              {prop.status}
                                            </span>
                                          </div>
                                          <span className="text-[9px] text-slate-500">
                                            Shared:{' '}
                                            {new Date(
                                              prop.sharedAt
                                            ).toLocaleDateString('en-IN', {
                                              day: '2-digit',
                                              month: 'short',
                                              year: '2-digit',
                                            })}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {['Owner', 'Seller', 'Developer', 'Owner & Buyer'].includes(
                      editClassification
                    ) && (
                      // Managed Properties Layout (for Owner / Seller / Developer / Owner & Buyer)
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="mb-3 flex shrink-0 items-center justify-between">
                          <h4 className="text-xs font-semibold text-slate-300">
                            Managed Properties
                          </h4>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLinkExistingOpen(!linkExistingOpen)
                              }
                              className="flex h-7 cursor-pointer items-center gap-1 border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800"
                            >
                              <Link className="size-3" />
                              Link Existing
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedPropertyForEdit(null);
                                setPropertyFormOpen(true);
                              }}
                              className="bg-primary hover:bg-primary/90 text-primary-foreground flex h-7 cursor-pointer items-center gap-1 text-xs font-bold"
                            >
                              <Plus className="size-3" />
                              Add Property
                            </Button>
                          </div>
                        </div>

                        {linkExistingOpen && (
                          <div className="mb-3 shrink-0 space-y-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                            <Label className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                              Link an existing property to this contact
                            </Label>
                            <SearchablePropertySelect
                              properties={allProperties.filter(
                                (p) =>
                                  !associatedProperties.some(
                                    (ap) => ap.id === p.id
                                  )
                              )}
                              value={null}
                              onChange={handleLinkExistingProperty}
                              placeholder="Search properties to link..."
                            />
                          </div>
                        )}

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                          {loadingProperties ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="size-5 animate-spin text-slate-500" />
                            </div>
                          ) : associatedProperties.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 py-8 text-center">
                              <Building className="mx-auto mb-2 size-8 text-slate-600 opacity-55" />
                              <p className="mx-auto max-w-[240px] text-xs text-slate-400">
                                No properties associated with this contact. Add
                                one to display it here.
                              </p>
                            </div>
                          ) : (
                            associatedProperties.map((prop) => (
                              <div
                                key={prop.id}
                                className="bg-slate-850/60 rounded-lg border border-slate-800 p-3 transition-all duration-200 hover:border-slate-700/80"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h5 className="truncate text-xs font-semibold text-white">
                                      {prop.title}
                                    </h5>
                                    <p className="mt-0.5 truncate text-[10px] text-slate-400">
                                      {prop.location}
                                    </p>
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <span className="text-primary text-[10px] font-bold">
                                        {prop.price >= 10000000
                                          ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                          : prop.price >= 100000
                                            ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                            : `₹${prop.price.toLocaleString('en-IN')}`}
                                      </span>
                                      <span className="py-0.2 rounded border border-slate-700 bg-slate-800 px-1.5 text-[9px] font-semibold text-slate-300 uppercase">
                                        {prop.status}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setSelectedPropertyForEdit(prop);
                                        setPropertyFormOpen(true);
                                      }}
                                      className="h-7 w-7 p-0 text-slate-400 hover:bg-slate-800 hover:text-white"
                                    >
                                      <Edit className="size-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        handleUnlinkProperty(prop.id)
                                      }
                                      className="h-7 w-7 p-0 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                                      title="Unlink from contact"
                                    >
                                      <Unlink className="size-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}

              {/* Tags Tab */}
              <TabsContent
                value="tags"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Click a tag to add or remove it from this contact.
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No tags available. Create tags in Settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {orderedTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                              selected
                                ? 'ring-primary ring-2 ring-offset-1 ring-offset-slate-900'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="mr-1 size-3" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="h-full min-h-0 flex-1">
                <div className="flex h-full min-h-0 flex-col px-4 py-3">
                  <div className="mb-3 space-y-2">
                    <Textarea
                      data-testid="contact-note-input"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Write a note..."
                      className="min-h-[60px] resize-none border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                    />
                    <Button
                      data-testid="contact-note-submit"
                      onClick={addNote}
                      disabled={!newNote.trim() || savingNote}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      size="sm"
                    >
                      {savingNote ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      Add Note
                    </Button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-slate-500" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">
                        No notes yet.
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="group rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="flex-1 text-sm whitespace-pre-wrap text-slate-300">
                              {note.note_text}
                            </p>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="shrink-0 cursor-pointer text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <p className="mt-1.5 text-xs text-slate-500">
                            {new Date(note.created_at).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent
                value="deals"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="text-primary size-5 animate-spin" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-slate-500">No deals yet</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            {createElement(
                              getCurrencyIcon(deal.currency || currency),
                              { className: 'size-3' }
                            )}
                            {(() => {
                              const activeCurrency = deal.currency || currency;
                              if (activeCurrency === 'INR') {
                                const val = Number(deal.value || 0);
                                if (val >= 10000000) {
                                  return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
                                } else if (val >= 100000) {
                                  return `₹${(val / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
                                }
                                return new Intl.NumberFormat('en-IN', {
                                  style: 'currency',
                                  currency: 'INR',
                                  maximumFractionDigits: 0,
                                }).format(val);
                              }
                              return new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: activeCurrency,
                                maximumFractionDigits: 0,
                              }).format(Number(deal.value || 0));
                            })()}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Calls Tab */}
              <TabsContent value="calls" className="h-full min-h-0 flex-1">
                {/* The whole tab scrolls: on small screens the two form
                  panels fill the viewport, so a nested-scroll history
                  list would end up with zero height and the AI update
                  draft below them would be unreachable. */}
                <div className="h-full overflow-y-auto px-4 py-3">
                  {/* AI call analysis */}
                  {contactId && (
                    <CallRecordingAnalyzer
                      contactId={contactId}
                      contactName={contact?.name || ''}
                      onAnalyzed={() => {
                        void fetchCalls().then(() => {
                          callHistoryRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                        });
                      }}
                    />
                  )}

                  {/* Log a call form */}
                  <div className="mb-3 space-y-3 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3">
                    <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      Log a call
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                      {/* Direction */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">
                          Direction
                        </label>
                        <select
                          value={callForm.direction}
                          onChange={(e) =>
                            setCallForm((f) => ({
                              ...f,
                              direction: e.target.value as CallDirection,
                            }))
                          }
                          className="focus:ring-primary w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:ring-1 focus:outline-none"
                        >
                          <option value="outbound">Outbound</option>
                          <option value="inbound">Inbound</option>
                        </select>
                      </div>

                      {/* Outcome */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">
                          Outcome
                        </label>
                        <select
                          value={callForm.outcome}
                          onChange={(e) =>
                            setCallForm((f) => ({
                              ...f,
                              outcome: e.target.value as CallOutcome,
                            }))
                          }
                          className="focus:ring-primary w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:ring-1 focus:outline-none"
                        >
                          <option value="connected">Connected</option>
                          <option value="no_answer">No Answer</option>
                          <option value="busy">Busy</option>
                          <option value="voicemail">Voicemail</option>
                          <option value="wrong_number">Wrong Number</option>
                          <option value="callback_requested">
                            Callback Requested
                          </option>
                        </select>
                      </div>

                      {/* Date/time */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">
                          Date & time
                        </label>
                        <input
                          type="datetime-local"
                          value={callForm.called_at}
                          onChange={(e) =>
                            setCallForm((f) => ({
                              ...f,
                              called_at: e.target.value,
                            }))
                          }
                          className="focus:ring-primary w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:ring-1 focus:outline-none"
                        />
                      </div>

                      {/* Duration */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">
                          Duration (mins)
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="e.g. 5"
                          value={callForm.duration_seconds}
                          onChange={(e) =>
                            setCallForm((f) => ({
                              ...f,
                              duration_seconds: e.target.value,
                            }))
                          }
                          className="focus:ring-primary w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white placeholder:text-slate-600 focus:ring-1 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <Textarea
                      value={callForm.notes}
                      onChange={(e) =>
                        setCallForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      placeholder="Call notes (what was discussed, next steps…)"
                      className="min-h-[50px] resize-none border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                    />

                    <Button
                      size="sm"
                      disabled={savingCall}
                      onClick={async () => {
                        if (!contactId) return;
                        setSavingCall(true);
                        try {
                          const durationMins = callForm.duration_seconds
                            ? parseFloat(callForm.duration_seconds)
                            : null;
                          const res = await fetch(
                            `/api/contacts/${contactId}/calls`,
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                direction: callForm.direction,
                                outcome: callForm.outcome,
                                called_at: callForm.called_at
                                  ? new Date(callForm.called_at).toISOString()
                                  : new Date().toISOString(),
                                duration_seconds:
                                  durationMins != null
                                    ? Math.round(durationMins * 60)
                                    : null,
                                notes: callForm.notes || null,
                              }),
                            }
                          );
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error || 'Failed to save');
                          }
                          toast.success('Call logged');
                          setCallForm({
                            direction: 'outbound',
                            outcome: 'connected',
                            duration_seconds: '',
                            notes: '',
                            called_at: new Date().toISOString().slice(0, 16),
                          });
                          fetchCalls();
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : 'Failed to log call'
                          );
                        } finally {
                          setSavingCall(false);
                        }
                      }}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {savingCall ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <PhoneCall className="size-3.5" />
                      )}
                      Log Call
                    </Button>
                  </div>

                  {/* Call history list */}
                  <div ref={callHistoryRef} className="scroll-mt-3 space-y-2">
                    {loadingCalls ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-slate-500" />
                      </div>
                    ) : calls.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">
                        No calls logged yet.
                      </p>
                    ) : (
                      calls.map((call) => {
                        const isConnected = call.outcome === 'connected';
                        const isMissed = [
                          'no_answer',
                          'busy',
                          'voicemail',
                        ].includes(call.outcome);
                        const OutcomeIcon =
                          call.direction === 'inbound'
                            ? PhoneIncoming
                            : isMissed
                              ? PhoneMissed
                              : PhoneCall;
                        const iconColor = isConnected
                          ? 'text-emerald-400'
                          : isMissed
                            ? 'text-red-400'
                            : 'text-amber-400';
                        const outcomeLabel: Record<string, string> = {
                          connected: 'Connected',
                          no_answer: 'No Answer',
                          busy: 'Busy',
                          voicemail: 'Voicemail',
                          wrong_number: 'Wrong Number',
                          callback_requested: 'Callback Requested',
                        };

                        return (
                          <div
                            key={call.id}
                            className="group rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                          >
                            <div className="flex items-start gap-2.5">
                              <div className={`mt-0.5 shrink-0 ${iconColor}`}>
                                <OutcomeIcon className="size-3.5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-white capitalize">
                                    {call.direction} ·{' '}
                                    {outcomeLabel[call.outcome]}
                                  </span>
                                  {call.duration_seconds != null && (
                                    <span className="flex items-center gap-1 text-xs text-slate-400">
                                      <Clock className="size-3" />
                                      {call.duration_seconds < 60
                                        ? `${call.duration_seconds}s`
                                        : `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`}
                                    </span>
                                  )}
                                </div>
                                {call.notes && (
                                  <p className="mt-1 text-xs whitespace-pre-wrap text-slate-400">
                                    {call.notes}
                                  </p>
                                )}
                                <p className="mt-1 text-xs text-slate-500">
                                  {new Date(call.called_at).toLocaleDateString(
                                    'en-IN',
                                    {
                                      day: 'numeric',
                                      month: 'short',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    }
                                  )}
                                </p>
                                {contactId && (
                                  <CallAnalysisSection
                                    key={`${call.id}-${call.update_draft ?? ''}`}
                                    contactId={contactId}
                                    call={call}
                                    contactName={contact?.name || ''}
                                    contactPhone={contact?.phone || ''}
                                    onUpdated={fetchCalls}
                                  />
                                )}
                              </div>
                              <button
                                onClick={async () => {
                                  if (!contactId) return;
                                  await fetch(
                                    `/api/contacts/${contactId}/calls/${call.id}`,
                                    { method: 'DELETE' }
                                  );
                                  fetchCalls();
                                }}
                                className="mt-0.5 shrink-0 cursor-pointer text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                                aria-label="Delete call log"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Property Form Modal */}
            <PropertyForm
              open={propertyFormOpen}
              onOpenChange={setPropertyFormOpen}
              property={selectedPropertyForEdit}
              defaultOwnerId={contactId}
              onSaved={() => {
                fetchAssociatedProperties();
                onUpdated();
              }}
            />

            {/* Schedule Dialog */}
            <ScheduleDialog
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              contactId={contactId}
            />

            {/* Property Share Dialog */}
            {shareProperty && (
              <PropertyShareDialog
                open={shareProperty !== null}
                onOpenChange={(next) => {
                  if (!next) setShareProperty(null);
                }}
                property={shareProperty}
                preSelectedContactId={contactId || undefined}
              />
            )}

            {/* Log External Share Dialog */}
            {contactId && contact && hasPhone(contact) && (
              <LogExternalShareDialog
                open={logShareOpen}
                onOpenChange={setLogShareOpen}
                contactId={contactId}
                contactName={contact.name || ''}
                contactPhone={contact.phone}
                properties={allProperties}
                onSaved={() => {
                  fetchContact();
                  fetchNotes();
                  onUpdated();
                }}
              />
            )}
            {/* Log-on-dial prompt */}
            <LogCallPrompt
              dial={pendingDial}
              onOpenChange={(next) => {
                if (!next) setPendingDial(null);
              }}
              onLogged={() => {
                fetchCalls();
                fetchContact();
                onUpdated();
              }}
            />
            {/* Move to Engine WhatsApp Dialog */}
            {contact && hasPhone(contact) && (
              <MoveToEngineDialog
                open={moveToEngineOpen}
                onOpenChange={setMoveToEngineOpen}
                contactName={contact.name || ''}
                contactPhone={contact.phone}
              />
            )}
            {contactId &&
              contact &&
              hasPhone(contact) &&
              !collectsBuyerRequirements && (
                <OwnerDetailsRequestDialog
                  open={detailsRequestOpen}
                  onOpenChange={setDetailsRequestOpen}
                  contactId={contactId}
                  contactName={contact.name || ''}
                  contactPhone={contact.phone}
                  properties={associatedProperties}
                />
              )}
            {/* Greetings Generator Dialog */}
            {contactId && contact && hasPhone(contact) && (
              <GreetingsGeneratorDialog
                open={greetingsOpen}
                onOpenChange={setGreetingsOpen}
                contactId={contactId}
                contactName={contact.name || ''}
                contactPhone={contact.phone}
              />
            )}
            {contactId &&
              contact &&
              hasPhone(contact) &&
              contact.classification === 'Agent' && (
                <ShareInventoryDialog
                  open={inventoryShareOpen}
                  onOpenChange={setInventoryShareOpen}
                  contactId={contactId}
                  contactName={contact.name || ''}
                  contactPhone={contact.phone}
                  properties={allProperties}
                  showcaseBaseUrl={getShowcaseBaseUrl()}
                />
              )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
