'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import NextImage from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { resolveConversation } from '@/lib/conversations/resolve';
import { storagePublicUrl } from '@/lib/storage/url';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { PropertyBlueprintLoader } from '@/components/ui/property-blueprint-loader';
import { PriceHint } from '@/components/ui/price-hint';
import {
  Loader2,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  Send,
  Star,
  MessageSquare,
  Search,
  X,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  ExternalLink,
  Lock,
  Unlock,
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
import { ListingVideoCard } from '@/components/inventory/listing-video-card';
import { LearningPanel } from '@/components/inventory/learning-panel';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { formatCurrency } from '@/lib/currency-utils';
import { formatAuditDateTime } from '@/lib/audit-timestamps';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { useTopupModal } from '@/components/layout/topup-modal-context';
import type { Contact } from '@/types';
import {
  POPULAR_PROJECTS,
  POPULAR_SUBLOCALITIES,
} from '@/lib/data/real-estate-data';
import {
  AMENITIES_BY_CATEGORY,
  NEARBY_HIGHLIGHTS_OPTIONS,
  FACING_DIRECTIONS,
  FURNISHING_OPTIONS,
  FLOORING_OPTIONS,
  POWER_BACKUP_OPTIONS,
  AREA_UNITS,
  SQFT_PER_AREA_UNIT,
  PROPERTY_STATUSES,
  LAND_OWNERSHIP_TYPES,
  LAND_LEGAL_STATUSES,
  LAND_CONVERSION_TYPES,
  propertyTypeGroupsFor,
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
  emptyFloorTenancy,
  emptyPropertyFormValues,
  propertyToFormValues,
  validatePropertyForm,
  type FloorTenancyDraft,
} from '@/lib/inventory/property-form-state';
import { usePropertyForm } from '@/hooks/usePropertyForm';
import {
  looksLikeDocument,
  orderForCover,
  samplePixels,
} from '@/lib/inventory/cover-photo';
import { FloorPlansEditor } from '@/components/inventory/floor-plans-editor';
import { isPlanPdf, PLAN_IMAGE_MIME_TYPES } from '@/lib/inventory/floor-plans';
import {
  isGuardedType,
  isLocationGuarded,
} from '@/lib/inventory/location-guard';
import { rentalYieldPercent, yieldApplies } from '@/lib/inventory/rental-yield';
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

function compressImageOnClient(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 1200;
      let w = img.width;
      let h = img.height;

      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Compression failed'))),
        'image/jpeg',
        0.75
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

function isDocumentImage(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(false);
          return;
        }
        ctx.drawImage(img, 0, 0, 48, 48);
        resolve(
          looksLikeDocument(samplePixels(ctx.getImageData(0, 0, 48, 48).data))
        );
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
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
    soldPrice,
    sellerFinalPrice,
    sellerFinalPricePerSqft,
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
    btsEscalationPercent,
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
    landUseZoning,
    legalStatus,
    conversionType,
    dealRemarks,
    dimensions,
    roadWidth,
    roadWidthUnit,
    facingDirection,
    khataEpid,
    khataForm,
    yearBuilt,
    furnishing,
    possessionDate,
    floorNumber,
    totalFloors,
    balconies,
    flooring,
    powerBackup,
    isPublished,
    features,
    nearbyHighlights,
    images,
    privateImages,
    defaultImageIndex,
    videoRemoved,
    documents,
    googleMapLink,
    locationPrivacy,
    showcaseVisibility,
    notes,
    tags,
    rentalIncome,
    floorTenancies,
    floorPlans,
    ownerContactId,
    listingSource,
    interestedContactIds,
    searchQuery,
  } = values;
  const [readingEKhata, setReadingEKhata] = useState(false);
  const [eKhataReview, setEKhataReview] = useState<{
    fields: EKhataFields;
    changes: EKhataChange[];
  } | null>(null);
  const [lockingImagePath, setLockingImagePath] = useState<string | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
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

  const tenancyPlanInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const updateFloorTenancy = (
    idx: number,
    key: keyof FloorTenancyDraft,
    value: string
  ) => {
    set('floorTenancies', (prev) =>
      prev.map((ft, i) => (i === idx ? { ...ft, [key]: value } : ft))
    );
  };
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

  interface AutoCompleteProject {
    name: string;
    sublocality: string;
    city: string;
    state: string;
    address: string;
    source?: 'rera' | 'curated' | 'ai' | null;
  }

  const [fetchedProjects, setFetchedProjects] = useState<AutoCompleteProject[]>(
    []
  );
  const [searchingProjects, setSearchingProjects] = useState(false);

  const [saving, setSaving] = useState(false);
  const [contactedContactIds, setContactedContactIds] = useState<Set<string>>(
    new Set()
  );
  const [contactSearchInput, setContactSearchInput] = useState('');
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const [ownerSearchInput, setOwnerSearchInput] = useState('');
  const [isOwnerDropdownOpen, setIsOwnerDropdownOpen] = useState(false);

  // Close owner dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-owner-dropdown]')) {
        setIsOwnerDropdownOpen(false);
      }
    }
    if (isOwnerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOwnerDropdownOpen]);

  // Helper classifications based on selected type
  const hasBedsBaths = typeHasBedsBaths(type);
  const hasCommercialFields = typeHasCommercialFields(type);
  const hasCommercialBuildingFields = typeHasCommercialBuildingFields(type);
  const isLand = isLandType(type);
  const isRawLand = isRawLandType(type);
  const isApartment = isApartmentType(type);
  const showFloorNumber = hasUnitFloor(type);
  const showTotalFloors = hasTotalFloors(type);
  const propertyTypeGroups = propertyTypeGroupsFor(type);
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);

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

  function handleToggleFeature(feature: string) {
    set('features', (prev) =>
      prev.includes(feature)
        ? prev.filter((f) => f !== feature)
        : [...prev, feature]
    );
  }

  function handleToggleHighlight(highlight: string) {
    set('nearbyHighlights', (prev) =>
      prev.includes(highlight)
        ? prev.filter((h) => h !== highlight)
        : [...prev, highlight]
    );
  }

  async function handleGenerateAIDescription() {
    if (!title.trim()) {
      toast.error('Please enter a Property Title first');
      return;
    }
    setGeneratingDescription(true);
    try {
      const response = await fetch('/api/ai/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          type,
          location:
            [
              locationGuarded ? '' : address.trim(),
              sublocality.trim(),
              city.trim(),
              stateVal.trim(),
            ]
              .filter(Boolean)
              .join(', ') || null,
          bedrooms: bedrooms.trim() ? Number(bedrooms) : null,
          bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
          area: isLand
            ? landArea.trim()
              ? Number(landArea)
              : null
            : areaSqft.trim()
              ? Number(areaSqft)
              : null,
          areaUnit: isLand ? landAreaUnit : areaUnit,
          frontage: frontage.trim() || null,
          depth: depth.trim() || null,
          features,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 402) {
          if (
            errData.upgradeRequired &&
            typeof errData.upgradeRequired === 'string'
          ) {
            toast.error(
              errData.error || 'AI features require a plan upgrade.',
              {
                action: {
                  label: 'Upgrade plan',
                  onClick: () => router.push('/settings?tab=billing'),
                },
              }
            );
          } else {
            toast.error(
              errData.error || `You've used all your credits for this month.`,
              {
                action: { label: 'Buy credits', onClick: openTopupModal },
              }
            );
          }
          return;
        }
        throw new Error(errData.error || 'Failed to generate description');
      }

      const data = await response.json();
      set('description', data.description || '');
      toast.success('Description generated successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to generate description');
    } finally {
      setGeneratingDescription(false);
    }
  }

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
  const contactSearchRef = useRef<HTMLDivElement>(null);

  // Close autocomplete and contact dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
      if (
        contactSearchRef.current &&
        !contactSearchRef.current.contains(event.target as Node)
      ) {
        setIsContactDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const contactSearchResults = useMemo(() => {
    if (!contactSearchInput.trim()) return [];
    const query = contactSearchInput.toLowerCase();
    return contacts.filter((c) => {
      if (c.classification !== 'Buyer' && c.classification !== 'Agent')
        return false;
      if (interestedContactIds.includes(c.id)) return false;
      // The share goes out over WhatsApp — an email-only contact has
      // nowhere to receive it.
      if (!hasPhone(c)) return false;
      return (
        (c.name || '').toLowerCase().includes(query) ||
        (c.phone ?? '').toLowerCase().includes(query) ||
        (c.email || '').toLowerCase().includes(query)
      );
    });
  }, [contacts, contactSearchInput, interestedContactIds]);

  const interestedContacts = useMemo(() => {
    return contacts.filter((c) => interestedContactIds.includes(c.id));
  }, [contacts, interestedContactIds]);

  const handleAddInterestedContact = (contactId: string) => {
    if (!interestedContactIds.includes(contactId)) {
      set('interestedContactIds', (prev) => [...prev, contactId]);
    }
    setContactSearchInput('');
    setIsContactDropdownOpen(false);
  };

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

  const filteredAmenities = useMemo(() => {
    if (isLand) {
      return {
        'Land Specifications': [
          'Fenced Boundary',
          'Access Road',
          'Electricity Connection',
          'Water Supply (Borewell)',
          'Rain Water Harvesting',
          'CCTV Surveillance',
          '24/7 Security',
        ],
      };
    }
    if (hasCommercialFields) {
      return {
        'Commercial Specifications': [
          'Centrally Air Conditioned',
          'Conference Room',
          'Cafeteria/Food Court',
          'Wi-Fi Connectivity',
          'ATM',
          'Service/Goods Lift',
        ],
        'Utilities & Security': [
          '24/7 Security',
          'CCTV Surveillance',
          'Power Backup',
          'Fire Fighting System',
          'Lift/Elevator',
          'Reserved Parking',
          'Visitor Parking',
          'Waste Disposal',
        ],
      };
    }
    // Default Residential
    return {
      'Security & Utilities': AMENITIES_BY_CATEGORY['Security & Utilities'],
      'Leisure & Community': AMENITIES_BY_CATEGORY['Leisure & Community'],
    };
  }, [isLand, hasCommercialFields]);

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

  async function onUploadImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingImage(true);
    const uploaded: { url: string; document: boolean }[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 5MB limit
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large. Max size is 5MB.`);
          continue;
        }

        // Compress image before upload
        let uploadFile: File | Blob = file;
        if (
          file.type.startsWith('image/') &&
          file.type !== 'image/svg+xml' &&
          file.type !== 'image/gif'
        ) {
          try {
            uploadFile = await compressImageOnClient(file);
          } catch {
            // Fallback to original if compression fails
          }
        }

        const ext = 'jpg';
        const randomStr = Math.random().toString(36).substring(2, 7);
        // Scoped by account ID folder
        const path = `${accountId}/img-${Date.now()}-${randomStr}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(path, uploadFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'image/jpeg',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploaded.push({
          url: `property-images/${path}`,
          document: await isDocumentImage(uploadFile),
        });
      }

      if (uploaded.length > 0) {
        const uploadedUrls = orderForCover(uploaded, (u) => u.document).map(
          (u) => u.url
        );
        const documents = uploaded.filter((u) => u.document).length;
        set('images', (prev) => {
          const filteredPrev = prev.filter((url) => url.trim().length > 0);
          return [...filteredPrev, ...uploadedUrls];
        });
        toast.success(
          documents > 0
            ? `Uploaded ${uploaded.length} image(s) — ${documents} look${documents === 1 ? 's' : ''} like a document and ${documents === 1 ? 'was' : 'were'} placed after the photos`
            : `Uploaded ${uploaded.length} image(s)`
        );
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Image upload failed';
      toast.error(message);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  async function onUploadDocuments(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingDocument(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > DOCUMENT_SIZE_LIMIT) {
          const mb = (file.size / (1024 * 1024)).toFixed(1);
          toast.error(
            `File "${file.name}" is ${mb}MB. Max size is ${Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024))}MB.`
          );
          continue;
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
        const randomStr = Math.random().toString(36).substring(2, 7);
        // Scoped by account ID folder
        const path = `${accountId}/doc-${Date.now()}-${randomStr}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('property-documents')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploadedUrls.push(`property-documents/${path}`);
      }

      if (uploadedUrls.length > 0) {
        const newDocs = uploadedUrls.map((url) => {
          const filename = url.split('/').pop()?.split('?')[0] || '';
          const decoded = decodeURIComponent(filename);
          const cleanName = decoded
            .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/, '')
            .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-/, '')
            .split('.')
            .slice(0, -1)
            .join('.');
          return { url, title: cleanName };
        });

        set('documents', (prev) => {
          const filteredPrev = prev
            .filter((doc) => {
              const url = typeof doc === 'string' ? doc : doc?.url;
              return url && url.trim().length > 0;
            })
            .map((doc) => {
              if (typeof doc === 'string') return { url: doc, title: '' };
              return doc;
            });
          return [...filteredPrev, ...newDocs];
        });
        toast.success(`Uploaded ${uploadedUrls.length} document(s)`);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Document upload failed';
      toast.error(message);
    } finally {
      setUploadingDocument(false);
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  }

  function handleAddDocumentUrl() {
    set('documents', (prev) => [...prev, { url: '', title: '' }]);
  }

  // Close owner dropdown on click outside helper

  function handleRemoveDocumentUrl(index: number) {
    if (documents.length === 1) {
      set('documents', [{ url: '', title: '' }]);
    } else {
      set('documents', (prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleDocumentUrlChange(index: number, value: string) {
    set('documents', (prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (typeof target === 'string') {
        copy[index] = { url: value, title: '' };
      } else {
        copy[index] = { ...target, url: value };
      }
      return copy;
    });
  }

  function handleDocumentTitleChange(index: number, value: string) {
    set('documents', (prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (typeof target === 'string') {
        copy[index] = { url: '', title: value };
      } else {
        copy[index] = { ...target, title: value };
      }
      return copy;
    });
  }

  function handleAddImageUrl() {
    set('images', (prev) => [...prev, '']);
  }

  function handleRemoveImageUrl(index: number) {
    if (images.length === 1) {
      set('images', ['']);
    } else {
      set('images', (prev) => prev.filter((_, i) => i !== index));
    }
  }

  // Handle owner selection with auto-detection of listing source
  function handleOwnerSelect(contactId: string | null) {
    set('ownerContactId', contactId);
    setIsOwnerDropdownOpen(false);

    // Set search input to display the selected contact's name
    if (contactId) {
      const selectedContact = contacts.find((c) => c.id === contactId);
      if (selectedContact) {
        setOwnerSearchInput(
          selectedContact.name || selectedContact.phone || ''
        );
        // Auto-detect listing source based on selected contact's classification
        const classification =
          selectedContact.classification?.toLowerCase() || '';
        if (classification === 'agent') {
          set('listingSource', 'agent');
        } else {
          set('listingSource', 'owner');
        }
      }
    } else {
      setOwnerSearchInput('');
    }
  }

  // Filter contacts for owner search
  const filteredOwnerContacts = useMemo(() => {
    if (!ownerSearchInput.trim()) return contacts;
    const query = ownerSearchInput.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.phone?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query)
    );
  }, [contacts, ownerSearchInput]);

  function handleImageUrlChange(index: number, value: string) {
    set('images', (prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  }

  function handleSetDefaultImage(index: number) {
    set('defaultImageIndex', index);
    toast.success('Selected image set as default listing photo');
  }

  async function handleToggleImageLock(
    path: string,
    action: 'lock' | 'unlock'
  ) {
    if (!property?.id || lockingImagePath) return;
    setLockingImagePath(path);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/private-images`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, action }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update photo privacy');
      }
      set('images', data.data.images.length > 0 ? data.data.images : ['']);
      set('privateImages', data.data.private_images || []);
      toast.success(
        action === 'lock'
          ? 'Photo moved to private — revealed only on approved requests'
          : 'Photo is public again'
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update photo privacy'
      );
    } finally {
      setLockingImagePath(null);
    }
  }

  async function handleRemoveVideo() {
    if (!property?.id || removingVideo) return;
    setRemovingVideo(true);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/generate-video`,
        {
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to remove the video');
      }
      set('videoRemoved', true);
      toast.success(
        'Listing video removed — it no longer plays in the Showcase'
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove the video'
      );
    } finally {
      setRemovingVideo(false);
    }
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
                  <div
                    id="pf-basics"
                    className="grid scroll-mt-2 grid-cols-2 gap-4"
                  >
                    {isEdit && property?.property_code && (
                      <div className="animate-fade-in col-span-2 space-y-1.5">
                        <Label className="text-slate-400">
                          Property Code (Unique ID)
                        </Label>
                        <Input
                          value={property.property_code}
                          readOnly
                          className="bg-slate-850 cursor-not-allowed border-slate-800 font-mono text-slate-400 select-all"
                        />
                      </div>
                    )}

                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="prop-title" className="text-slate-300">
                        Property Title <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="prop-title"
                        value={title}
                        onChange={(e) => set('title', e.target.value)}
                        placeholder="e.g. Luxurious 3BHK Apartment in Downtown"
                        className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                        required
                      />
                    </div>

                    <div className="animate-fade-in space-y-1.5">
                      <Label
                        htmlFor="prop-listing-type"
                        className="text-slate-300"
                      >
                        Listing Type
                      </Label>
                      <select
                        id="prop-listing-type"
                        value={listingType}
                        onChange={(e) =>
                          set(
                            'listingType',
                            e.target.value as
                              'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit'
                          )
                        }
                        className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                      >
                        <option value="Sale">For Sale</option>
                        <option value="Rent">For Rent</option>
                        <option value="JV/JD">JV / Joint Development</option>
                        <option value="Built to Suit">Built to Suit</option>
                      </select>
                    </div>

                    {listingType === 'Sale' ? (
                      <div className="animate-fade-in space-y-1.5">
                        <Label htmlFor="prop-price" className="text-slate-300">
                          Price (INR) <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          id="prop-price"
                          type="number"
                          value={price}
                          onChange={(e) => set('price', e.target.value)}
                          placeholder="e.g. 12000000"
                          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          required
                        />
                        <PriceHint value={price} />
                      </div>
                    ) : listingType === 'Rent' ? (
                      <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="prop-rent" className="text-slate-300">
                            Rent per month (INR){' '}
                            <span className="text-red-400">*</span>
                          </Label>
                          <Input
                            id="prop-rent"
                            type="number"
                            value={rentPerMonth}
                            onChange={(e) =>
                              set('rentPerMonth', e.target.value)
                            }
                            placeholder="e.g. 45000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            required
                          />
                          <PriceHint value={rentPerMonth} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-maintenance"
                            className="text-slate-300"
                          >
                            Maintenance (INR)
                          </Label>
                          <Input
                            id="prop-maintenance"
                            type="number"
                            value={maintenance}
                            onChange={(e) => set('maintenance', e.target.value)}
                            placeholder="e.g. 5000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={maintenance} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-advance"
                            className="text-slate-300"
                          >
                            Advance (Deposit) (INR)
                          </Label>
                          <Input
                            id="prop-advance"
                            type="number"
                            value={advance}
                            onChange={(e) => set('advance', e.target.value)}
                            placeholder="e.g. 200000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={advance} />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="prop-gst" className="text-slate-300">
                            GST (INR)
                          </Label>
                          <Input
                            id="prop-gst"
                            type="number"
                            value={gst}
                            onChange={(e) => set('gst', e.target.value)}
                            placeholder="e.g. 1800"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={gst} />
                        </div>
                      </div>
                    ) : listingType === 'Built to Suit' ? (
                      <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-rent"
                            className="text-slate-300"
                          >
                            Expected Rent per month (INR){' '}
                            <span className="text-red-400">*</span>
                          </Label>
                          <Input
                            id="prop-bts-rent"
                            type="number"
                            value={rentPerMonth}
                            onChange={(e) =>
                              set('rentPerMonth', e.target.value)
                            }
                            placeholder="e.g. 250000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            required
                          />
                          <PriceHint value={rentPerMonth} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-maintenance"
                            className="text-slate-300"
                          >
                            Maintenance / CAM (INR)
                          </Label>
                          <Input
                            id="prop-bts-maintenance"
                            type="number"
                            value={maintenance}
                            onChange={(e) => set('maintenance', e.target.value)}
                            placeholder="e.g. 15000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={maintenance} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-advance"
                            className="text-slate-300"
                          >
                            Security Deposit (INR)
                          </Label>
                          <Input
                            id="prop-bts-advance"
                            type="number"
                            value={advance}
                            onChange={(e) => set('advance', e.target.value)}
                            placeholder="e.g. 1500000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={advance} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-gst"
                            className="text-slate-300"
                          >
                            GST (INR)
                          </Label>
                          <Input
                            id="prop-bts-gst"
                            type="number"
                            value={gst}
                            onChange={(e) => set('gst', e.target.value)}
                            placeholder="e.g. 45000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={gst} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-lease-years"
                            className="text-slate-300"
                          >
                            Total Lease Term (years){' '}
                            <span className="text-red-400">*</span>
                          </Label>
                          <Input
                            id="prop-bts-lease-years"
                            type="number"
                            value={btsLeaseYears}
                            onChange={(e) =>
                              set('btsLeaseYears', e.target.value)
                            }
                            placeholder="e.g. 9"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-lockin-years"
                            className="text-slate-300"
                          >
                            Lock-in Period (years)
                          </Label>
                          <Input
                            id="prop-bts-lockin-years"
                            type="number"
                            value={btsLockInYears}
                            onChange={(e) =>
                              set('btsLockInYears', e.target.value)
                            }
                            placeholder="e.g. 3"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bts-escalation"
                            className="text-slate-300"
                          >
                            Rent Escalation (%)
                          </Label>
                          <Input
                            id="prop-bts-escalation"
                            type="number"
                            value={btsEscalationPercent}
                            onChange={(e) =>
                              set('btsEscalationPercent', e.target.value)
                            }
                            placeholder="e.g. 5"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-structure"
                            className="text-slate-300"
                          >
                            Deal Structure
                          </Label>
                          <select
                            id="prop-jv-structure"
                            value={jvStructure}
                            onChange={(e) =>
                              set(
                                'jvStructure',
                                e.target.value as
                                  'Revenue Share' | 'Area Share' | 'Hybrid'
                              )
                            }
                            className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                          >
                            <option value="Revenue Share">Revenue Share</option>
                            <option value="Area Share">Area Share</option>
                            <option value="Hybrid">Hybrid</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-price"
                            className="text-slate-300"
                          >
                            Expected Project Value (INR)
                          </Label>
                          <Input
                            id="prop-jv-price"
                            type="number"
                            value={price}
                            onChange={(e) => set('price', e.target.value)}
                            placeholder="e.g. 50000000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={price} />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-owner-share"
                            className="text-slate-300"
                          >
                            Owner Share (%){' '}
                            <span className="text-red-400">*</span>
                          </Label>
                          <Input
                            id="prop-jv-owner-share"
                            type="number"
                            value={ownerSharePercent}
                            onChange={(e) => {
                              const val = e.target.value;
                              set('ownerSharePercent', val);
                              const num = Number(val);
                              if (
                                val.trim() !== '' &&
                                !isNaN(num) &&
                                num >= 0 &&
                                num <= 100
                              ) {
                                set('builderSharePercent', String(100 - num));
                              }
                            }}
                            placeholder="e.g. 40"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-builder-share"
                            className="text-slate-300"
                          >
                            Builder Share (%){' '}
                            <span className="text-red-400">*</span>
                          </Label>
                          <Input
                            id="prop-jv-builder-share"
                            type="number"
                            value={builderSharePercent}
                            onChange={(e) => {
                              const val = e.target.value;
                              set('builderSharePercent', val);
                              const num = Number(val);
                              if (
                                val.trim() !== '' &&
                                !isNaN(num) &&
                                num >= 0 &&
                                num <= 100
                              ) {
                                set('ownerSharePercent', String(100 - num));
                              }
                            }}
                            placeholder="e.g. 60"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-goodwill"
                            className="text-slate-300"
                          >
                            Goodwill (INR)
                          </Label>
                          <Input
                            id="prop-jv-goodwill"
                            type="number"
                            value={goodwillAmount}
                            onChange={(e) =>
                              set('goodwillAmount', e.target.value)
                            }
                            placeholder="e.g. 2000000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={goodwillAmount} />
                          <p className="text-[10px] text-slate-500">
                            Non-refundable upfront payment to the landowner.
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-jv-advance"
                            className="text-slate-300"
                          >
                            Advance (Refundable) (INR)
                          </Label>
                          <Input
                            id="prop-jv-advance"
                            type="number"
                            value={advance}
                            onChange={(e) => set('advance', e.target.value)}
                            placeholder="e.g. 1000000"
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                          <PriceHint value={advance} />
                          <p className="text-[10px] text-slate-500">
                            Refundable deposit, adjusted against the
                            owner&apos;s share at handover.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="prop-type" className="text-slate-300">
                        Property Type
                      </Label>
                      <select
                        id="prop-type"
                        value={type}
                        onChange={(e) => set('type', e.target.value)}
                        className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                      >
                        {propertyTypeGroups.map((g) => (
                          <optgroup
                            key={g.group}
                            label={`ALL ${g.group.toUpperCase()}`}
                          >
                            {g.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label ?? o.value}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {isEdit && (
                      <div className="col-span-2 space-y-1.5">
                        <Label htmlFor="prop-status" className="text-slate-300">
                          Status
                        </Label>
                        <select
                          id="prop-status"
                          value={status}
                          onChange={(e) => set('status', e.target.value)}
                          className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                        >
                          {PROPERTY_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isEdit && (
                      <div className="col-span-2 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <h4 className="text-sm font-semibold text-white">
                          Seller&apos;s final price
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          What the seller will actually accept, as against the
                          quoted price above. Internal — never shown on the
                          showcase or in a share link.
                        </p>
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-seller-final-price"
                              className="text-slate-300"
                            >
                              Total
                            </Label>
                            <Input
                              id="prop-seller-final-price"
                              type="number"
                              min="0"
                              value={sellerFinalPrice}
                              onChange={(e) =>
                                set('sellerFinalPrice', e.target.value)
                              }
                              placeholder={
                                price ? `e.g. ${price}` : 'e.g. 42000000'
                              }
                              className="border-slate-700 bg-slate-800 text-white"
                            />
                            <PriceHint value={sellerFinalPrice} />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-seller-final-rate"
                              className="text-slate-300"
                            >
                              Per Sq.Ft.
                            </Label>
                            <Input
                              id="prop-seller-final-rate"
                              type="number"
                              min="0"
                              value={sellerFinalPricePerSqft}
                              onChange={(e) =>
                                set('sellerFinalPricePerSqft', e.target.value)
                              }
                              placeholder="e.g. 10500"
                              className="border-slate-700 bg-slate-800 text-white"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {isEdit && status === 'Sold' && (
                      <div className="col-span-2 space-y-1.5">
                        <Label
                          htmlFor="prop-sold-price"
                          className="text-slate-300"
                        >
                          Final sale price
                        </Label>
                        <Input
                          id="prop-sold-price"
                          type="number"
                          min="0"
                          value={soldPrice}
                          onChange={(e) => set('soldPrice', e.target.value)}
                          placeholder={price ? `e.g. ${price}` : 'e.g. 8500000'}
                          className="border-slate-700 bg-slate-800 text-white"
                        />
                        <PriceHint value={soldPrice} />
                        <p className="text-[11px] text-slate-500">
                          Optional — improves your area&apos;s price accuracy.
                          Never shown to buyers.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Autocomplete Real Location Details */}
                  <div
                    id="pf-location"
                    className="scroll-mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
                  >
                    <h4 className="text-sm font-semibold text-white">
                      Property Location
                    </h4>

                    <div className="relative space-y-1.5" ref={autocompleteRef}>
                      <Label
                        htmlFor="prop-search-query"
                        className="text-slate-300"
                      >
                        Project Name or Area / Sublocality{' '}
                        <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="prop-search-query"
                        value={searchQuery}
                        onChange={(e) => {
                          ensureLocalitiesLoaded();
                          handleSearchQueryChange(e.target.value);
                        }}
                        onFocus={() => {
                          ensureLocalitiesLoaded();
                          setShowSuggestions(true);
                        }}
                        placeholder="Search project (e.g. Prestige) or area (e.g. Indiranagar)..."
                        className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                        required
                      />

                      {showSuggestions && (
                        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-800 text-slate-200 shadow-xl">
                          {searchingProjects ? (
                            <div className="flex items-center justify-center gap-2 p-3 text-center text-xs text-slate-500">
                              <Loader2 className="text-primary size-3 animate-spin" />
                              <span>Searching project registry...</span>
                            </div>
                          ) : filteredProjects.length === 0 &&
                            filteredSublocalities.length === 0 &&
                            googleSuggestions.length === 0 ? (
                            <div className="p-3 text-center text-xs text-slate-500">
                              No matching projects or areas. Keep typing to
                              enter a custom value.
                            </div>
                          ) : (
                            <div>
                              {filteredProjects.length > 0 && (
                                <div className="p-1">
                                  <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                                    🏢 Projects
                                  </div>
                                  {filteredProjects.map((p) => (
                                    <button
                                      key={p.name}
                                      type="button"
                                      onClick={() => {
                                        set('project', p.name);
                                        set('sublocality', p.sublocality);
                                        set('city', p.city);
                                        set('stateVal', p.state);
                                        set('address', p.address);
                                        set('searchQuery', p.name);
                                        set('geoPick', null); // registry pick has no coords; server geocodes on save
                                        setShowSuggestions(false);
                                      }}
                                      className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                                    >
                                      <span className="font-bold">
                                        {p.name}
                                      </span>
                                      <span className="text-slate-400">
                                        {' '}
                                        - {p.sublocality}, {p.city}
                                      </span>
                                      {'source' in p && p.source === 'ai' && (
                                        <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] text-amber-300">
                                          AI suggestion · unverified
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {filteredSublocalities.length > 0 && (
                                <div className="border-t border-slate-700 p-1">
                                  <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                                    📍 Areas / Sublocalities
                                  </div>
                                  {filteredSublocalities.map((sub) => (
                                    <button
                                      key={sub}
                                      type="button"
                                      onClick={() => {
                                        set('project', '');
                                        const parts = sub
                                          .split(',')
                                          .map((s) => s.trim());
                                        if (parts.length > 1) {
                                          set('sublocality', parts[0]);
                                          set('address', parts[1]);
                                        } else {
                                          set('sublocality', sub);
                                          set('address', '');
                                        }
                                        set('city', 'Bangalore');
                                        set('stateVal', 'Karnataka');
                                        set('searchQuery', sub);
                                        set('geoPick', null); // registry pick has no coords; server geocodes on save
                                        setShowSuggestions(false);
                                      }}
                                      className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                                    >
                                      <span className="font-medium text-slate-200">
                                        {sub}
                                      </span>
                                      <span className="text-slate-400">
                                        {' '}
                                        - Bangalore, Karnataka
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {googleSuggestions.length > 0 && (
                                <div className="border-t border-slate-700 p-1">
                                  <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                                    🌐 Google Maps
                                  </div>
                                  {googleSuggestions.map((s) => (
                                    <button
                                      key={s.place_id}
                                      type="button"
                                      onClick={() => handleGooglePick(s)}
                                      className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                                    >
                                      <span className="font-medium text-slate-200">
                                        {s.main_text}
                                      </span>
                                      {s.secondary_text && (
                                        <span className="text-slate-400">
                                          {' '}
                                          - {s.secondary_text}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {geoPick && (
                        <p className="mt-0.5 text-[10px] font-medium text-sky-400">
                          📍 Pinned to Google Maps locality &quot;
                          {geoPick.canonical}&quot; — enables radius search.
                        </p>
                      )}

                      {isProjectMatched && (
                        <p className="mt-0.5 text-[10px] font-medium text-green-400">
                          Linked to project location details (pre-filled fields
                          locked).
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="prop-city" className="text-slate-300">
                          City <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          id="prop-city"
                          value={city}
                          onChange={(e) => set('city', e.target.value)}
                          placeholder="e.g. Bangalore"
                          className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                          disabled={isProjectMatched}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="prop-state" className="text-slate-300">
                          State <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          id="prop-state"
                          value={stateVal}
                          onChange={(e) => set('stateVal', e.target.value)}
                          placeholder="e.g. Karnataka"
                          className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                          disabled={isProjectMatched}
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <Label
                          htmlFor="prop-address"
                          className="text-slate-300"
                        >
                          Landmark / Street Address
                        </Label>
                        <Input
                          id="prop-address"
                          value={address}
                          onChange={(e) => set('address', e.target.value)}
                          placeholder="e.g. Near Metro Station"
                          className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isProjectMatched}
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <Label
                          htmlFor="prop-google-map-link"
                          className="text-slate-300"
                        >
                          Google Map Link (Shared on inquiry approval only)
                        </Label>
                        <Input
                          id="prop-google-map-link"
                          value={googleMapLink}
                          onChange={(e) => set('googleMapLink', e.target.value)}
                          placeholder="e.g. https://maps.google.com/?q=..."
                        />
                        {mapPinDrift !== null && (
                          <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
                            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                            <span>
                              This pin sits {mapPinDrift.toFixed(1)} km from the
                              selected locality
                              {geoPick?.canonical
                                ? ` (${geoPick.canonical})`
                                : ''}
                              . The pin wins on save — fix the link or re-pick
                              the locality if that&apos;s the wrong one.
                            </span>
                          </p>
                        )}
                      </div>

                      <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                        <div className="space-y-0.5">
                          <Label
                            htmlFor="prop-location-guard"
                            className="cursor-pointer text-sm text-slate-300"
                          >
                            Guard exact location
                          </Label>
                          <p className="text-xs leading-normal text-slate-400">
                            {guardedByType
                              ? 'On by default for this property type — buyers and co-brokers see locality only until you approve a reveal.'
                              : 'Off by default for this property type — turn on to hide the street address, map pin and coordinates until you approve a reveal.'}
                          </p>
                        </div>
                        <Switch
                          id="prop-location-guard"
                          checked={locationGuarded}
                          onCheckedChange={(checked) => {
                            const next = checked ? 'locality' : 'exact';
                            set(
                              'locationPrivacy',
                              (guardedByType ? 'locality' : 'exact') === next
                                ? ''
                                : next
                            );
                          }}
                        />
                      </div>

                      <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                        <div className="space-y-0.5">
                          <Label
                            htmlFor="prop-showcase-gate"
                            className="cursor-pointer text-sm text-slate-300"
                          >
                            Confidential listing
                          </Label>
                          <p className="text-xs leading-normal text-slate-400">
                            Anyone opening the public link sees only the type,
                            locality and a price band until you approve them.
                            Link previews and search engines get nothing, and
                            photos you release are watermarked to the viewer.
                          </p>
                        </div>
                        <Switch
                          id="prop-showcase-gate"
                          checked={showcaseVisibility === 'teaser'}
                          onCheckedChange={(checked) =>
                            set('showcaseVisibility', checked ? 'teaser' : '')
                          }
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <Label
                          htmlFor="prop-notes"
                          className="flex items-center gap-1.5 text-slate-300"
                        >
                          Internal Notes
                          <span className="rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            Engine Only — Not visible to clients
                          </span>
                        </Label>
                        <Textarea
                          id="prop-notes"
                          value={notes}
                          onChange={(e) => set('notes', e.target.value)}
                          placeholder="e.g. Near Garuda Mall, 3rd left from Metro Station. Owner available only on weekdays..."
                          className="min-h-[80px] resize-y border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                          rows={3}
                        />
                        <p className="text-xs leading-normal text-slate-400">
                          Location landmarks, access info, owner contact
                          preferences — searchable in the Engine but private to
                          your team.
                        </p>
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <Label
                          htmlFor="prop-tags"
                          className="flex items-center gap-1.5 text-slate-300"
                        >
                          Tags
                          <span className="rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            Engine Only — Not visible to clients
                          </span>
                        </Label>
                        <div className="focus-within:ring-primary flex flex-wrap items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-slate-950">
                          {tags.map((tag, idx) => (
                            <span
                              key={`${tag}-${idx}`}
                              className="bg-primary/15 border-primary/25 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                            >
                              <Tag className="size-2.5" />
                              {tag}
                              <button
                                type="button"
                                onClick={() =>
                                  set(
                                    'tags',
                                    tags.filter((_, i) => i !== idx)
                                  )
                                }
                                className="text-primary/70 hover:text-primary"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))}
                          <input
                            id="prop-tags"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                const next = tagInput.trim();
                                if (
                                  next &&
                                  !tags.some(
                                    (t) =>
                                      t.toLowerCase() === next.toLowerCase()
                                  )
                                ) {
                                  set('tags', [...tags, next]);
                                }
                                setTagInput('');
                              } else if (
                                e.key === 'Backspace' &&
                                !tagInput &&
                                tags.length > 0
                              ) {
                                set('tags', tags.slice(0, -1));
                              }
                            }}
                            onBlur={() => {
                              const next = tagInput.trim();
                              if (
                                next &&
                                !tags.some(
                                  (t) => t.toLowerCase() === next.toLowerCase()
                                )
                              ) {
                                set('tags', [...tags, next]);
                              }
                              setTagInput('');
                            }}
                            placeholder={
                              tags.length === 0
                                ? 'e.g. Brick and Bolt, Distress Sale — press Enter to add'
                                : 'Add tag...'
                            }
                            className="h-6 min-w-[140px] flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                          />
                        </div>
                        {tagSuggestions.filter(
                          (s) =>
                            !tags.some(
                              (t) => t.toLowerCase() === s.tag.toLowerCase()
                            )
                        ).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Already in use in this account. A tag only earns its
                              keep if every listing it should cover spells it the
                              same way — "APM" on three villas of a project and
                              "AMP" on the fourth leaves the fourth out of the
                              search the tag exists for. */}
                            {tagSuggestions
                              .filter(
                                (s) =>
                                  !tags.some(
                                    (t) =>
                                      t.toLowerCase() === s.tag.toLowerCase()
                                  )
                              )
                              .slice(0, 10)
                              .map((s) => (
                                <button
                                  key={s.tag}
                                  type="button"
                                  onClick={() => set('tags', [...tags, s.tag])}
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                                >
                                  <Plus className="size-2.5" />
                                  {s.tag}
                                  <span className="text-slate-600">
                                    {s.uses}
                                  </span>
                                </button>
                              ))}
                          </div>
                        )}
                        <p className="text-xs leading-normal text-slate-400">
                          Builder names, campaigns, deal nicknames — typing any
                          part of a tag finds this property in Inventory search
                          and property pickers.
                        </p>
                      </div>

                      {/* Commercial Location Fields */}
                      {hasCommercialFields && (
                        <>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-land-zone"
                              className="text-slate-300"
                            >
                              Land Zone
                            </Label>
                            <select
                              id="prop-land-zone"
                              value={landZone}
                              onChange={(e) => set('landZone', e.target.value)}
                              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                            >
                              <option value="">Select Land Zone</option>
                              <option value="Industrial">Industrial</option>
                              <option value="Commercial">Commercial</option>
                              <option value="Residential">Residential</option>
                              <option value="Agricultural">Agricultural</option>
                              <option value="Mixed Use">Mixed Use</option>
                              <option value="SEZ">
                                SEZ (Special Economic Zone)
                              </option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-ideal-for"
                              className="text-slate-300"
                            >
                              Ideal For Businesses
                            </Label>
                            <Input
                              id="prop-ideal-for"
                              value={idealFor}
                              onChange={(e) => set('idealFor', e.target.value)}
                              placeholder="e.g. Software, Bank, Clinic"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>

                          {hasCommercialBuildingFields && (
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="prop-rental-income"
                                className="text-slate-300"
                              >
                                Monthly Rental Income (INR)
                              </Label>
                              <Input
                                id="prop-rental-income"
                                type="number"
                                value={rentalIncome}
                                onChange={(e) =>
                                  set('rentalIncome', e.target.value)
                                }
                                placeholder="e.g. 250000"
                                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                              />
                              <PriceHint value={rentalIncome} />
                            </div>
                          )}

                          {hasCommercialBuildingFields &&
                            yieldApplies(listingType) && (
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor="prop-roi"
                                  className="text-slate-300"
                                >
                                  ROI (Return on Investment)
                                </Label>
                                <Input
                                  id="prop-roi"
                                  type="text"
                                  value={
                                    roiValue !== null
                                      ? `${roiValue}%`
                                      : 'calculated automatically'
                                  }
                                  readOnly
                                  className="bg-slate-850 text-primary h-9 cursor-not-allowed border-slate-800 font-medium"
                                />
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Floor-wise Tenancy (Rent Roll) — pre-leased commercial
                    buildings under sale: tenant, rent (excl. GST), lease
                    window, lock-in and maintenance per floor. */}
                  {hasCommercialBuildingFields && (
                    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-white">
                            Floor-wise Tenancy (Rent Roll)
                          </h4>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            For pre-leased buildings — one row per lease, not
                            per floor. A tenant taking several floors, or the
                            whole building, is a single row: name every floor it
                            covers in the label. Internal to your Engine; never
                            shown on the showcase.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            set('floorTenancies', (prev) => [
                              ...prev,
                              { ...emptyFloorTenancy },
                            ])
                          }
                          className="h-8 shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                          <Plus className="mr-1 size-3.5" />
                          Add Tenancy
                        </Button>
                      </div>

                      {floorTenancies.map((ft, idx) => (
                        <div
                          key={idx}
                          className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                              Tenancy {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                set('floorTenancies', (prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="text-slate-500 transition-colors hover:text-rose-400"
                              aria-label={`Remove tenancy ${idx + 1}`}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Floor(s) / Unit(s)
                              </Label>
                              <Input
                                value={ft.floor}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'floor',
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. G+1+2+3+4, or Entire building"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Tenant Name
                              </Label>
                              <Input
                                value={ft.tenant_name}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'tenant_name',
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. Ramada Hospitality"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Area (Sq.Ft.)
                              </Label>
                              <Input
                                type="number"
                                value={ft.area_sqft}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'area_sqft',
                                    e.target.value
                                  )
                                }
                                placeholder="10000"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Monthly Rent (₹, excl. GST)
                              </Label>
                              <Input
                                type="number"
                                value={ft.monthly_rent}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'monthly_rent',
                                    e.target.value
                                  )
                                }
                                placeholder="1350000"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                              <PriceHint
                                value={ft.monthly_rent}
                                compact
                                className="text-[10px]"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Advance / Deposit (₹)
                              </Label>
                              <Input
                                type="number"
                                value={ft.advance}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'advance',
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. 8100000"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                              <PriceHint
                                value={ft.advance}
                                compact
                                className="text-[10px]"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Lease Start
                              </Label>
                              <Input
                                type="date"
                                value={ft.lease_start}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'lease_start',
                                    e.target.value
                                  )
                                }
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white [color-scheme:dark]"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Lease End
                              </Label>
                              <Input
                                type="date"
                                value={ft.lease_end}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'lease_end',
                                    e.target.value
                                  )
                                }
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white [color-scheme:dark]"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Lock-in (months)
                              </Label>
                              <Input
                                type="number"
                                value={ft.lock_in_months}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'lock_in_months',
                                    e.target.value
                                  )
                                }
                                placeholder="36"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-slate-400">
                                Maintenance
                              </Label>
                              <Input
                                value={ft.maintenance}
                                onChange={(e) =>
                                  updateFloorTenancy(
                                    idx,
                                    'maintenance',
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. ₹5/sqft, by tenant"
                                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-[11px] text-slate-400">
                              Usage / Notes
                            </Label>
                            <Input
                              value={ft.notes}
                              onChange={(e) =>
                                updateFloorTenancy(idx, 'notes', e.target.value)
                              }
                              placeholder="e.g. 3-Star Hotel · 27 rooms · convention centre (400 seats)"
                              className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Label className="shrink-0 text-[11px] text-slate-400">
                              Floor Plan
                            </Label>
                            {ft.floor_plan ? (
                              <a
                                href={storagePublicUrl(ft.floor_plan)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary truncate text-[11px] hover:underline"
                              >
                                View plan
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-600">
                                None attached
                              </span>
                            )}
                            <input
                              ref={(el) => {
                                tenancyPlanInputs.current[idx] = el;
                              }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                const path = await uploadPlanImage(file);
                                if (path)
                                  updateFloorTenancy(idx, 'floor_plan', path);
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit}
                              onClick={() =>
                                tenancyPlanInputs.current[idx]?.click()
                              }
                              className="ml-auto h-7 px-2 text-[11px] text-slate-400 hover:text-white"
                            >
                              <Upload className="mr-1 size-3" />
                              {ft.floor_plan ? 'Replace' : 'Attach'}
                            </Button>
                            {ft.floor_plan && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateFloorTenancy(idx, 'floor_plan', '')
                                }
                                className="text-slate-500 transition-colors hover:text-rose-400"
                                aria-label={`Remove floor plan for tenancy ${idx + 1}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {floorTenancies.length > 0 &&
                        (floorRentTotal > 0 || floorAdvanceTotal > 0) && (
                          <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                            {floorRentTotal > 0 && (
                              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-slate-300">
                                <span>
                                  Total monthly rent{' '}
                                  <span className="font-medium text-slate-500">
                                    ({floorTenancies.length} tenanc
                                    {floorTenancies.length === 1 ? 'y' : 'ies'},
                                    excluding GST)
                                  </span>
                                </span>
                                <span className="text-primary">
                                  {formatCurrency(floorRentTotal, currency)}
                                </span>
                              </p>
                            )}
                            {floorAdvanceTotal > 0 && (
                              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-slate-300">
                                <span>
                                  Total advance / deposit{' '}
                                  <span className="font-medium text-slate-500">
                                    held across all floors
                                  </span>
                                </span>
                                <span className="text-primary">
                                  {formatCurrency(floorAdvanceTotal, currency)}
                                </span>
                              </p>
                            )}
                            {floorRentTotal > 0 && floorAdvanceTotal > 0 && (
                              <p className="border-t border-slate-800/80 pt-1 text-[11px] text-slate-500">
                                Deposit is{' '}
                                {(floorAdvanceTotal / floorRentTotal).toFixed(
                                  1
                                )}
                                × the monthly rent.
                              </p>
                            )}
                          </div>
                        )}
                    </div>
                  )}

                  {/* Area & Specification Fields */}
                  <div
                    id="pf-specs"
                    className="scroll-mt-2 space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
                  >
                    <h4 className="text-sm font-semibold text-white">
                      Area & Specs
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      {hasBedsBaths && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bedrooms"
                            className="text-slate-300"
                          >
                            Beds
                          </Label>
                          <Input
                            id="prop-bedrooms"
                            type="number"
                            value={bedrooms}
                            onChange={(e) => set('bedrooms', e.target.value)}
                            placeholder="e.g. 3"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {hasBedsBaths && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-bathrooms"
                            className="text-slate-300"
                          >
                            Baths
                          </Label>
                          <Input
                            id="prop-bathrooms"
                            type="number"
                            value={bathrooms}
                            onChange={(e) => set('bathrooms', e.target.value)}
                            placeholder="e.g. 2"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {isLand ? (
                        <div className="col-span-2 space-y-1.5">
                          <Label
                            htmlFor="prop-land-area"
                            className="text-slate-300"
                          >
                            Land Area <span className="text-red-400">*</span>
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="prop-land-area"
                              type="number"
                              value={landArea}
                              onChange={(e) =>
                                handleLandAreaChange(e.target.value)
                              }
                              placeholder="e.g. 2400"
                              className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                              required
                            />
                            <select
                              value={landAreaUnit}
                              onChange={(e) =>
                                set('landAreaUnit', e.target.value)
                              }
                              className="focus:ring-primary h-9 w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                            >
                              {AREA_UNITS.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="col-span-2 space-y-1.5">
                            <Label
                              htmlFor="prop-area"
                              className="text-slate-300"
                            >
                              Built-up Area
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="prop-area"
                                type="number"
                                value={areaSqft}
                                onChange={(e) =>
                                  set('areaSqft', e.target.value)
                                }
                                placeholder="e.g. 1500"
                                className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                              />
                              <select
                                value={areaUnit}
                                onChange={(e) =>
                                  set('areaUnit', e.target.value)
                                }
                                className="focus:ring-primary h-9 w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                              >
                                {AREA_UNITS.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div
                            className={`space-y-1.5 ${isApartment ? 'col-span-2' : ''}`}
                          >
                            <Label
                              htmlFor="prop-super-built"
                              className="text-slate-300"
                            >
                              Super Built-up Area ({areaUnit})
                            </Label>
                            <Input
                              id="prop-super-built"
                              type="number"
                              value={superBuiltArea}
                              onChange={(e) =>
                                set('superBuiltArea', e.target.value)
                              }
                              placeholder="e.g. 1800"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>

                          {!isApartment && (
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="prop-land-area"
                                className="text-slate-300"
                              >
                                Land Area
                              </Label>
                              <div className="flex gap-2">
                                <Input
                                  id="prop-land-area"
                                  type="number"
                                  value={landArea}
                                  onChange={(e) =>
                                    handleLandAreaChange(e.target.value)
                                  }
                                  placeholder="e.g. 2400"
                                  className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                                />
                                <select
                                  value={landAreaUnit}
                                  onChange={(e) =>
                                    set('landAreaUnit', e.target.value)
                                  }
                                  className="focus:ring-primary h-9 w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                                >
                                  {AREA_UNITS.map((unit) => (
                                    <option key={unit} value={unit}>
                                      {unit}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {isLand ? (
                        <div className="col-span-2 grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-frontage"
                              className="text-slate-300"
                            >
                              Frontage (Ft)
                            </Label>
                            <Input
                              id="prop-frontage"
                              type="number"
                              value={frontage}
                              onChange={(e) =>
                                handleFrontageChange(e.target.value)
                              }
                              placeholder="e.g. 30"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-depth"
                              className="text-slate-300"
                            >
                              Depth (Ft)
                            </Label>
                            <Input
                              id="prop-depth"
                              type="number"
                              value={depth}
                              onChange={(e) =>
                                handleDepthChange(e.target.value)
                              }
                              placeholder="e.g. 40"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>
                        </div>
                      ) : (
                        !isApartment && (
                          <div className="col-span-2 space-y-1.5">
                            <Label
                              htmlFor="prop-dimensions"
                              className="text-slate-300"
                            >
                              Dimensions
                            </Label>
                            <Input
                              id="prop-dimensions"
                              value={dimensions}
                              onChange={(e) =>
                                set('dimensions', e.target.value)
                              }
                              placeholder="e.g. 30x40, 50x80 (Width x Length)"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>
                        )
                      )}

                      {!isApartment && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-road-width"
                            className="text-slate-300"
                          >
                            Road Width
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="prop-road-width"
                              type="number"
                              value={roadWidth}
                              onChange={(e) => set('roadWidth', e.target.value)}
                              placeholder="e.g. 40"
                              className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                            <select
                              value={roadWidthUnit}
                              onChange={(e) =>
                                set('roadWidthUnit', e.target.value)
                              }
                              className="focus:ring-primary h-9 w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                            >
                              <option value="Feet">Feet</option>
                              <option value="Meters">Meters</option>
                            </select>
                          </div>
                        </div>
                      )}

                      <div
                        className={`space-y-1.5 ${isApartment ? 'col-span-2' : ''}`}
                      >
                        <Label htmlFor="prop-facing" className="text-slate-300">
                          Facing Direction
                        </Label>
                        <select
                          id="prop-facing"
                          value={facingDirection}
                          onChange={(e) =>
                            set('facingDirection', e.target.value)
                          }
                          className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                        >
                          <option value="">Select Facing</option>
                          {FACING_DIRECTIONS.map((dir) => (
                            <option key={dir} value={dir}>
                              {dir}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label
                          htmlFor="prop-khata-epid"
                          className="text-slate-300"
                        >
                          e-Khata ePID
                        </Label>
                        <Input
                          id="prop-khata-epid"
                          value={khataEpid}
                          onChange={(e) => set('khataEpid', e.target.value)}
                          placeholder="e.g. 7425317720"
                          className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label
                          htmlFor="prop-khata-form"
                          className="text-slate-300"
                        >
                          Khata
                        </Label>
                        <select
                          id="prop-khata-form"
                          value={khataForm}
                          onChange={(e) => set('khataForm', e.target.value)}
                          className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                        >
                          <option value="">Not recorded</option>
                          <option value="A">Form-A (A-Khata)</option>
                          <option value="B">Form-B (B-Khata)</option>
                        </select>
                      </div>

                      {!isLand && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-year-built"
                            className="text-slate-300"
                          >
                            Year Built
                          </Label>
                          <Input
                            id="prop-year-built"
                            type="number"
                            min={1800}
                            max={2100}
                            value={yearBuilt}
                            onChange={(e) => set('yearBuilt', e.target.value)}
                            placeholder="e.g. 1998"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {!isLand && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-furnishing"
                            className="text-slate-300"
                          >
                            Furnishing
                          </Label>
                          <select
                            id="prop-furnishing"
                            value={furnishing}
                            onChange={(e) => set('furnishing', e.target.value)}
                            className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                          >
                            <option value="">Select Furnishing</option>
                            {FURNISHING_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label
                          htmlFor="prop-possession-date"
                          className="text-slate-300"
                        >
                          Possession Date
                        </Label>
                        <Input
                          id="prop-possession-date"
                          type="date"
                          value={possessionDate}
                          onChange={(e) =>
                            set('possessionDate', e.target.value)
                          }
                          className="h-9 border-slate-700 bg-slate-800 text-white [color-scheme:dark]"
                        />
                        <p className="text-[10px] text-slate-500">
                          {isLand
                            ? 'When possession transfers to the buyer. Leave empty if it is not committed yet.'
                            : 'When the buyer gets the keys. Leave empty if it is not committed yet.'}
                        </p>
                      </div>

                      {!isLand && (
                        <>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-flooring"
                              className="text-slate-300"
                            >
                              Flooring
                            </Label>
                            <select
                              id="prop-flooring"
                              value={flooring}
                              onChange={(e) => set('flooring', e.target.value)}
                              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                            >
                              <option value="">Select Flooring</option>
                              {FLOORING_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-power-backup"
                              className="text-slate-300"
                            >
                              Power Backup
                            </Label>
                            <select
                              id="prop-power-backup"
                              value={powerBackup}
                              onChange={(e) =>
                                set('powerBackup', e.target.value)
                              }
                              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                            >
                              <option value="">Select Power Backup</option>
                              {POWER_BACKUP_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}

                      {hasBedsBaths && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-balconies"
                            className="text-slate-300"
                          >
                            Balconies
                          </Label>
                          <Input
                            id="prop-balconies"
                            type="number"
                            value={balconies}
                            onChange={(e) => set('balconies', e.target.value)}
                            placeholder="e.g. 2"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {showFloorNumber && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-floor-number"
                            className="text-slate-300"
                          >
                            Floor No.
                          </Label>
                          <Input
                            id="prop-floor-number"
                            type="number"
                            value={floorNumber}
                            onChange={(e) => set('floorNumber', e.target.value)}
                            placeholder="e.g. 4 (0 = Ground)"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}
                      {showTotalFloors && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="prop-total-floors"
                            className="text-slate-300"
                          >
                            Total Floors
                          </Label>
                          <Input
                            id="prop-total-floors"
                            type="number"
                            value={totalFloors}
                            onChange={(e) => set('totalFloors', e.target.value)}
                            placeholder="e.g. 12"
                            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {/* Land/JV Deal Notes — prefills the "Share via Email" draft */}
                      {(isLand || listingType === 'JV/JD') && (
                        <div className="col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                          <div className="col-span-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                            Land / Deal Notes
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-ownership-status"
                              className="text-slate-300"
                            >
                              Ownership
                            </Label>
                            <select
                              id="prop-ownership-status"
                              value={ownershipStatus}
                              onChange={(e) =>
                                set('ownershipStatus', e.target.value)
                              }
                              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                            >
                              <option value="">Select ownership</option>
                              {LAND_OWNERSHIP_TYPES.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                              {/* Free text captured before this became a
                                picker stays selected rather than silently
                                resetting to blank on the next save. */}
                              {ownershipStatus &&
                                !LAND_OWNERSHIP_TYPES.includes(
                                  ownershipStatus
                                ) && (
                                  <option value={ownershipStatus}>
                                    {ownershipStatus}
                                  </option>
                                )}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="prop-land-use-zoning"
                              className="text-slate-300"
                            >
                              Land Use Breakdown
                            </Label>
                            <Input
                              id="prop-land-use-zoning"
                              value={landUseZoning}
                              onChange={(e) =>
                                set('landUseZoning', e.target.value)
                              }
                              placeholder="e.g. Residential zone 26A 13G, Red Zone 5A 29G"
                              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>
                          {isRawLand && (
                            <>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor="prop-legal-status"
                                  className="text-slate-300"
                                >
                                  Legal Status
                                </Label>
                                <select
                                  id="prop-legal-status"
                                  value={legalStatus}
                                  onChange={(e) =>
                                    set('legalStatus', e.target.value)
                                  }
                                  className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                                >
                                  <option value="">Select legal status</option>
                                  {LAND_LEGAL_STATUSES.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor="prop-conversion-type"
                                  className="text-slate-300"
                                >
                                  Conversion
                                </Label>
                                <select
                                  id="prop-conversion-type"
                                  value={conversionType}
                                  onChange={(e) =>
                                    set('conversionType', e.target.value)
                                  }
                                  className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                                >
                                  <option value="">Select conversion</option>
                                  {LAND_CONVERSION_TYPES.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {/* Commercial/industrial land already gets this
                                control in the commercial block above. */}
                              {!hasCommercialFields && (
                                <div className="space-y-1.5">
                                  <Label
                                    htmlFor="prop-land-zone-res"
                                    className="text-slate-300"
                                  >
                                    Land Use
                                  </Label>
                                  <select
                                    id="prop-land-zone-res"
                                    value={landZone}
                                    onChange={(e) =>
                                      set('landZone', e.target.value)
                                    }
                                    className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                                  >
                                    <option value="">Select land use</option>
                                    <option value="Residential">
                                      Residential
                                    </option>
                                    <option value="Commercial">
                                      Commercial
                                    </option>
                                    <option value="Industrial">
                                      Industrial
                                    </option>
                                    <option value="Agricultural">
                                      Agricultural
                                    </option>
                                    <option value="Mixed Use">Mixed Use</option>
                                    <option value="SEZ">
                                      SEZ (Special Economic Zone)
                                    </option>
                                  </select>
                                </div>
                              )}
                            </>
                          )}
                          <div className="col-span-2 space-y-1.5">
                            <Label
                              htmlFor="prop-deal-remarks"
                              className="text-slate-300"
                            >
                              Deal Remarks
                            </Label>
                            <Textarea
                              id="prop-deal-remarks"
                              value={dealRemarks}
                              onChange={(e) =>
                                set('dealRemarks', e.target.value)
                              }
                              placeholder="e.g. Legal/aggregation status, road access, timeline for completion..."
                              className="min-h-16 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                            />
                          </div>
                          <p className="col-span-2 text-[10px] text-slate-500">
                            Internal notes — never shown on the public showcase.
                            Used to prefill the &quot;Share via Email&quot;
                            draft.
                          </p>
                        </div>
                      )}

                      {/* Amenities Checkbox Selection */}
                      <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <Label className="text-sm font-semibold text-slate-300">
                          Amenities
                        </Label>
                        <div className="mt-1 space-y-4">
                          {Object.entries(filteredAmenities).map(
                            ([category, items]) => (
                              <div key={category} className="space-y-1.5">
                                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                                  {category}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {items.map((amenity: string) => {
                                    const isChecked =
                                      features.includes(amenity);
                                    return (
                                      <label
                                        key={amenity}
                                        className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() =>
                                            handleToggleFeature(amenity)
                                          }
                                          className="border-slate-750 text-primary focus:ring-primary size-3.5 rounded bg-slate-800 focus:ring-offset-slate-950"
                                        />
                                        <span>{amenity}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Collapsible Advanced section (landmarks) */}
                      <div className="col-span-2 border-t border-slate-800 pt-4">
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-white"
                        >
                          {showAdvanced ? (
                            <ChevronUp className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                          <span>
                            {showAdvanced
                              ? 'Hide Advanced Options'
                              : 'Show Advanced Options'}
                          </span>
                        </button>

                        {showAdvanced && (
                          <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/10 p-4">
                            <Label className="text-xs font-semibold text-slate-300">
                              Nearby Highlights / Landmarks
                            </Label>
                            <div className="mt-1 grid grid-cols-3 gap-2">
                              {NEARBY_HIGHLIGHTS_OPTIONS.map((highlight) => {
                                const isChecked =
                                  nearbyHighlights.includes(highlight);
                                return (
                                  <label
                                    key={highlight}
                                    className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() =>
                                        handleToggleHighlight(highlight)
                                      }
                                      className="border-slate-750 text-primary focus:ring-primary size-3.5 rounded bg-slate-800 focus:ring-offset-slate-950"
                                    />
                                    <span>{highlight}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Auto-generated listing video — needs a saved
                        property with photos, so edit mode only. */}
                      {property?.id && (
                        <div className="col-span-2">
                          <ListingVideoCard
                            key={videoRemoved ? 'video-removed' : 'video'}
                            propertyId={property.id}
                          />
                        </div>
                      )}

                      {/* Images URLs Input */}
                      <div
                        id="pf-media"
                        className="col-span-2 scroll-mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-300">
                            Property Images
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingImage}
                            className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
                          >
                            {uploadingImage ? (
                              <>
                                <PropertyBlueprintLoader
                                  size={14}
                                  label="Uploading"
                                />{' '}
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="size-3" /> Upload
                              </>
                            )}
                          </Button>
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={onUploadImages}
                            multiple
                            accept="image/*"
                            className="hidden"
                          />
                        </div>

                        <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                          {property?.video_url &&
                            property.video_status === 'ready' &&
                            !videoRemoved && (
                              <div className="flex items-center gap-2">
                                <video
                                  src={storagePublicUrl(property.video_url)}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="size-8 shrink-0 rounded border border-slate-700 object-cover"
                                />
                                <span className="flex-1 truncate text-xs text-slate-400">
                                  Listing video — plays in the Showcase gallery
                                </span>
                                <a
                                  href={storagePublicUrl(property.video_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Play video"
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:text-white"
                                >
                                  <CirclePlay className="size-3.5" />
                                </a>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleRemoveVideo}
                                  disabled={removingVideo}
                                  title="Remove video"
                                  className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                >
                                  {removingVideo ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-3.5" />
                                  )}
                                </Button>
                              </div>
                            )}
                          {images.map((imgUrl, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              {imgUrl.trim().length > 0 && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  key={imgUrl}
                                  src={storagePublicUrl(imgUrl)}
                                  alt={`Property ${idx + 1}`}
                                  className="size-8 shrink-0 rounded border border-slate-700 object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display =
                                      'none';
                                  }}
                                />
                              )}
                              <Input
                                value={imgUrl}
                                onChange={(e) =>
                                  handleImageUrlChange(idx, e.target.value)
                                }
                                placeholder="Image URL (e.g. https://...)"
                                className="h-8 flex-1 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                              />
                              {imgUrl.trim().length > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSetDefaultImage(idx)}
                                  className={`h-8 w-8 shrink-0 p-0 ${idx === defaultImageIndex ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
                                  title={
                                    idx === defaultImageIndex
                                      ? 'Default Image'
                                      : 'Set as Default'
                                  }
                                >
                                  <Star
                                    className={`size-3.5 ${idx === defaultImageIndex ? 'fill-amber-400' : ''}`}
                                  />
                                </Button>
                              )}
                              {imgUrl.trim().length > 0 && property?.id && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleToggleImageLock(imgUrl, 'lock')
                                  }
                                  disabled={lockingImagePath !== null}
                                  className="h-8 w-8 shrink-0 p-0 text-slate-500 hover:text-amber-400"
                                  title="Make private — hidden from the showcase, revealed only on approved requests (e.g. facade / street view)"
                                >
                                  {lockingImagePath === imgUrl ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Lock className="size-3.5" />
                                  )}
                                </Button>
                              )}
                              {images.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveImageUrl(idx)}
                                  className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleAddImageUrl}
                            className="mt-1 flex h-7 items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
                          >
                            <Plus className="size-3" /> Add Image URL
                          </Button>
                        </div>

                        {property?.id && privateImages.length > 0 && (
                          <div className="space-y-2 border-t border-slate-800 pt-3">
                            <Label className="flex items-center gap-1.5 text-xs text-amber-400">
                              <Lock className="size-3" /> Private Photos
                              <span className="text-[10px] font-medium text-slate-500">
                                Hidden from the showcase — sent only with
                                approved location reveals
                              </span>
                            </Label>
                            {privateImages.map((path, idx) => (
                              <div
                                key={path}
                                className="flex items-center gap-2"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/properties/${property.id}/private-images/${idx}`}
                                  alt={`Private ${idx + 1}`}
                                  className="size-8 shrink-0 rounded border border-amber-900/50 object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display =
                                      'none';
                                  }}
                                />
                                <span className="flex-1 truncate text-xs text-slate-500">
                                  {path}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleToggleImageLock(path, 'unlock')
                                  }
                                  disabled={lockingImagePath !== null}
                                  className="flex h-8 shrink-0 items-center gap-1 px-2 text-xs text-slate-400 hover:text-white"
                                  title="Make public again"
                                >
                                  {lockingImagePath === path ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Unlock className="size-3.5" /> Unlock
                                    </>
                                  )}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Floor Plans */}
                      <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <FloorPlansEditor
                          value={floorPlans}
                          onChange={(next) => set('floorPlans', next)}
                          onUpload={uploadPlanImage}
                          disabled={!canEdit}
                          isLand={isLand}
                        />
                      </div>

                      {/* Property Documents */}
                      <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-300">
                            Property Documents
                          </Label>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => eKhataInputRef.current?.click()}
                              disabled={readingEKhata || !canEdit}
                              className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
                            >
                              {readingEKhata ? (
                                <>
                                  <Loader2 className="size-3 animate-spin" />{' '}
                                  Reading...
                                </>
                              ) : (
                                <>
                                  <FileText className="size-3" /> Read e-Khata ·{' '}
                                  {AI_FEATURE_COSTS.listing_parse} cr
                                </>
                              )}
                            </Button>
                            <input
                              type="file"
                              ref={eKhataInputRef}
                              onChange={onReadEKhata}
                              accept=".pdf,.png,.jpg,.jpeg,.webp"
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => documentInputRef.current?.click()}
                              disabled={uploadingDocument}
                              className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
                            >
                              {uploadingDocument ? (
                                <>
                                  <PropertyBlueprintLoader
                                    size={14}
                                    label="Uploading"
                                  />{' '}
                                  Uploading...
                                </>
                              ) : (
                                <>
                                  <Upload className="size-3" /> Upload
                                </>
                              )}
                            </Button>
                            <input
                              type="file"
                              ref={documentInputRef}
                              onChange={onUploadDocuments}
                              multiple
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,text/plain"
                              className="hidden"
                            />
                          </div>
                        </div>

                        <div className="max-h-60 space-y-3 overflow-y-auto pr-1">
                          {documents.map((doc, idx) => (
                            <div
                              key={idx}
                              className="border-slate-850 flex flex-col items-start gap-2 rounded-lg border bg-slate-950/30 p-2.5 sm:flex-row sm:items-center"
                            >
                              <div className="grid w-full flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                                <Input
                                  value={doc.title}
                                  onChange={(e) =>
                                    handleDocumentTitleChange(
                                      idx,
                                      e.target.value
                                    )
                                  }
                                  placeholder="Document Title (e.g. Layout Sketch)"
                                  className="h-8 w-full border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                                />
                                <Input
                                  value={doc.url}
                                  onChange={(e) =>
                                    handleDocumentUrlChange(idx, e.target.value)
                                  }
                                  placeholder="Document URL (e.g. https://...)"
                                  className="h-8 w-full border-slate-700 bg-slate-800 font-mono text-xs text-white placeholder:text-slate-500"
                                />
                              </div>
                              <div className="flex shrink-0 gap-1.5 self-end sm:self-auto">
                                {doc.url.trim().length > 0 && (
                                  <a
                                    href={storagePublicUrl(doc.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                                    title="Open Document"
                                  >
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                )}
                                {documents.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveDocumentUrl(idx)}
                                    className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleAddDocumentUrl}
                            className="mt-1 flex h-7 items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
                          >
                            <Plus className="size-3" /> Add Document URL
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <div
                    id="pf-description"
                    className="scroll-mt-2 space-y-1.5 pt-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label
                        htmlFor="prop-description"
                        className="text-slate-300"
                      >
                        Description
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleGenerateAIDescription}
                        disabled={generatingDescription || !title.trim()}
                        className="text-primary hover:text-primary-hover hover:bg-primary/10 border-primary/20 flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {generatingDescription ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <span>✨</span> Generate with AI
                            <Badge
                              variant="outline"
                              className="border-primary/30 text-primary/80 ml-1 h-4 px-1 text-[9px] font-medium"
                            >
                              {AI_FEATURE_COSTS.property_description} cr
                            </Badge>
                          </>
                        )}
                      </Button>
                    </div>
                    <Textarea
                      id="prop-description"
                      value={description}
                      onChange={(e) => set('description', e.target.value)}
                      placeholder="Describe the property's design, styling details, location benefits, etc..."
                      rows={4}
                      className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                    />
                    <p className="text-[10px] leading-normal font-medium text-slate-500">
                      💡{' '}
                      <span className="font-semibold text-slate-400">
                        Tip for better AI results:
                      </span>{' '}
                      fill out title, area, amenities, landmarks, and other
                      specs before generating.
                    </p>
                  </div>

                  {/* Owner & Leads */}
                  <div
                    id="pf-owner"
                    className="scroll-mt-2 space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
                  >
                    <h4 className="text-sm font-semibold text-white">
                      Owner & Inquiries
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div
                        className="col-span-2 space-y-1.5 md:col-span-1"
                        data-owner-dropdown
                      >
                        <Label htmlFor="prop-owner" className="text-slate-300">
                          Select Contact (Owner/Agent)
                        </Label>
                        <div className="relative">
                          <Input
                            type="text"
                            placeholder="Search by name, phone or email..."
                            value={ownerSearchInput}
                            onChange={(e) => {
                              setOwnerSearchInput(e.target.value);
                              setIsOwnerDropdownOpen(true);
                            }}
                            onFocus={() => setIsOwnerDropdownOpen(true)}
                            readOnly={!!ownerContactId}
                            className={`h-9 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500 ${
                              ownerContactId ? 'cursor-default' : ''
                            }`}
                          />
                          {ownerContactId && (
                            <button
                              type="button"
                              onClick={() => handleOwnerSelect(null)}
                              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-white"
                            >
                              ×
                            </button>
                          )}
                          {ownerContactId && (
                            <div className="absolute top-1/2 right-8 -translate-y-1/2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  listingSource === 'agent'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-amber-500/20 text-amber-400'
                                }`}
                              >
                                {listingSource === 'agent' ? 'Agent' : 'Owner'}
                              </span>
                            </div>
                          )}
                          {isOwnerDropdownOpen &&
                            filteredOwnerContacts.length > 0 && (
                              <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-700 bg-slate-800 shadow-lg">
                                {filteredOwnerContacts.map((contact) => (
                                  <button
                                    key={contact.id}
                                    type="button"
                                    onClick={() =>
                                      handleOwnerSelect(contact.id)
                                    }
                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-700 ${
                                      ownerContactId === contact.id
                                        ? 'bg-primary/20 text-primary'
                                        : 'text-white'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className="truncate">
                                        {contact.name || 'Unnamed'} (
                                        {contact.phone})
                                      </span>
                                      <NameTagBadge tag={contact.name_tag} />
                                    </span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                                        contact.classification === 'Agent'
                                          ? 'bg-blue-500/20 text-blue-400'
                                          : contact.classification === 'Owner'
                                            ? 'bg-amber-500/20 text-amber-400'
                                            : 'bg-slate-600 text-slate-300'
                                      }`}
                                    >
                                      {contact.classification}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      </div>

                      <div className="col-span-2 space-y-1.5 md:col-span-1">
                        <Label
                          htmlFor="prop-listing-source"
                          className="text-slate-300"
                        >
                          Listing Source
                        </Label>
                        {ownerContactId ? (
                          <div className="flex h-9 items-center rounded-md border border-slate-700 bg-slate-800 px-3">
                            <span
                              className={`text-sm font-medium ${
                                listingSource === 'agent'
                                  ? 'text-blue-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {listingSource === 'agent'
                                ? 'Referred by Agent'
                                : 'Direct (from Owner)'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex h-9 items-center rounded-md border border-slate-700 bg-slate-800/50 px-3">
                            <span className="text-sm text-slate-500">
                              Select a contact first
                            </span>
                          </div>
                        )}
                        <p className="text-[10px] leading-normal font-medium text-slate-500">
                          Auto-detected based on selected contact&apos;s
                          classification
                        </p>
                      </div>

                      <div
                        className="col-span-2 space-y-3"
                        ref={contactSearchRef}
                      >
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-350 font-medium">
                            Contacts with Shown Interest (Buyers & Agents)
                          </Label>
                          <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            {interestedContacts.length} Linked
                          </span>
                        </div>

                        {/* Autocomplete Contact Search Input */}
                        <div className="relative">
                          <div className="relative">
                            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
                            <Input
                              type="text"
                              placeholder="Search Buyer or Agent by name, phone or email..."
                              value={contactSearchInput}
                              onChange={(e) => {
                                setContactSearchInput(e.target.value);
                                setIsContactDropdownOpen(true);
                              }}
                              onFocus={() => setIsContactDropdownOpen(true)}
                              className="h-9 border-slate-700 bg-slate-800 pr-9 pl-9 text-xs text-white placeholder:text-slate-500"
                            />
                            {contactSearchInput && (
                              <button
                                type="button"
                                onClick={() => {
                                  setContactSearchInput('');
                                  setIsContactDropdownOpen(false);
                                }}
                                className="absolute top-2.5 right-3 text-slate-500 hover:text-white"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          {/* Dropdown search results */}
                          {isContactDropdownOpen &&
                            contactSearchInput.trim() && (
                              <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
                                {contactSearchResults.length > 0 ? (
                                  contactSearchResults.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() =>
                                        handleAddInterestedContact(c.id)
                                      }
                                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                                    >
                                      <div className="truncate pr-4">
                                        <span className="flex items-center gap-1.5 truncate font-semibold text-slate-200">
                                          <span className="truncate">
                                            {c.name || 'Unnamed'} ({c.phone})
                                          </span>
                                          <NameTagBadge tag={c.name_tag} />
                                        </span>
                                        <span className="block truncate text-[10px] text-slate-500">
                                          Classification: {c.classification}
                                        </span>
                                      </div>
                                      <Plus className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                    </button>
                                  ))
                                ) : (
                                  <div className="py-2 text-center text-xs text-slate-500">
                                    No matching Buyers or Agents found (or
                                    already linked)
                                  </div>
                                )}
                              </div>
                            )}
                        </div>

                        {/* Linked Contacts list */}
                        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-2">
                          {interestedContacts.length > 0 ? (
                            interestedContacts.map((c) => {
                              const isHot =
                                c.lead_temp === 'HOT' ||
                                c.status === 'pending_review';
                              const isContacted =
                                contactedContactIds.has(c.id) ||
                                !!c.last_contacted_at;
                              const isCold =
                                c.lead_temp === 'COLD' ||
                                c.lead_temp === 'Dead';

                              // Style based on interest and contact status
                              let cardBorderClass =
                                'border-slate-800 bg-slate-800/20';
                              if (isHot) {
                                cardBorderClass =
                                  'border-[#00ff88]/40 bg-[#00ff88]/5 shadow-[0_0_8px_rgba(0,255,136,0.06)]';
                              } else if (isCold) {
                                cardBorderClass =
                                  'border-rose-950/30 bg-rose-950/5';
                              } else if (isContacted) {
                                cardBorderClass =
                                  'border-emerald-600/30 bg-emerald-950/5';
                              }

                              return (
                                <div
                                  key={c.id}
                                  className={`flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs transition-all ${cardBorderClass}`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-bold text-slate-200">
                                        {c.name || 'Unnamed'}
                                      </span>
                                      <NameTagBadge tag={c.name_tag} />
                                      <span className="text-[10px] text-slate-500">
                                        ({c.phone})
                                      </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                                        {c.classification || 'Buyer'}
                                      </span>
                                      <span className="text-[10px] text-slate-600">
                                        •
                                      </span>

                                      {/* Status badges */}
                                      {isHot && (
                                        <span className="animate-pulse rounded border border-[#00ff88]/30 bg-[#00ff88]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#00ff88] uppercase">
                                          Interested (Hot)
                                        </span>
                                      )}
                                      {isContacted && (
                                        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-medium text-white uppercase">
                                          Contacted
                                        </span>
                                      )}
                                      {isCold && (
                                        <span className="rounded border border-rose-950/50 bg-rose-950/40 px-1.5 py-0.5 text-[9px] font-medium text-rose-400 uppercase">
                                          Not Interested
                                        </span>
                                      )}
                                      {!isHot && !isContacted && !isCold && (
                                        <span className="bg-slate-850 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-medium text-slate-400 uppercase">
                                          Not Contacted
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleGoToChat(c.id)}
                                      className="hover:bg-slate-750 rounded border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition-colors hover:text-emerald-400"
                                      title="Go to WhatsApp Chat Inbox"
                                      aria-label="Open Chat"
                                    >
                                      <MessageSquare className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        set('interestedContactIds', (prev) =>
                                          prev.filter((id) => id !== c.id)
                                        );
                                      }}
                                      className="rounded border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition-colors hover:border-rose-900/50 hover:bg-rose-950/50 hover:text-rose-400"
                                      title="Remove link"
                                      aria-label="Remove Contact Link"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="py-6 text-center text-xs text-slate-500">
                              No interested contacts linked to this property
                              yet. Use the search bar above to link contacts.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

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
