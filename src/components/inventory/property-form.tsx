'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import NextImage from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { resolveConversation } from '@/lib/conversations/resolve';
import { storagePublicUrl } from '@/lib/storage/url';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import { toast } from 'sonner';
import type { Property } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { PriceHint } from '@/components/ui/price-hint';
import {
  Loader2,
  Send,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  ExternalLink,
  Lock,
  Compass,
  CheckCircle2,
  Edit,
  Building,
  FileText,
  Ruler,
  Layers,
  ShieldCheck,
  CirclePlay,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { haversineKm } from '@/lib/geo';
import { extractCoordinatesFromMapUrl } from '@/lib/maps/map-links';
import {
  getMatchingContacts,
  inMatchAudience,
  type MatchAudience,
} from '@/lib/matching';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { LearningPanel } from '@/components/inventory/learning-panel';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { formatCurrency } from '@/lib/currency-utils';
import { formatAuditDateTime } from '@/lib/audit-timestamps';
import { useTopupModal } from '@/components/layout/topup-modal-context';
import type { Contact } from '@/types';
import {
  POPULAR_PROJECTS,
  POPULAR_SUBLOCALITIES,
} from '@/lib/data/real-estate-data';
import {
  SQFT_PER_AREA_UNIT,
  hasBedsBaths as typeHasBedsBaths,
  hasCommercialFields as typeHasCommercialFields,
  hasCommercialBuildingFields as typeHasCommercialBuildingFields,
  hasTotalFloors,
  hasUnitFloor,
  isLandType,
  isRawLandType,
  isApartmentType,
} from '@/lib/inventory/property-options';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import {
  E_KHATA_MAX_BYTES,
  eKhataChanges,
  eKhataNotes,
  isEKhataMimeType,
  type EKhataChange,
  type EKhataChangeKey,
  type EKhataFields,
} from '@/lib/inventory/e-khata-fields';
import { EKhataReviewDialog } from '@/components/inventory/e-khata-review-dialog';
import { PropertyFormSectionNav } from '@/components/inventory/property-form-section-nav';
import { PropertyMatchesTab } from '@/components/inventory/property-matches-tab';
import { PropertyEnquiriesTab } from '@/components/inventory/property-enquiries-tab';
import { ShareDocumentsDialog } from '@/components/inventory/share-documents-dialog';
import { PropertyRequestsPanels } from '@/components/inventory/property-requests-panels';
import { propertyFormSections } from '@/lib/inventory/property-form-sections';
import {
  buildPropertyPayload,
  emptyPropertyFormValues,
  propertyToFormValues,
  validatePropertyForm,
} from '@/lib/inventory/property-form-state';
import { usePropertyForm } from '@/hooks/usePropertyForm';
import { BasicsSection } from '@/components/inventory/property-form/basics-section';
import {
  LocationSection,
  type AutoCompleteProject,
} from '@/components/inventory/property-form/location-section';
import { TenancySection } from '@/components/inventory/property-form/tenancy-section';
import { SpecsSection } from '@/components/inventory/property-form/specs-section';
import { MediaSection } from '@/components/inventory/property-form/media-section';
import { DescriptionSection } from '@/components/inventory/property-form/description-section';
import { OwnerSection } from '@/components/inventory/property-form/owner-section';
import { compressImageOnClient } from '@/components/inventory/property-form/client-image';
import { isPlanPdf, PLAN_IMAGE_MIME_TYPES } from '@/lib/inventory/floor-plans';
import {
  isGuardedType,
  isLocationGuarded,
} from '@/lib/inventory/location-guard';
import { rentalYieldPercent } from '@/lib/inventory/rental-yield';
import { contactHandle, hasPhone } from '@/lib/contacts/reachability';
import { propertyAvailabilityWhatsAppUrl } from '@/lib/inventory/availability-check';
import {
  enquiredAudienceContacts,
  type AudienceContact,
} from '@/lib/inventory/listing-audience';

interface PropertyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
  defaultOwnerId?: string | null;
  onSaved: () => void;
  viewOnly?: boolean;
  initialTab?: 'details' | 'matches';
}

interface PropertyDuplicateCandidate {
  id: string;
  property_code?: string | null;
  title: string;
  location?: string | null;
  distanceMeters: number;
  confidence: 'high' | 'possible' | 'nearby';
  score: number;
  signals: string[];
}

export function PropertyForm({
  open,
  onOpenChange,
  property,
  defaultOwnerId = null,
  onSaved,
  viewOnly = false,
  initialTab = 'details',
}: PropertyFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const { openTopupModal } = useTopupModal();
  const isEdit = !!property;
  const eKhataInputRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState(viewOnly);
  const [duplicateCandidates, setDuplicateCandidates] = useState<
    PropertyDuplicateCandidate[]
  >([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const galleryTouchXRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setViewMode(viewOnly);
      setActiveImageIndex(0);
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
    }
  }, [open, viewOnly, property]);

  const { values, set, reset } = usePropertyForm(defaultOwnerId);
  const {
    title,
    description,
    price,
    listingType,
    rentPerMonth,
    maintenance,
    advance,
    gst,
    jvStructure,
    ownerSharePercent,
    builderSharePercent,
    goodwillAmount,
    btsLeaseYears,
    btsLockInYears,
    type,
    status,
    bedrooms,
    bathrooms,
    areaSqft,
    areaUnit,
    landArea,
    landAreaUnit,
    superBuiltArea,
    frontage,
    depth,
    sublocality,
    city,
    stateVal,
    address,
    geoPick,
    project,
    landZone,
    idealFor,
    ownershipStatus,
    dimensions,
    roadWidth,
    roadWidthUnit,
    facingDirection,
    khataEpid,
    khataForm,
    yearBuilt,
    isPublished,
    features,
    nearbyHighlights,
    images,
    privateImages,
    documents,
    googleMapLink,
    locationPrivacy,
    notes,
    tags,
    rentalIncome,
    floorTenancies,
    floorPlans,
    ownerContactId,
    listingSource,
    searchQuery,
  } = values;
  const [readingEKhata, setReadingEKhata] = useState(false);
  const [eKhataReview, setEKhataReview] = useState<{
    fields: EKhataFields;
    changes: EKhataChange[];
  } | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<
    { tag: string; uses: number }[]
  >([]);
  const [tagInput, setTagInput] = useState('');

  const [localitiesDb, setLocalitiesDb] = useState<{
    detailed: string[];
  } | null>(null);
  // A rental's price is its monthly rent, so it has no yield to show —
  // see src/lib/inventory/rental-yield.ts. The API derives the stored
  // figure the same way; this is only what the form previews.
  const roiValue = useMemo(
    () => rentalYieldPercent(listingType, Number(price), Number(rentalIncome)),
    [listingType, price, rentalIncome]
  );

  const floorRentTotal = useMemo(
    () =>
      floorTenancies.reduce(
        (sum, ft) => sum + (Number(ft.monthly_rent) || 0),
        0
      ),
    [floorTenancies]
  );
  const floorAdvanceTotal = useMemo(
    () =>
      floorTenancies.reduce((sum, ft) => sum + (Number(ft.advance) || 0), 0),
    [floorTenancies]
  );

  const [fetchedProjects, setFetchedProjects] = useState<AutoCompleteProject[]>(
    []
  );
  const [searchingProjects, setSearchingProjects] = useState(false);

  const [saving, setSaving] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [lockingImagePath, setLockingImagePath] = useState<string | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [contactedContactIds, setContactedContactIds] = useState<Set<string>>(
    new Set()
  );
  const [ownerSearchInput, setOwnerSearchInput] = useState('');

  // Helper classifications based on selected type
  const hasBedsBaths = typeHasBedsBaths(type);
  const hasCommercialFields = typeHasCommercialFields(type);
  const hasCommercialBuildingFields = typeHasCommercialBuildingFields(type);
  const isLand = isLandType(type);
  const isRawLand = isRawLandType(type);
  const isApartment = isApartmentType(type);
  const showFloorNumber = hasUnitFloor(type);
  const showTotalFloors = hasTotalFloors(type);
  const guardedByType = isGuardedType(type);
  const locationGuarded = isLocationGuarded({
    type,
    location_privacy: locationPrivacy || null,
  });

  async function ensureLocalitiesLoaded() {
    if (!localitiesDb) {
      const db = await import('@/lib/data/bengaluru-localities');
      setLocalitiesDb({ detailed: db.getDetailedLocalities() });
    }
  }

  // Real estate matching & broadcast states
  const [activeTab, setActiveTab] = useState('details');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [listingAudience, setListingAudience] = useState<AudienceContact[]>([]);
  const [loadingListingAudience, setLoadingListingAudience] = useState(false);
  const [listingAudienceError, setListingAudienceError] = useState(false);

  // Contact document sharing modal states
  const [shareDocDialogOpen, setShareDocDialogOpen] = useState(false);
  const [docRequestsRefreshKey, setDocRequestsRefreshKey] = useState(0);
  // Who the matched list offers: buyers by default, agents only for a
  // co-broker blast, or both together.
  const [matchAudience, setMatchAudience] = useState<MatchAudience>('buyers');
  const [showcaseSubdomain, setShowcaseSubdomain] = useState<string | null>(
    null
  );
  const [currency, setCurrency] = useState('INR');

  // Fetch contacts and templates
  const fetchContacts = useCallback(async () => {
    if (!accountId) return;
    setLoadingContacts(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, contact_notes(note_text)')
        .order('name');
      if (error) throw error;
      setContacts(
        await attachInquiredListingTypes(
          supabase,
          accountId,
          (data || []) as unknown as Contact[]
        )
      );
    } catch (err) {
      console.error('Failed to load contacts for matching:', err);
    } finally {
      setLoadingContacts(false);
    }
  }, [supabase, accountId]);

  const fetchListingEnquiries = useCallback(async () => {
    if (!property?.id) {
      setListingAudience([]);
      setListingAudienceError(false);
      return;
    }
    setLoadingListingAudience(true);
    setListingAudienceError(false);
    try {
      const response = await fetch(`/api/properties/${property.id}/audience`);
      if (!response.ok) throw new Error('Failed to load enquiries');
      const body = (await response.json()) as { data?: AudienceContact[] };
      setListingAudience(body.data ?? []);
    } catch (err) {
      console.error('Failed to load property enquiries:', err);
      setListingAudienceError(true);
    } finally {
      setLoadingListingAudience(false);
    }
  }, [property?.id]);

  const fetchContactedStatus = useCallback(async () => {
    if (!property?.id) {
      setContactedContactIds(new Set());
      return;
    }
    try {
      const propertyCode = property.property_code;
      const propertyTitle = property.title;

      const orConditions: string[] = [];
      if (propertyCode) {
        orConditions.push(`content_text.ilike.%${propertyCode}%`);
      }
      if (propertyTitle) {
        orConditions.push(`content_text.ilike.%${propertyTitle.slice(0, 30)}%`);
      }

      if (orConditions.length === 0) {
        setContactedContactIds(new Set());
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation:conversations(contact_id)')
        .or(orConditions.join(','));

      if (error) throw error;

      const contactedIds = new Set<string>();
      if (data) {
        (
          data as unknown as Array<{
            conversation:
              { contact_id: string } | Array<{ contact_id: string }> | null;
          }>
        ).forEach((m) => {
          if (m.conversation) {
            if (Array.isArray(m.conversation)) {
              m.conversation.forEach((c) => {
                if (c.contact_id) {
                  contactedIds.add(c.contact_id);
                }
              });
            } else if (m.conversation.contact_id) {
              contactedIds.add(m.conversation.contact_id);
            }
          }
        });
      }
      setContactedContactIds(contactedIds);
    } catch (err) {
      console.error('Failed to fetch contacted status:', err);
    }
  }, [supabase, property]);

  const handleGoToChat = async (contactId: string) => {
    if (!accountId) {
      toast.error('Account not loaded yet');
      return;
    }
    try {
      const { conversation, error } = await resolveConversation<{ id: string }>(
        supabase,
        {
          accountId,
          contactId,
          userId: (await supabase.auth.getUser()).data.user?.id ?? null,
          columns: 'id',
        }
      );

      if (error) throw error;
      if (conversation) {
        router.push(`/inbox?c=${conversation.id}`);
      }
    } catch (err) {
      console.error('Failed to navigate to chat:', err);
      toast.error('Failed to navigate to chat');
    }
  };

  useEffect(() => {
    if (open) {
      fetchContacts();
      fetchContactedStatus();
      fetchListingEnquiries();
      // Load currency settings from showcase_settings
      if (accountId) {
        supabase
          .from('showcase_settings')
          .select('currency, subdomain')
          .eq('account_id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.currency) {
              setCurrency(data.currency);
            }
            setShowcaseSubdomain(data?.subdomain || null);
          });
      }
      setActiveTab(initialTab);
      if (!property) {
        set('interestedContactIds', []);
      }
    }
  }, [
    open,
    fetchContacts,
    fetchContactedStatus,
    fetchListingEnquiries,
    property,
    accountId,
    supabase,
    initialTab,
    set,
  ]);

  useEffect(() => {
    if (open && property && contacts && contacts.length > 0) {
      const interested = contacts
        .filter((c) => c.last_inquired_property_id === property.id)
        .map((c) => c.id);
      set('interestedContactIds', interested);
    }
  }, [open, property, contacts, set]);

  const matchedContacts = useMemo(() => {
    const fullLocation = [
      address.trim(),
      sublocality.trim(),
      city.trim(),
      stateVal.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    const currentProp: Partial<Property> = {
      title,
      description,
      price: price ? Number(price) : 0,
      location: fullLocation,
      type,
      sublocality,
      city,
      state: stateVal,
      project,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      features,
      nearby_highlights: nearbyHighlights,
      // Without these the matcher can only compare locality strings and
      // assumes a Sale price, so this tab ranked listings differently
      // from Radar and the inventory card counts, which pass the row.
      latitude: geoPick?.latitude ?? undefined,
      longitude: geoPick?.longitude ?? undefined,
      listing_type: listingType,
      rent_per_month: rentPerMonth ? Number(rentPerMonth) : undefined,
      rental_income: rentalIncome ? Number(rentalIncome) : undefined,
      roi: roiValue ?? undefined,
    };
    // Only match agents and Buyers
    const targetContacts = contacts.filter(
      (c) => c.classification === 'Buyer' || c.classification === 'Agent'
    );
    return getMatchingContacts(currentProp, targetContacts);
  }, [
    contacts,
    title,
    description,
    price,
    address,
    type,
    sublocality,
    city,
    stateVal,
    project,
    bedrooms,
    features,
    nearbyHighlights,
    geoPick,
    listingType,
    rentPerMonth,
    rentalIncome,
    roiValue,
  ]);

  const displayedMatches = useMemo(() => {
    return matchedContacts.filter(({ contact: c }) =>
      inMatchAudience(c.classification, matchAudience)
    );
  }, [matchedContacts, matchAudience]);

  const enquiredContacts = useMemo(
    () => enquiredAudienceContacts(listingAudience),
    [listingAudience]
  );

  // Autocomplete states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Google Places suggestions (third group in the location dropdown).
  // A picked place carries coordinates; typing again invalidates the pick
  // and the server geocodes the free text on save instead.
  const [googleSuggestions, setGoogleSuggestions] = useState<
    { place_id: string; main_text: string; secondary_text: string }[]
  >([]);
  // The pasted pin and the picked locality should describe the same
  // place. When they don't, one of them is wrong — usually a same-named
  // locality the address geocoder picked in the wrong part of town — and
  // silently keeping both is what drops a listing out of radius search.
  const mapPinDrift = useMemo(() => {
    const link = googleMapLink.trim();
    const pin = link ? extractCoordinatesFromMapUrl(link) : null;
    if (!pin || !geoPick) return null;
    const km = haversineKm(
      geoPick.latitude,
      geoPick.longitude,
      pin.latitude,
      pin.longitude
    );
    return km > 1 ? km : null;
  }, [googleMapLink, geoPick]);

  const googleSessionRef = useRef<string | null>(null);
  const googleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const googleSeqRef = useRef(0);
  const mapsUnavailableRef = useRef(false);

  function fetchGoogleSuggestions(input: string) {
    if (mapsUnavailableRef.current) return;
    if (!googleSessionRef.current)
      googleSessionRef.current = crypto.randomUUID();
    const seq = ++googleSeqRef.current;
    fetch(
      `/api/maps/autocomplete?input=${encodeURIComponent(input)}&session=${googleSessionRef.current}`
    )
      .then(async (res) => {
        if (res.status === 501) {
          mapsUnavailableRef.current = true;
          return { suggestions: [] };
        }
        if (!res.ok) return { suggestions: [] };
        return (await res.json()) as { suggestions: typeof googleSuggestions };
      })
      .then(({ suggestions }) => {
        if (seq === googleSeqRef.current) setGoogleSuggestions(suggestions);
      })
      .catch(() => {
        if (seq === googleSeqRef.current) setGoogleSuggestions([]);
      });
  }

  async function handleGooglePick(s: { place_id: string; main_text: string }) {
    setShowSuggestions(false);
    setGoogleSuggestions([]);
    set('searchQuery', s.main_text);
    set('project', '');
    try {
      const session = googleSessionRef.current;
      googleSessionRef.current = null; // details pick closes the billing session
      const res = await fetch(
        `/api/maps/place-details?place_id=${encodeURIComponent(s.place_id)}${session ? `&session=${session}` : ''}`
      );
      if (!res.ok) {
        set('sublocality', s.main_text);
        return;
      }
      const { place } = (await res.json()) as {
        place: {
          place_id: string;
          name: string;
          latitude: number;
          longitude: number;
          sublocality: string | null;
          city: string | null;
          state: string | null;
        };
      };
      set('sublocality', place.sublocality || place.name);
      if (place.city) set('city', place.city);
      if (place.state) set('stateVal', place.state);
      set('geoPick', {
        latitude: place.latitude,
        longitude: place.longitude,
        place_id: place.place_id,
        canonical: place.name,
      });
    } catch {
      // Keep the typed text; server-side geocode fallback resolves it on save
      set('sublocality', s.main_text);
    }
  }

  // Close autocomplete on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Parent refetches recreate `property` (the updated_at sync in
  // inventory-content) and `contacts` (query identity) while the dialog
  // is open; re-running the reset then clobbers unsaved edits — deleted
  // photo rows "reappear". Reset only when the dialog opens, switches to
  // a different property, or contacts first arrive.
  const formResetKey = useRef<string | null>(null);
  useEffect(() => {
    if (open) {
      const resetKey = `${property?.id ?? 'new'}:${contacts && contacts.length > 0 ? 'c1' : 'c0'}`;
      if (formResetKey.current === resetKey) return;
      formResetKey.current = resetKey;
      userTypedDims.current = {
        landArea: false,
        frontage: false,
        depth: false,
      };
      derivedDims.current = { landArea: false, frontage: false, depth: false };
      reset(
        property
          ? propertyToFormValues(property, contacts)
          : emptyPropertyFormValues(defaultOwnerId)
      );
      setTagInput('');
      if (property) {
        // Set owner search input to display the selected owner's name
        if (property.owner_contact_id) {
          const ownerContact = contacts?.find(
            (c) => c.id === property.owner_contact_id
          );
          if (ownerContact) {
            setOwnerSearchInput(ownerContact.name || ownerContact.phone || '');
          }
        }
      } else {
        setGoogleSuggestions([]);
      }
    } else {
      formResetKey.current = null;
    }
  }, [open, property, defaultOwnerId, contacts, reset]);

  useEffect(() => {
    if (!open) return;
    const term = searchQuery.trim();
    if (!term) {
      setFetchedProjects([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingProjects(true);
      try {
        const response = await fetch(
          `/api/projects?search=${encodeURIComponent(term)}`
        );
        if (response.ok) {
          const data = await response.json();
          setFetchedProjects(data);
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      } finally {
        setSearchingProjects(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery, open]);

  const isProjectMatched =
    !!project &&
    (POPULAR_PROJECTS.some(
      (p) => p.name.toLowerCase() === project.trim().toLowerCase()
    ) ||
      fetchedProjects.some(
        (p) => p.name.toLowerCase() === project.trim().toLowerCase()
      ));

  function handleSearchQueryChange(val: string) {
    set('searchQuery', val);
    setShowSuggestions(true);
    // Typed text invalidates a previous Google pick — the server geocode
    // fallback re-resolves coordinates for the new text on save.
    set('geoPick', null);
    if (googleDebounceRef.current) clearTimeout(googleDebounceRef.current);
    if (val.trim().length >= 2) {
      googleDebounceRef.current = setTimeout(
        () => fetchGoogleSuggestions(val.trim()),
        300
      );
    } else {
      setGoogleSuggestions([]);
    }

    // Check if the query matches a project exactly (case-insensitive)
    const exactProj = [...POPULAR_PROJECTS, ...fetchedProjects].find(
      (p) => p.name.toLowerCase() === val.trim().toLowerCase()
    );
    if (exactProj) {
      set('project', exactProj.name);
      set('sublocality', exactProj.sublocality);
      set('city', exactProj.city);
      set('stateVal', exactProj.state);
      set('address', exactProj.address);
    } else {
      // Check if it matches a layout, sector, or main/cross (split by comma)
      const parts = val.split(',').map((s) => s.trim());
      if (parts.length > 1) {
        set('sublocality', parts[0]);
        set('address', parts[1]);
      } else {
        const exactArea = POPULAR_SUBLOCALITIES.find(
          (a) => a.toLowerCase() === val.trim().toLowerCase()
        );
        if (exactArea) {
          set('sublocality', exactArea);
        } else {
          set('sublocality', val);
        }
      }
      set('project', '');
    }
  }

  // Land area / frontage / depth are linked (area = frontage x depth). Two
  // invariants keep auto-calculation from fighting the user:
  //  1. Never overwrite a value the user typed this session — only fields that
  //     are empty, prefilled from the record, or previously auto-derived.
  //  2. While the user types in one field, keep deriving the SAME target field
  //     (tracked via `derived`) so an auto-filled value never becomes the
  //     anchor for the next keystroke.
  const userTypedDims = useRef({
    landArea: false,
    frontage: false,
    depth: false,
  });
  const derivedDims = useRef({
    landArea: false,
    frontage: false,
    depth: false,
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const sqftFactor = () => SQFT_PER_AREA_UNIT[landAreaUnit] ?? 1;

  const markDimTyped = (
    field: 'landArea' | 'frontage' | 'depth',
    val: string
  ) => {
    userTypedDims.current[field] = val.trim() !== '';
    derivedDims.current[field] = false;
  };

  const handleLandAreaChange = (val: string) => {
    set('landArea', val);
    markDimTyped('landArea', val);
    if (!isLand) return;
    const typed = userTypedDims.current;
    const derived = derivedDims.current;
    const aSqft = Number(val) * sqftFactor();
    const fNum = Number(frontage);
    const dNum = Number(depth);
    if (!val || isNaN(aSqft) || aSqft <= 0) return;

    const deriveFrontage = () => {
      set('frontage', String(round2(aSqft / dNum)));
      derived.frontage = true;
    };
    const deriveDepth = () => {
      set('depth', String(round2(aSqft / fNum)));
      derived.depth = true;
    };

    if (derived.frontage && dNum > 0) deriveFrontage();
    else if (derived.depth && fNum > 0) deriveDepth();
    else if (!typed.depth && fNum > 0 && !derived.frontage) deriveDepth();
    else if (!typed.frontage && dNum > 0) deriveFrontage();
  };

  const handleFrontageChange = (val: string) => {
    set('frontage', val);
    markDimTyped('frontage', val);
    if (!isLand) return;
    const typed = userTypedDims.current;
    const derived = derivedDims.current;
    const fNum = Number(val);
    const dNum = Number(depth);
    const aSqft = Number(landArea) * sqftFactor();
    if (!val || isNaN(fNum) || fNum <= 0) return;

    const deriveArea = () => {
      set('landArea', String(round2((fNum * dNum) / sqftFactor())));
      derived.landArea = true;
    };
    const deriveDepth = () => {
      set('depth', String(round2(aSqft / fNum)));
      derived.depth = true;
    };

    if (derived.landArea && dNum > 0) deriveArea();
    else if (derived.depth && aSqft > 0) deriveDepth();
    else if (!typed.depth && aSqft > 0 && !derived.landArea) deriveDepth();
    else if (!typed.landArea && dNum > 0) deriveArea();
  };

  const handleDepthChange = (val: string) => {
    set('depth', val);
    markDimTyped('depth', val);
    if (!isLand) return;
    const typed = userTypedDims.current;
    const derived = derivedDims.current;
    const dNum = Number(val);
    const fNum = Number(frontage);
    const aSqft = Number(landArea) * sqftFactor();
    if (!val || isNaN(dNum) || dNum <= 0) return;

    const deriveArea = () => {
      set('landArea', String(round2((fNum * dNum) / sqftFactor())));
      derived.landArea = true;
    };
    const deriveFrontage = () => {
      set('frontage', String(round2(aSqft / dNum)));
      derived.frontage = true;
    };

    if (derived.landArea && fNum > 0) deriveArea();
    else if (derived.frontage && aSqft > 0) deriveFrontage();
    else if (!typed.frontage && aSqft > 0 && !derived.landArea)
      deriveFrontage();
    else if (!typed.landArea && fNum > 0) deriveArea();
  };

  // Images use the photo bucket; PDF land sketches use the document
  // bucket so their MIME type is accepted and preserved.
  async function uploadPlanImage(file: File): Promise<string | null> {
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return null;
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImage = (PLAN_IMAGE_MIME_TYPES as readonly string[]).includes(
      file.type
    );
    if (!isPdf && !isImage) {
      toast.error('Sketches must be a PDF or image file.');
      return null;
    }
    const sizeLimit = isPdf ? DOCUMENT_SIZE_LIMIT : 5 * 1024 * 1024;
    if (file.size > sizeLimit) {
      toast.error(
        `"${file.name}" is too large. Max size is ${Math.round(sizeLimit / (1024 * 1024))}MB.`
      );
      return null;
    }
    try {
      let uploadFile: File | Blob = file;
      let uploadContentType = file.type;
      let extension = isPdf ? 'pdf' : file.type.split('/')[1];
      if (isImage) {
        try {
          uploadFile = await compressImageOnClient(file);
          uploadContentType = 'image/jpeg';
          extension = 'jpg';
        } catch {
          // Fallback to the original if compression fails.
        }
      }
      const randomStr = Math.random().toString(36).substring(2, 7);
      const bucket = isPdf ? 'property-documents' : 'property-images';
      const path = `${accountId}/${isPdf ? 'sketch' : 'plan'}-${Date.now()}-${randomStr}.${extension}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, uploadFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: uploadContentType,
        });
      if (error) throw new Error(error.message);
      return `${bucket}/${path}`;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Plan or sketch upload failed'
      );
      return null;
    }
  }

  async function onReadEKhata(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (eKhataInputRef.current) eKhataInputRef.current.value = '';
    if (!file) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }
    const mimeType = file.type || 'application/pdf';
    if (!isEKhataMimeType(mimeType)) {
      toast.error('Choose the e-Khata PDF or a photo of it.');
      return;
    }
    if (file.size > E_KHATA_MAX_BYTES) {
      toast.error('That file is too large for an e-Khata.');
      return;
    }
    setReadingEKhata(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const path = `${accountId}/doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-e-khata.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('property-documents')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: mimeType,
        });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      const stored = `property-documents/${path}`;

      const response = await fetch('/api/properties/e-khata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: stored, mime_type: mimeType }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 402) {
          toast.error(
            body.error || 'Not enough credits to read this e-Khata.',
            {
              action: { label: 'Buy credits', onClick: openTopupModal },
            }
          );
          return;
        }
        throw new Error(body.error || 'Could not read this e-Khata.');
      }

      set('documents', (prev) => {
        const kept = prev
          .map((doc) =>
            typeof doc === 'string' ? { url: doc, title: '' } : doc
          )
          .filter((doc) => doc?.url?.trim());
        return [...kept, { url: stored, title: 'e-Khata' }];
      });

      const fields = body.data.fields as EKhataFields;
      const currentDimensions = isLand
        ? frontage.trim() && depth.trim()
          ? `${frontage.trim()}x${depth.trim()}`
          : ''
        : dimensions;
      setEKhataReview({
        fields,
        changes: eKhataChanges(
          fields,
          {
            address,
            city,
            latitude: geoPick?.latitude ?? null,
            longitude: geoPick?.longitude ?? null,
            land_area: landArea,
            dimensions: currentDimensions,
            built_up_area: areaSqft,
            year_built: yearBuilt,
            khata_epid: khataEpid,
            khata_form: khataForm,
          },
          { isApartment, isLand }
        ),
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read this e-Khata.'
      );
    } finally {
      setReadingEKhata(false);
    }
  }

  function applyEKhata(keys: EKhataChangeKey[]) {
    const review = eKhataReview;
    if (!review) return;
    const { fields } = review;
    for (const key of keys) {
      if (key === 'address' && fields.address) set('address', fields.address);
      if (key === 'city') set('city', 'Bengaluru');
      if (
        key === 'pin' &&
        fields.latitude !== undefined &&
        fields.longitude !== undefined
      ) {
        set('geoPick', {
          latitude: fields.latitude,
          longitude: fields.longitude,
          place_id: '',
          canonical: '',
        });
      }
      if (key === 'land_area' && fields.site_area_sqft) {
        set('landArea', String(fields.site_area_sqft));
        set('landAreaUnit', 'Sq.Ft.');
      }
      if (
        key === 'dimensions' &&
        fields.site_frontage_ft &&
        fields.site_depth_ft
      ) {
        set('frontage', String(fields.site_frontage_ft));
        set('depth', String(fields.site_depth_ft));
        set('dimensions', `${fields.site_frontage_ft}x${fields.site_depth_ft}`);
      }
      if (key === 'built_up_area' && fields.built_up_sqft) {
        set('areaSqft', String(fields.built_up_sqft));
        set('areaUnit', 'Sq.Ft.');
      }
      if (key === 'year_built' && fields.year_built)
        set('yearBuilt', String(fields.year_built));
      if (key === 'khata_epid' && fields.epid) set('khataEpid', fields.epid);
      if (key === 'khata_form' && fields.khata_form)
        set('khataForm', fields.khata_form);
    }
    setEKhataReview(null);
    toast.success(
      `Copied ${keys.length} field${keys.length === 1 ? '' : 's'} from the e-Khata. Save to keep them.`
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationError = validatePropertyForm(values);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);

    try {
      if (!user || !accountId)
        throw new Error('Not authenticated or account not loaded');

      const payload = buildPropertyPayload(values, { isEdit });

      if (isEdit && property) {
        const response = await fetch(`/api/properties/${property.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to update property');
        }
      } else {
        const response = await fetch('/api/properties', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...payload,
            user_id: user.id,
            account_id: accountId,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          if (
            response.status === 409 &&
            errData.code === 'PROBABLE_PROPERTY_DUPLICATE' &&
            Array.isArray(errData.candidates)
          ) {
            setDuplicateCandidates(errData.candidates);
            setPendingCreatePayload({
              ...payload,
              user_id: user.id,
              account_id: accountId,
            });
            return;
          }
          throw new Error(errData.error || 'Failed to create property');
        }
      }

      toast.success(
        isEdit
          ? 'Property updated successfully'
          : 'Property created successfully'
      );
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An error occurred while saving';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function createNearbyListingAnyway() {
    if (!pendingCreatePayload) return;
    setSaving(true);
    try {
      const response = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingCreatePayload,
          allow_probable_duplicate: true,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to create property');
      }
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
      toast.success('Separate property listing created');
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create property'
      );
    } finally {
      setSaving(false);
    }
  }

  // Filter project & area lists based on search query
  const query = searchQuery.trim().toLowerCase();

  // Tags already in use in this account, counted server-side
  // (account_property_tags, migration 265).
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch('/api/properties/tags');
        if (!res.ok) return;
        const body = await res.json();
        setTagSuggestions(Array.isArray(body?.data) ? body.data : []);
      } catch {
        // Suggestions are a convenience; the free-text input still works.
      }
    })();
  }, [open]);

  const filteredProjects = useMemo(() => {
    if (!query) {
      return POPULAR_PROJECTS.slice(0, 5).map((p) => ({
        name: p.name,
        sublocality: p.sublocality,
        city: p.city,
        state: p.state,
        address: p.address,
      }));
    }
    return fetchedProjects;
  }, [query, fetchedProjects]);

  const filteredSublocalities = useMemo(() => {
    const dataset = localitiesDb?.detailed || POPULAR_SUBLOCALITIES;
    if (!query) {
      return dataset.slice(0, 8);
    }
    return dataset.filter((s) => s.toLowerCase().includes(query)).slice(0, 8);
  }, [query, localitiesDb]);

  const formSections = propertyFormSections({
    title,
    price,
    rentPerMonth,
    city,
    state: stateVal,
    images,
    description,
    ownerContactId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`flex max-h-[90vh] flex-col overflow-hidden border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-2xl ${viewMode ? '' : 'lg:max-w-5xl'}`}
      >
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-slate-800 bg-slate-950/40 px-6 pt-5">
            <DialogHeader className="pb-3">
              <DialogTitle className="flex items-center justify-between text-white">
                <span>
                  {viewMode
                    ? 'Property Details'
                    : isEdit
                      ? 'Edit Property Listing'
                      : 'Add New Property Listing'}
                  {property?.property_code && (
                    <span className="ml-2 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs font-normal text-slate-300 select-all">
                      {property.property_code}
                    </span>
                  )}
                </span>
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {viewMode
                  ? 'View listing specifications, photos, maps, and inquiries.'
                  : 'Configure listing specifications, location details, and matching preferences.'}
                {property && (
                  <span className="mt-1 block text-[11px] text-slate-500">
                    Added {formatAuditDateTime(property.created_at)} · Modified{' '}
                    {formatAuditDateTime(property.updated_at)}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {isEdit && (
              <TabsList className="mb-3 w-fit max-w-full overflow-x-auto border border-slate-800 bg-slate-900">
                <TabsTrigger
                  value="details"
                  className="data-[state=active]:text-primary px-4 py-1.5 text-xs font-semibold text-slate-400 data-[state=active]:bg-slate-800"
                >
                  Property Details
                </TabsTrigger>
                <TabsTrigger
                  value="matches"
                  className="data-[state=active]:text-primary px-4 py-1.5 text-xs font-semibold text-slate-400 data-[state=active]:bg-slate-800"
                >
                  Matching Contacts ({displayedMatches.length})
                </TabsTrigger>
                <TabsTrigger
                  value="enquiries"
                  className="data-[state=active]:text-primary px-4 py-1.5 text-xs font-semibold text-slate-400 data-[state=active]:bg-slate-800"
                >
                  Enquired Contacts ({enquiredContacts.length})
                </TabsTrigger>
              </TabsList>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* PROPERTY DETAILS TAB */}
            <TabsContent
              value="details"
              className="m-0 px-6 py-4 focus:outline-none"
            >
              {/* Facts an agent stated to a buyer that this listing does
                  not carry yet. Renders nothing when the queue is empty,
                  so it costs the ordinary listing no space. */}
              {property?.id && (
                <LearningPanel propertyId={property.id} onApplied={onSaved} />
              )}
              {viewMode ? (
                <div className="animate-fade-in space-y-6 pb-4">
                  {/* 1. IMAGE CAROUSEL / GALLERY — photos plus the
                      listing video as the last slide; arrow buttons
                      and touch swipe both navigate. */}
                  <div className="space-y-2">
                    {(() => {
                      const publicImages = (images || [])
                        .filter((img) => img && img.trim().length > 0)
                        .map(storagePublicUrl);
                      // Private photos stream through the authenticated
                      // proxy — the masked API empties the list for
                      // viewers who may not see them.
                      const privateProxyImages = property?.id
                        ? (privateImages || []).map(
                            (_, i) =>
                              `/api/properties/${property.id}/private-images/${i}`
                          )
                        : [];
                      const validImages = [
                        ...publicImages,
                        ...privateProxyImages,
                      ];
                      const hasVideo = Boolean(
                        property?.video_url && property.video_status === 'ready'
                      );
                      const mediaCount =
                        validImages.length + (hasVideo ? 1 : 0);
                      const isPrivateSlide = (i: number) =>
                        i >= publicImages.length && i < validImages.length;
                      if (mediaCount === 0) {
                        return (
                          <div className="relative flex aspect-[16/9] w-full flex-col items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-dashed border-slate-800 bg-slate-950/60 py-12 text-slate-500">
                            <Building className="size-10 text-slate-400 opacity-30" />
                            <span className="text-xs font-medium">
                              No images uploaded for this listing.
                            </span>
                          </div>
                        );
                      }
                      const isVideoSlide =
                        hasVideo && activeImageIndex >= validImages.length;
                      const goTo = (dir: number) =>
                        setActiveImageIndex((prev) => {
                          const next = prev + dir;
                          if (next < 0) return mediaCount - 1;
                          if (next >= mediaCount) return 0;
                          return next;
                        });
                      return (
                        <div className="space-y-2">
                          {/* Main Active Slide */}
                          <div
                            className="group relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
                            onTouchStart={(e) => {
                              galleryTouchXRef.current = e.touches[0].clientX;
                            }}
                            onTouchEnd={(e) => {
                              const startX = galleryTouchXRef.current;
                              galleryTouchXRef.current = null;
                              // A drag on the video element is scrubbing, not a swipe.
                              if (
                                startX === null ||
                                (e.target as HTMLElement).tagName === 'VIDEO'
                              )
                                return;
                              const delta =
                                e.changedTouches[0].clientX - startX;
                              if (Math.abs(delta) < 50) return;
                              goTo(delta < 0 ? 1 : -1);
                            }}
                          >
                            {isVideoSlide ? (
                              <video
                                src={storagePublicUrl(property!.video_url!)}
                                controls
                                playsInline
                                preload="metadata"
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={
                                  validImages[activeImageIndex] ||
                                  validImages[0]
                                }
                                alt={title}
                                className="h-full w-full object-cover"
                              />
                            )}
                            {mediaCount > 1 && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => goTo(-1)}
                                  className="absolute top-1/2 left-2 -translate-y-1/2 cursor-pointer rounded-full border border-slate-800/60 bg-slate-950/60 p-1 text-slate-300 hover:text-white"
                                >
                                  <ChevronLeft className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => goTo(1)}
                                  className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-full border border-slate-800/60 bg-slate-950/60 p-1 text-slate-300 hover:text-white"
                                >
                                  <ChevronRight className="size-4" />
                                </button>
                              </>
                            )}
                            {!isVideoSlide &&
                              isPrivateSlide(
                                Math.min(activeImageIndex, mediaCount - 1)
                              ) && (
                                <div className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-amber-500/90 px-2 py-1 text-[10px] font-bold tracking-wide text-slate-950 uppercase">
                                  <Lock className="size-3" /> Private
                                </div>
                              )}
                            <div className="absolute right-3 bottom-3 rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-1 font-mono text-[10px] font-bold text-slate-300 backdrop-blur-md">
                              {Math.min(activeImageIndex, mediaCount - 1) + 1} /{' '}
                              {mediaCount}
                            </div>
                          </div>
                          {/* Thumbnail Row */}
                          {mediaCount > 1 && (
                            <div className="flex scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent gap-2 overflow-x-auto pb-1.5">
                              {validImages.map((img, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setActiveImageIndex(idx)}
                                  className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-950 transition-all ${
                                    !isVideoSlide && idx === activeImageIndex
                                      ? 'border-primary shadow-sm'
                                      : 'border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={img}
                                    alt={`${title} thumbnail ${idx + 1}`}
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                              {hasVideo && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveImageIndex(validImages.length)
                                  }
                                  title="Listing video"
                                  className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-950 transition-all ${
                                    isVideoSlide
                                      ? 'border-primary shadow-sm'
                                      : 'border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <video
                                    src={storagePublicUrl(property!.video_url!)}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    className="h-full w-full object-cover"
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
                                    <CirclePlay className="size-4 text-white" />
                                  </span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 2. CORE HEADER INFO */}
                  <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-4 md:flex-row md:items-start">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={`rounded border-none px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase hover:opacity-90 ${
                            listingType === 'Rent'
                              ? 'bg-blue-500/10 text-blue-400'
                              : listingType === 'JV/JD'
                                ? 'bg-purple-500/10 text-purple-400'
                                : listingType === 'Built to Suit'
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {listingType === 'Rent'
                            ? 'For Rent'
                            : listingType === 'JV/JD'
                              ? 'JV / JD'
                              : listingType === 'Built to Suit'
                                ? 'Built to Suit'
                                : 'For Sale'}
                        </Badge>
                        <Badge className="rounded border-none bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-300 uppercase">
                          {type}
                        </Badge>
                        <Badge
                          className={
                            status === 'Sold'
                              ? 'scale-105 animate-pulse rounded border border-red-500 bg-red-600 px-2.5 py-0.5 text-xs font-black tracking-wider text-white uppercase shadow-md shadow-red-950/50'
                              : `rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                                  status === 'Available'
                                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                                    : status === 'Under Contract'
                                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                                }`
                          }
                        >
                          {status}
                        </Badge>
                        {listingSource === 'agent' && (
                          <Badge className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sky-400 uppercase">
                            Agent Referred
                          </Badge>
                        )}
                      </div>
                      <h3 className="pt-1 text-xl leading-tight font-bold text-white">
                        {title || 'Untitled Property'}
                      </h3>
                      <p className="flex items-center gap-1 text-xs text-slate-400">
                        <MapPin className="size-3.5 shrink-0 text-slate-500" />
                        <span>
                          {address || sublocality
                            ? [address, sublocality, city]
                                .filter(Boolean)
                                .join(', ')
                            : 'No location details provided'}
                        </span>
                      </p>
                    </div>

                    <div className="shrink-0 text-left md:text-right">
                      {listingType === 'Rent' ||
                      listingType === 'Built to Suit' ? (
                        <>
                          <div className="text-2xl font-black text-white">
                            {rentPerMonth
                              ? `${formatCurrency(Number(rentPerMonth), currency)}/mo`
                              : '--'}
                          </div>
                          <PriceHint
                            value={rentPerMonth}
                            className="text-[10px]"
                          />
                          {(maintenance || advance || gst) && (
                            <div className="mt-1 space-y-0.5 text-[10px] font-medium text-slate-400">
                              {maintenance && Number(maintenance) > 0 && (
                                <div>
                                  Maint:{' '}
                                  {formatCurrency(
                                    Number(maintenance),
                                    currency
                                  )}
                                </div>
                              )}
                              {advance && Number(advance) > 0 && (
                                <div>
                                  Deposit:{' '}
                                  {formatCurrency(Number(advance), currency)}
                                </div>
                              )}
                              {gst && Number(gst) > 0 && (
                                <div>
                                  GST: {formatCurrency(Number(gst), currency)}
                                </div>
                              )}
                            </div>
                          )}
                          {listingType === 'Built to Suit' &&
                            (btsLeaseYears || btsLockInYears) && (
                              <div className="mt-1 space-y-0.5 text-[10px] font-medium text-slate-400">
                                {btsLeaseYears && (
                                  <div>Lease: {btsLeaseYears} yrs</div>
                                )}
                                {btsLockInYears && (
                                  <div>Lock-in: {btsLockInYears} yrs</div>
                                )}
                              </div>
                            )}
                        </>
                      ) : listingType === 'JV/JD' ? (
                        <>
                          <div className="text-2xl font-black text-white">
                            {ownerSharePercent && builderSharePercent
                              ? `${ownerSharePercent}:${builderSharePercent}`
                              : '--'}
                          </div>
                          <p className="mt-0.5 text-[10px] font-semibold text-purple-400">
                            Owner : Builder share ({jvStructure})
                          </p>
                          {(goodwillAmount || advance || price) && (
                            <div className="mt-1 space-y-0.5 text-[10px] font-medium text-slate-400">
                              {price && Number(price) > 0 && (
                                <div>
                                  Est. value:{' '}
                                  {formatCurrency(Number(price), currency)}
                                </div>
                              )}
                              {goodwillAmount && Number(goodwillAmount) > 0 && (
                                <div>
                                  Goodwill:{' '}
                                  {formatCurrency(
                                    Number(goodwillAmount),
                                    currency
                                  )}
                                </div>
                              )}
                              {advance && Number(advance) > 0 && (
                                <div>
                                  Advance:{' '}
                                  {formatCurrency(Number(advance), currency)}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-black text-white">
                            {price
                              ? formatCurrency(Number(price), currency)
                              : '--'}
                          </div>
                          <PriceHint value={price} className="text-[10px]" />
                        </>
                      )}
                    </div>
                  </div>

                  {/* 3. KEY SPECS GRID */}
                  {(() => {
                    const specs: React.ReactNode[] = [];

                    if (hasBedsBaths) {
                      if (bedrooms) {
                        specs.push(
                          <div
                            key="bedrooms"
                            className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                          >
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <BedDouble className="size-4 text-slate-500" />
                              <span className="text-[10px] font-semibold tracking-wider uppercase">
                                Bedrooms
                              </span>
                            </div>
                            <span className="text-sm font-bold text-white">
                              {bedrooms} Bedrooms
                            </span>
                          </div>
                        );
                      }
                    } else {
                      if (project && project.trim() && project !== '--') {
                        specs.push(
                          <div
                            key="project"
                            className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                          >
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <Building className="size-4 text-slate-500" />
                              <span className="text-[10px] font-semibold tracking-wider uppercase">
                                Project
                              </span>
                            </div>
                            <span
                              className="truncate text-sm font-bold text-white"
                              title={project}
                            >
                              {project}
                            </span>
                          </div>
                        );
                      }
                    }

                    if (hasBedsBaths) {
                      if (bathrooms) {
                        specs.push(
                          <div
                            key="bathrooms"
                            className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                          >
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <Bath className="size-4 text-slate-500" />
                              <span className="text-[10px] font-semibold tracking-wider uppercase">
                                Bathrooms
                              </span>
                            </div>
                            <span className="text-sm font-bold text-white">
                              {bathrooms} Bathrooms
                            </span>
                          </div>
                        );
                      }
                    } else {
                      if (
                        sublocality &&
                        sublocality.trim() &&
                        sublocality !== '--'
                      ) {
                        specs.push(
                          <div
                            key="locality"
                            className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                          >
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <MapPin className="size-4 text-slate-500" />
                              <span className="text-[10px] font-semibold tracking-wider uppercase">
                                Locality
                              </span>
                            </div>
                            <span
                              className="truncate text-sm font-bold text-white"
                              title={sublocality}
                            >
                              {sublocality}
                            </span>
                          </div>
                        );
                      }
                    }

                    const areaVal = isLand ? landArea : areaSqft;
                    if (areaVal && areaVal.trim() && areaVal !== '--') {
                      specs.push(
                        <div
                          key="area"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Maximize2 className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Area
                            </span>
                          </div>
                          <span className="truncate text-sm font-bold text-white">
                            {isLand
                              ? `${Number(landArea).toLocaleString('en-IN')} ${landAreaUnit}`
                              : `${Number(areaSqft).toLocaleString('en-IN')} ${areaUnit}`}
                          </span>
                        </div>
                      );
                    }

                    if (
                      facingDirection &&
                      facingDirection.trim() &&
                      facingDirection !== 'Any Facing'
                    ) {
                      specs.push(
                        <div
                          key="facing"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Compass className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Facing
                            </span>
                          </div>
                          <span className="truncate text-sm font-bold text-white">
                            {facingDirection}
                          </span>
                        </div>
                      );
                    }

                    if (
                      !isLand &&
                      superBuiltArea &&
                      superBuiltArea.trim() &&
                      superBuiltArea !== '--'
                    ) {
                      specs.push(
                        <div
                          key="superBuilt"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Maximize2 className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Super Built-up
                            </span>
                          </div>
                          <span className="truncate text-sm font-bold text-white">
                            {Number(superBuiltArea).toLocaleString('en-IN')}{' '}
                            Sq.Ft.
                          </span>
                        </div>
                      );
                    }

                    if (
                      !isApartment &&
                      frontage &&
                      frontage.trim() &&
                      frontage !== '--'
                    ) {
                      specs.push(
                        <div
                          key="frontage"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Ruler className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Frontage
                            </span>
                          </div>
                          <span className="truncate text-sm font-bold text-white">
                            {frontage} Ft
                          </span>
                        </div>
                      );
                    }

                    if (
                      !isApartment &&
                      depth &&
                      depth.trim() &&
                      depth !== '--'
                    ) {
                      specs.push(
                        <div
                          key="depth"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Ruler className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Depth
                            </span>
                          </div>
                          <span className="truncate text-sm font-bold text-white">
                            {depth} Ft
                          </span>
                        </div>
                      );
                    }

                    if (
                      hasCommercialFields &&
                      landZone &&
                      landZone.trim() &&
                      landZone !== '--'
                    ) {
                      specs.push(
                        <div
                          key="zoning"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Layers className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Zoning
                            </span>
                          </div>
                          <span
                            className="truncate text-sm font-bold text-white"
                            title={landZone}
                          >
                            {landZone}
                          </span>
                        </div>
                      );
                    }

                    if (
                      isLand &&
                      ownershipStatus &&
                      ownershipStatus.trim() &&
                      ownershipStatus !== '--'
                    ) {
                      specs.push(
                        <div
                          key="ownership"
                          className="flex flex-col justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5 transition-colors hover:border-slate-700"
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <ShieldCheck className="size-4 text-slate-500" />
                            <span className="text-[10px] font-semibold tracking-wider uppercase">
                              Ownership
                            </span>
                          </div>
                          <span
                            className="truncate text-sm font-bold text-white"
                            title={ownershipStatus}
                          >
                            {ownershipStatus}
                          </span>
                        </div>
                      );
                    }

                    if (specs.length === 0) return null;

                    const gridColsClass =
                      specs.length === 1
                        ? 'grid-cols-1'
                        : specs.length === 2
                          ? 'grid-cols-2'
                          : specs.length === 3
                            ? 'grid-cols-2 sm:grid-cols-3'
                            : 'grid-cols-2 sm:grid-cols-4';

                    return (
                      <div className={`grid ${gridColsClass} gap-3`}>
                        {specs}
                      </div>
                    );
                  })()}

                  {/* 4. GOOGLE MAPS DEEP LINK CARD */}
                  <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 text-primary shrink-0 rounded-lg p-3">
                        <MapPin className="size-5" />
                      </div>
                      <div>
                        <h5 className="text-sm font-semibold text-white">
                          Google Maps Location
                        </h5>
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-slate-400 md:max-w-md"
                          title={googleMapLink || address || property?.location}
                        >
                          {googleMapLink
                            ? 'Click below to launch maps'
                            : address ||
                              property?.location ||
                              'No coordinates added'}
                        </p>
                      </div>
                    </div>
                    {googleMapLink ? (
                      <a
                        href={googleMapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-primary hover:bg-primary/95 text-primary-foreground inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors"
                      >
                        <span>Open in Google Maps</span>
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : property?.location_guarded ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 select-none">
                        <Lock className="size-3.5" />
                        Exact location restricted
                      </span>
                    ) : (
                      <span className="border-slate-850 rounded-lg border bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-500 select-none">
                        No Map Link Available
                      </span>
                    )}
                  </div>

                  {/* 5. ABOUT DESCRIPTION */}
                  {description && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        About this property
                      </h4>
                      <div className="border-slate-850 rounded-xl border bg-slate-950/15 p-4 text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
                        {description}
                      </div>
                    </div>
                  )}

                  {/* INTERNAL NOTES (Engine-only) */}
                  {notes && (
                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-400/80 uppercase">
                        <span>Internal Notes</span>
                        <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-500">
                          Engine Only
                        </span>
                      </h4>
                      <div className="rounded-xl border border-amber-900/30 bg-amber-950/10 p-4 text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
                        {notes}
                      </div>
                    </div>
                  )}

                  {/* TAGS (Engine-only) */}
                  {tags.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-400/80 uppercase">
                        <span>Tags</span>
                        <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-500">
                          Engine Only
                        </span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag, idx) => (
                          <span
                            key={`${tag}-${idx}`}
                            className="bg-primary/15 border-primary/25 text-primary inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                          >
                            <Tag className="size-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 6. EXTENDED SPECS AND METADATA */}
                  {((!isLand && superBuiltArea) ||
                    (!isApartment &&
                      (frontage || depth || dimensions || roadWidth)) ||
                    (hasCommercialFields && (landZone || idealFor)) ||
                    (hasCommercialBuildingFields && rentalIncome)) && (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        Listing Metadata
                      </h4>
                      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/10 text-xs">
                        <div className="divide-slate-850 border-slate-850 grid grid-cols-2 divide-x border-b bg-slate-950/20">
                          {!isLand && superBuiltArea && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Super Built Area
                              </span>
                              <span className="font-bold text-white">
                                {Number(superBuiltArea).toLocaleString('en-IN')}{' '}
                                Sq.Ft.
                              </span>
                            </div>
                          )}
                          {!isApartment && dimensions && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Dimensions
                              </span>
                              <span className="font-bold text-white">
                                {dimensions}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="divide-slate-850 border-slate-850 grid grid-cols-2 divide-x border-b bg-slate-950/20">
                          {!isApartment && frontage && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Frontage
                              </span>
                              <span className="font-bold text-white">
                                {frontage} Feet
                              </span>
                            </div>
                          )}
                          {!isApartment && depth && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Depth
                              </span>
                              <span className="font-bold text-white">
                                {depth} Feet
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="divide-slate-850 border-slate-850 grid grid-cols-2 divide-x border-b bg-slate-950/20">
                          {!isApartment && roadWidth && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Road Width
                              </span>
                              <span className="font-bold text-white">
                                {roadWidth} {roadWidthUnit}
                              </span>
                            </div>
                          )}
                          {hasCommercialFields && landZone && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Land Zone
                              </span>
                              <span className="font-bold text-white">
                                {landZone}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="divide-slate-850 grid grid-cols-2 divide-x bg-slate-950/20">
                          {hasCommercialFields && idealFor && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Ideal For
                              </span>
                              <span
                                className="max-w-[150px] truncate font-bold text-white"
                                title={idealFor}
                              >
                                {idealFor}
                              </span>
                            </div>
                          )}
                          {hasCommercialBuildingFields && rentalIncome && (
                            <div className="flex justify-between gap-2 p-3">
                              <span className="text-slate-450 font-medium">
                                Rental Income
                              </span>
                              <span className="font-bold text-emerald-400">
                                {formatCurrency(Number(rentalIncome), currency)}
                                {roiValue !== null && (
                                  <span className="text-primary ml-1.5 text-[10px] font-semibold">
                                    ({roiValue}% Yield)
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* FLOOR PLANS */}
                  {floorPlans.some((fp) => fp.image) && (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        {isLand ? 'Land Sketches' : 'Floor Plans'}
                      </h4>
                      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                        {floorPlans
                          .filter((fp) => fp.image)
                          .map((fp, idx) => (
                            <a
                              key={idx}
                              href={storagePublicUrl(fp.image)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/20 transition-colors hover:border-slate-700"
                            >
                              <div className="relative aspect-[4/3] bg-white">
                                {isPlanPdf(fp.image) ? (
                                  <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-100 text-rose-600">
                                    <FileText className="size-9" />
                                    <span className="text-[11px] font-bold">
                                      Open PDF
                                    </span>
                                  </div>
                                ) : (
                                  <NextImage
                                    src={storagePublicUrl(fp.image)}
                                    alt={
                                      fp.floor ||
                                      `${isLand ? 'Land sketch' : 'Floor plan'} ${idx + 1}`
                                    }
                                    fill
                                    sizes="(max-width: 768px) 50vw, 33vw"
                                    className="object-contain"
                                  />
                                )}
                              </div>
                              <div className="p-2">
                                <p className="truncate text-xs font-bold text-white">
                                  {fp.floor ||
                                    `${isLand ? 'Sketch' : 'Floor'} ${idx + 1}`}
                                </p>
                                <p className="text-slate-450 truncate text-[10px]">
                                  {[
                                    fp.area_sqft
                                      ? `${Number(fp.area_sqft).toLocaleString('en-IN')} Sq.Ft.`
                                      : '',
                                    fp.notes,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') ||
                                    (isLand ? 'Sketch' : 'Plan')}
                                </p>
                              </div>
                            </a>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* FLOOR-WISE RENT ROLL (pre-leased commercial) */}
                  {hasCommercialBuildingFields && floorTenancies.length > 0 && (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        Floor-wise Tenancy (Rent Roll)
                      </h4>
                      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/10">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-slate-850 text-slate-450 border-b bg-slate-950/30 text-left">
                              <th className="p-2.5 font-semibold">
                                Floor(s) / Unit(s)
                              </th>
                              <th className="p-2.5 font-semibold">Tenant</th>
                              <th className="p-2.5 text-right font-semibold">
                                Area (Sq.Ft.)
                              </th>
                              <th className="p-2.5 text-right font-semibold">
                                Rent (excl. GST)
                              </th>
                              <th className="p-2.5 text-right font-semibold">
                                Advance
                              </th>
                              <th className="p-2.5 font-semibold">Lease</th>
                              <th className="p-2.5 text-right font-semibold">
                                Lock-in
                              </th>
                              <th className="p-2.5 font-semibold">
                                Maintenance
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-slate-850 divide-y">
                            {floorTenancies.map((ft, idx) => (
                              <tr key={idx} className="text-slate-200">
                                <td className="p-2.5 font-bold text-white">
                                  {ft.floor || `Tenancy ${idx + 1}`}
                                  {ft.notes && (
                                    <p className="text-slate-450 mt-0.5 text-[10px] font-medium">
                                      {ft.notes}
                                    </p>
                                  )}
                                </td>
                                <td className="p-2.5">
                                  {ft.tenant_name || '—'}
                                </td>
                                <td className="p-2.5 text-right">
                                  {ft.area_sqft
                                    ? Number(ft.area_sqft).toLocaleString(
                                        'en-IN'
                                      )
                                    : '—'}
                                </td>
                                <td className="p-2.5 text-right font-bold text-emerald-400">
                                  {ft.monthly_rent
                                    ? formatCurrency(
                                        Number(ft.monthly_rent),
                                        currency
                                      )
                                    : '—'}
                                </td>
                                <td className="p-2.5 text-right font-semibold text-slate-100">
                                  {ft.advance
                                    ? formatCurrency(
                                        Number(ft.advance),
                                        currency
                                      )
                                    : '—'}
                                </td>
                                <td className="p-2.5 whitespace-nowrap">
                                  {ft.lease_start || ft.lease_end
                                    ? `${ft.lease_start || '…'} → ${ft.lease_end || '…'}`
                                    : '—'}
                                </td>
                                <td className="p-2.5 text-right">
                                  {ft.lock_in_months
                                    ? `${ft.lock_in_months} mo`
                                    : '—'}
                                </td>
                                <td className="p-2.5">
                                  {ft.maintenance || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {(floorRentTotal > 0 || floorAdvanceTotal > 0) && (
                            <tfoot>
                              <tr className="border-slate-850 border-t bg-slate-950/30">
                                <td
                                  className="p-2.5 font-bold text-white"
                                  colSpan={3}
                                >
                                  Consolidated total
                                </td>
                                <td className="text-primary p-2.5 text-right font-black">
                                  {floorRentTotal > 0
                                    ? formatCurrency(floorRentTotal, currency)
                                    : '—'}
                                </td>
                                <td className="text-primary p-2.5 text-right font-black">
                                  {floorAdvanceTotal > 0
                                    ? formatCurrency(
                                        floorAdvanceTotal,
                                        currency
                                      )
                                    : '—'}
                                </td>
                                <td
                                  className="text-slate-450 p-2.5 text-[10px]"
                                  colSpan={3}
                                >
                                  rent excluding GST
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  )}

                  {/* 7. NEARBY LANDMARKS */}
                  {nearbyHighlights && nearbyHighlights.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        Nearby Landmarks
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {nearbyHighlights.map((hl, idx) => {
                          const highlightIcons: Record<string, string> = {
                            School: '🏫',
                            Hospital: '🏥',
                            'Metro Station': '🚇',
                            Mall: '🛍️',
                            Airport: '✈️',
                            Highway: '🛣️',
                            'Railway Station': '🚉',
                            'Bus Stop': '🚏',
                            Park: '🌳',
                            Supermarket: '🛒',
                            'Bank / ATM': '🏦',
                          };
                          return (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="flex items-center gap-1.5 rounded-full border-slate-800 bg-slate-950/30 px-3 py-1 text-xs font-medium text-slate-200"
                            >
                              <span>{highlightIcons[hl] || '📍'}</span>
                              <span>{hl}</span>
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 8. AMENITIES & FEATURES */}
                  {features && features.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        Amenities & Features
                      </h4>
                      <div className="border-slate-850 grid grid-cols-2 gap-2 rounded-xl border bg-slate-950/15 p-4">
                        {features.map((feature, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 text-xs font-medium text-slate-200"
                          >
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                            <span>{feature}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 9. OWNER DETAILS */}
                  {(() => {
                    const owner =
                      property?.owner ||
                      contacts.find((c) => c.id === ownerContactId);
                    if (!owner || !property) return null;
                    return (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                          {property.listing_source === 'agent'
                            ? 'Agent Contact Info'
                            : 'Owner Contact Info'}
                        </h4>
                        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/20 p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-sm font-semibold text-slate-200">
                              👤
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  {owner.name || 'Unnamed Owner'}
                                </span>
                                <NameTagBadge tag={owner.name_tag} />
                                <Badge className="border border-slate-800 bg-slate-950 px-1.5 py-0 text-[9px] text-slate-400">
                                  {owner.classification || 'Owner'}
                                </Badge>
                              </div>
                              <p className="mt-0.5 font-mono text-xs text-slate-400">
                                {contactHandle(owner)}
                              </p>
                            </div>
                          </div>
                          {hasPhone(owner) && (
                            <a
                              href={propertyAvailabilityWhatsAppUrl(
                                owner.phone,
                                property,
                                owner.name
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-900"
                            >
                              <span>Check availability</span>
                              <span className="text-emerald-400">●</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Property Documents */}
                  {documents &&
                    documents.filter(
                      (doc) => doc && doc.url && doc.url.trim().length > 0
                    ).length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                            Property Documents
                          </h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setShareDocDialogOpen(true)}
                            className="text-primary hover:text-primary/80 border-primary/25 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-[10px] font-bold hover:bg-slate-800/40"
                          >
                            <Send className="size-3" />
                            Share Documents Link
                          </Button>
                        </div>
                        <div className="border-slate-850 grid grid-cols-1 gap-2 rounded-xl border bg-slate-950/15 p-4 sm:grid-cols-2">
                          {documents
                            .filter(
                              (doc) =>
                                doc && doc.url && doc.url.trim().length > 0
                            )
                            .map((doc, idx) => {
                              const docUrl = doc.url;
                              const filename =
                                docUrl.split('/').pop()?.split('?')[0] ||
                                `document-${idx + 1}`;
                              const decodedFilename =
                                decodeURIComponent(filename);
                              const cleanName = decodedFilename
                                .replace(
                                  /^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/,
                                  ''
                                )
                                .replace(
                                  /^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-/,
                                  ''
                                );
                              const displayTitle =
                                doc.title?.trim() ||
                                cleanName ||
                                `Document ${idx + 1}`;
                              return (
                                <a
                                  key={idx}
                                  href={storagePublicUrl(docUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-950"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="shrink-0 text-lg">📄</span>
                                    <span
                                      className="truncate font-semibold text-slate-300"
                                      title={displayTitle}
                                    >
                                      {displayTitle}
                                    </span>
                                  </div>
                                  <ExternalLink className="size-3.5 shrink-0 text-slate-500 hover:text-white" />
                                </a>
                              );
                            })}
                        </div>
                      </div>
                    )}

                  <PropertyRequestsPanels
                    property={property}
                    refreshKey={docRequestsRefreshKey}
                  />

                  {/* 10. ACTION FOOTER */}
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                    <div className="ml-auto flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="text-slate-350 border-slate-700 hover:bg-slate-800"
                      >
                        Close Details
                      </Button>
                      {canEdit && (
                        <Button
                          type="button"
                          onClick={() => setViewMode(false)}
                          className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 font-semibold"
                        >
                          <Edit className="size-4" />
                          Edit Listing
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="relative space-y-5 lg:pl-48"
                >
                  <div className="absolute inset-y-0 left-0 hidden w-40 lg:block">
                    <PropertyFormSectionNav sections={formSections} />
                  </div>
                  {/* Main Info */}
                  <BasicsSection
                    values={values}
                    set={set}
                    isEdit={isEdit}
                    property={property}
                  />

                  {/* Autocomplete Real Location Details */}
                  <LocationSection
                    values={values}
                    set={set}
                    autocompleteRef={autocompleteRef}
                    ensureLocalitiesLoaded={ensureLocalitiesLoaded}
                    handleSearchQueryChange={handleSearchQueryChange}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    searchingProjects={searchingProjects}
                    filteredProjects={filteredProjects}
                    filteredSublocalities={filteredSublocalities}
                    googleSuggestions={googleSuggestions}
                    handleGooglePick={handleGooglePick}
                    isProjectMatched={isProjectMatched}
                    mapPinDrift={mapPinDrift}
                    guardedByType={guardedByType}
                    locationGuarded={locationGuarded}
                    tagInput={tagInput}
                    setTagInput={setTagInput}
                    tagSuggestions={tagSuggestions}
                    hasCommercialFields={hasCommercialFields}
                    hasCommercialBuildingFields={hasCommercialBuildingFields}
                    roiValue={roiValue}
                  />

                  {/* Floor-wise Tenancy (Rent Roll) — pre-leased commercial
                    buildings under sale: tenant, rent (excl. GST), lease
                    window, lock-in and maintenance per floor. */}
                  {hasCommercialBuildingFields && (
                    <TenancySection
                      values={values}
                      set={set}
                      uploadPlanImage={uploadPlanImage}
                      canEdit={canEdit}
                      currency={currency}
                      floorRentTotal={floorRentTotal}
                      floorAdvanceTotal={floorAdvanceTotal}
                    />
                  )}

                  {/* Area & Specification Fields */}
                  <SpecsSection
                    values={values}
                    set={set}
                    hasBedsBaths={hasBedsBaths}
                    hasCommercialFields={hasCommercialFields}
                    isLand={isLand}
                    isRawLand={isRawLand}
                    isApartment={isApartment}
                    showFloorNumber={showFloorNumber}
                    showTotalFloors={showTotalFloors}
                    handleLandAreaChange={handleLandAreaChange}
                    handleFrontageChange={handleFrontageChange}
                    handleDepthChange={handleDepthChange}
                    media={
                      <MediaSection
                        values={values}
                        set={set}
                        property={property}
                        accountId={accountId}
                        supabase={supabase}
                        canEdit={canEdit}
                        isLand={isLand}
                        uploadPlanImage={uploadPlanImage}
                        readingEKhata={readingEKhata}
                        eKhataInputRef={eKhataInputRef}
                        onReadEKhata={onReadEKhata}
                        lockingImagePath={lockingImagePath}
                        setLockingImagePath={setLockingImagePath}
                        removingVideo={removingVideo}
                        setRemovingVideo={setRemovingVideo}
                        uploadingDocument={uploadingDocument}
                        setUploadingDocument={setUploadingDocument}
                        uploadingImage={uploadingImage}
                        setUploadingImage={setUploadingImage}
                      />
                    }
                  />

                  {/* Description */}
                  <DescriptionSection
                    values={values}
                    set={set}
                    isLand={isLand}
                    locationGuarded={locationGuarded}
                    generatingDescription={generatingDescription}
                    setGeneratingDescription={setGeneratingDescription}
                  />

                  {/* Owner & Leads */}
                  <OwnerSection
                    values={values}
                    set={set}
                    contacts={contacts}
                    contactedContactIds={contactedContactIds}
                    ownerSearchInput={ownerSearchInput}
                    setOwnerSearchInput={setOwnerSearchInput}
                    handleGoToChat={handleGoToChat}
                  />

                  <div
                    id="pf-publish"
                    className="sticky -bottom-4 z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-6 py-3 lg:-ml-[13.5rem]"
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        id="prop-published"
                        checked={isPublished}
                        onCheckedChange={(checked) =>
                          set('isPublished', checked)
                        }
                      />
                      <Label
                        htmlFor="prop-published"
                        className="cursor-pointer text-sm text-slate-300"
                      >
                        Publish / Visible on Listing Page
                      </Label>
                    </div>
                    <div className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                        className="text-slate-350 border-slate-700 hover:bg-slate-800"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={saving}
                        className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 font-semibold"
                      >
                        {saving && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        {isEdit ? 'Save Changes' : 'Create Listing'}
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </TabsContent>

            <PropertyEnquiriesTab
              property={property}
              enquiredContacts={enquiredContacts}
              loadingListingAudience={loadingListingAudience}
              listingAudienceError={listingAudienceError}
              fetchListingEnquiries={fetchListingEnquiries}
            />

            <PropertyMatchesTab
              open={open}
              onOpenChange={onOpenChange}
              property={property}
              onSaved={onSaved}
              setActiveTab={setActiveTab}
              contacts={contacts}
              loadingContacts={loadingContacts}
              matchedContacts={matchedContacts}
              displayedMatches={displayedMatches}
              matchAudience={matchAudience}
              setMatchAudience={setMatchAudience}
              currency={currency}
              showcaseSubdomain={showcaseSubdomain}
              title={title}
              price={price}
              address={address}
              sublocality={sublocality}
              city={city}
              stateVal={stateVal}
              isLand={isLand}
              landArea={landArea}
              landAreaUnit={landAreaUnit}
              areaSqft={areaSqft}
              areaUnit={areaUnit}
              googleMapLink={googleMapLink}
              nearbyHighlights={nearbyHighlights}
              features={features}
              images={images}
            />
          </div>
        </Tabs>
        {/* Share Document Portal Modal */}
        <Dialog
          open={duplicateCandidates.length > 0}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !saving) {
              setDuplicateCandidates([]);
              setPendingCreatePayload(null);
            }
          }}
        >
          <DialogContent className="max-w-xl border-amber-500/30 bg-slate-950 text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-400" />
                Possible duplicate listing
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                The new map pin is within 100 metres of existing inventory.
                Review these listings before creating another one.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
              {duplicateCandidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {candidate.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {candidate.property_code || 'Existing listing'} ·{' '}
                        {candidate.distanceMeters} m away
                      </p>
                    </div>
                    <Badge
                      className={
                        candidate.confidence === 'high'
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : candidate.confidence === 'possible'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                      }
                    >
                      {candidate.confidence === 'high'
                        ? 'High probability'
                        : candidate.confidence === 'possible'
                          ? 'Possible duplicate'
                          : 'Nearby property'}
                    </Badge>
                  </div>
                  {candidate.location && (
                    <p className="mt-2 text-xs text-slate-500">
                      {candidate.location}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.signals.map((signal) => (
                      <span
                        key={signal}
                        className="rounded bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-300"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                  <a
                    href={`/inventory?propertyId=${encodeURIComponent(candidate.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary mt-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                  >
                    <ExternalLink className="size-3" /> Review listing
                  </a>
                </div>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDuplicateCandidates([]);
                  setPendingCreatePayload(null);
                }}
                className="border-slate-700 text-slate-300"
              >
                Go back and compare
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={createNearbyListingAnyway}
              >
                {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Confirm separate property
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <EKhataReviewDialog
          open={eKhataReview !== null}
          changes={eKhataReview?.changes ?? []}
          notes={eKhataReview ? eKhataNotes(eKhataReview.fields) : []}
          onApply={applyEKhata}
          onClose={() => setEKhataReview(null)}
        />

        <ShareDocumentsDialog
          open={shareDocDialogOpen}
          onOpenChange={setShareDocDialogOpen}
          property={property}
          contacts={contacts}
          onShared={() => setDocRequestsRefreshKey((key) => key + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}
