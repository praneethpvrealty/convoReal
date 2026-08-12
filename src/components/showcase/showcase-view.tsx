'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import { storagePublicUrl } from '@/lib/storage/url';
import {
  documentDisplayName,
  parsePropertyDocuments,
} from '@/lib/inventory/documents';
import { createShowcaseTracker } from '@/lib/pulse/tracker';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';
import { toast } from 'sonner';
import { CATEGORY_SUBTYPES, parsePropertyQuery } from '@/lib/search-parser';
import {
  Search,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  Building,
  Phone,
  MessageCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown,
  FileText,
  Calendar,
  Send,
  CheckCircle,
  Share2,
  Bell,
  Home,
  Play,
  Download,
} from 'lucide-react';
import type { Property, ShowcaseSettings } from '@/types';
import { BRANDING } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PriceHint } from '@/components/ui/price-hint';
import { Textarea } from '@/components/ui/textarea';
import { AskPropertyChat } from '@/components/showcase/ask-property-chat';
import { ShowcaseLeadBot } from '@/components/showcase/showcase-lead-bot';
import { SimilarProperties } from '@/components/showcase/similar-properties';
import { TeaserGate } from '@/components/showcase/teaser-gate';
import {
  PropertyRatingBar,
  HIGH_INTEREST_RATING,
} from '@/components/showcase/property-rating-bar';
import { readStored, removeStored, writeStored } from '@/lib/safe-storage';

// Dwell-time cap for Pulse view_property events — a tab left open in the
// background must not report hours of "viewing".
const MAX_DWELL_MS = 30 * 60 * 1000;

// How long a visitor must dwell on a property's detail modal before we
// nudge them to rate it.
const RATING_NUDGE_DELAY_MS = 7000;

const trackPixelEvent = (
  eventName: string,
  params?: Record<string, unknown>
) => {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fbq = (window as any).fbq;
    if (typeof fbq === 'function') {
      fbq('track', eventName, params);
    }
  }
};

interface ShowcaseViewProps {
  properties: Property[];
  settings: ShowcaseSettings | null;
  accountId: string;
  /** The brokerage name (`accounts.name`), shown as the site title. */
  siteName?: string | null;
  referrerContactId?: string;
  referrerPhone?: string;
  initialPropertyId?: string;
  initialCategory?: string;
  /** ?mode=view (legacy: agent) resolved on the server so the first paint is already the clean listing view. */
  initialAgentMode?: boolean;
  /** Contact id from per-contact share links (?v=…) — Showcase Pulse
   *  attribution only, never filters the catalog. */
  visitorRef?: string;
  /** Share-instance token from generic shares (?s=…) — labels which
   *  share a visit came from in Pulse. Never filters. */
  shareId?: string;
  /** Share-grant token (?g=…), already verified server-side. Doubles as
   *  the credential the guarded-photo proxy checks on every fetch. */
  shareGrantToken?: string;
  /** Destination landing pages override the hero copy. */
  hero?: {
    title: string;
    highlight: string;
    subtitle: string;
    badges?: string[];
  };
  /** Project facts (builder, amenities, gallery) — set only on
   *  /projects/[slug] pages, where every listing shares one building. */
  projectInfo?: {
    builder?: string | null;
    description?: string | null;
    amenities?: string[];
    images?: string[];
  } | null;
  /** Accent theme applied when the URL has no ?theme= override. */
  initialTheme?: string;
  /** Destination pages pre-filter the catalog server-side — filters saved
   *  from the main showcase must not leak in (a stale search would zero
   *  the results), nor destination browsing leak back out. */
  disableSavedState?: boolean;
}

/** Resolve the share-link target so the detail modal is part of the server render. */
function findInitialProperty(
  properties: Property[],
  initialPropertyId?: string
): Property | null {
  if (!initialPropertyId) return null;
  return (
    properties.find(
      (p) =>
        p.id === initialPropertyId ||
        (p.property_code &&
          p.property_code.toLowerCase() === initialPropertyId.toLowerCase())
    ) || null
  );
}

export function ShowcaseView({
  properties,
  settings,
  accountId,
  siteName: siteNameProp,
  referrerContactId,
  referrerPhone,
  initialPropertyId,
  initialCategory,
  initialAgentMode = false,
  visitorRef,
  shareId,
  shareGrantToken,
  hero,
  projectInfo,
  initialTheme,
  disableSavedState = false,
}: ShowcaseViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // ── Showcase Pulse tracking (fire-and-forget beacons) ──────────
  // One tracker per page load; 'open' fires once on mount, property
  // views are tracked with dwell time when the detail modal closes or
  // switches. Failures are swallowed inside the tracker — engagement
  // analytics must never affect the visitor experience.
  const trackerRef = useRef<ReturnType<typeof createShowcaseTracker> | null>(
    null
  );
  const viewStartRef = useRef<{ propertyId: string; at: number } | null>(null);
  // Mirror of selectedProperty?.id for the mount-only listeners below.
  const selectedPropertyIdRef = useRef<string | null>(null);
  useEffect(() => {
    trackerRef.current = createShowcaseTracker(accountId, visitorRef, shareId);
    trackerRef.current.track('open');
    const tracker = trackerRef.current;

    // Share links open with the detail modal already up, so the most
    // common visit — open link, look, close tab — never transitions
    // selectedProperty. Emit the in-progress view when the page hides,
    // or that view (and its dwell time) is lost entirely.
    const emitPendingView = () => {
      const pending = viewStartRef.current;
      if (!pending) return;
      viewStartRef.current = null;
      tracker.track('view_property', pending.propertyId, {
        duration_ms: Math.min(Date.now() - pending.at, MAX_DWELL_MS),
      });
      tracker.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        emitPendingView();
      } else if (selectedPropertyIdRef.current && !viewStartRef.current) {
        // Tab came back with the modal still open — restart the dwell
        // clock so continued viewing counts as a fresh view.
        viewStartRef.current = {
          propertyId: selectedPropertyIdRef.current,
          at: Date.now(),
        };
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', emitPendingView);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', emitPendingView);
      emitPendingView();
      tracker.flush();
    };
    // Mount-only by design: accountId/visitorRef/shareId are fixed per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamic Theme Resolver
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const urlTheme = urlParams.get('theme');
    const resolvedTheme =
      urlTheme || initialTheme || settings?.theme || 'violet';

    const validThemes = [
      'violet',
      'emerald',
      'cobalt',
      'amber',
      'rose',
      'verdant',
    ];
    if (validThemes.includes(resolvedTheme)) {
      document.documentElement.dataset.theme = resolvedTheme;
    }
  }, [settings?.theme, initialTheme]);

  const [selectedType, setSelectedType] = useState('All');
  const [selectedListingType, setSelectedListingType] = useState<
    'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit'
  >('All');
  const [minBeds, setMinBeds] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  // Share links (?property_id=...) render with the detail modal already open —
  // it's part of the server HTML, so the visitor never sees the grid flash
  // before the property appears.
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(
    () => findInitialProperty(properties, initialPropertyId)
  );
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  // Detail-modal gallery: the listing video rides the photo carousel as
  // the last slide (index = images.length) instead of its own panel.
  // Prefer the unlisted YouTube copy (adaptive streaming, zero delivery
  // cost); fall back to the storage-hosted MP4.
  // Guarded photos join the detail carousel behind the public ones when
  // a share grant opened them. Only their count travels — each is
  // fetched back through the proxy, which re-checks the token. They stay
  // out of the grid cards and the hero preload: a guarded facade must
  // not become a listing's cover photo.
  const detailImages = useMemo(() => {
    const publicImages = (selectedProperty?.images ?? []).map(storagePublicUrl);
    if (!selectedProperty?.private_images_revealed || !shareGrantToken) {
      return publicImages;
    }
    const guardedCount = selectedProperty.private_images_count ?? 0;
    return [
      ...publicImages,
      ...Array.from(
        { length: guardedCount },
        (_, i) => `/api/public/share-grant/${shareGrantToken}/image/${i}`
      ),
    ];
  }, [
    selectedProperty?.images,
    selectedProperty?.private_images_revealed,
    selectedProperty?.private_images_count,
    shareGrantToken,
  ]);
  const detailYouTubeId =
    selectedProperty?.youtube_status === 'ready'
      ? selectedProperty.youtube_video_id
      : null;
  const detailVideoUrl =
    selectedProperty?.video_status === 'ready'
      ? storagePublicUrl(selectedProperty.video_url)
      : null;
  const detailHasVideo = Boolean(detailYouTubeId || detailVideoUrl);
  // Only ever populated when the link carried a share grant that
  // revealed documents — the public payload omits them otherwise.
  const grantedDocuments = useMemo(
    () => parsePropertyDocuments(selectedProperty?.documents),
    [selectedProperty?.documents]
  );
  const detailMediaCount = detailImages.length + (detailHasVideo ? 1 : 0);
  const isVideoSlide = detailHasVideo && activeImageIdx >= detailImages.length;
  const detailTouchXRef = useRef<number | null>(null);

  // Pulse: record property views with dwell time. Runs on every
  // selectedProperty transition — closing or switching the modal emits the
  // previous property's view with its duration; unmount flushes via the
  // tracker's pagehide handler.
  const selectedPropertyId = selectedProperty?.id ?? null;
  useEffect(() => {
    selectedPropertyIdRef.current = selectedPropertyId;
    const prev = viewStartRef.current;
    if (prev && prev.propertyId !== selectedPropertyId) {
      trackerRef.current?.track('view_property', prev.propertyId, {
        duration_ms: Math.min(Date.now() - prev.at, MAX_DWELL_MS),
      });
      viewStartRef.current = null;
    }
    if (
      selectedPropertyId &&
      (!prev || prev.propertyId !== selectedPropertyId)
    ) {
      viewStartRef.current = { propertyId: selectedPropertyId, at: Date.now() };
    }
  }, [selectedPropertyId]);

  // ?mode=view (legacy: agent): clean listing detail view (no forms, buttons, or document requests)
  const [isAgentMode, setIsAgentMode] = useState(initialAgentMode);

  // Start fetching the share target's hero image from the document head,
  // before hydration and ahead of the grid's card images.
  const initialHeroUrl = selectedProperty?.images?.[0]
    ? showcaseImageUrl(
        storagePublicUrl(selectedProperty.images[0]),
        SHOWCASE_IMAGE_WIDTHS.hero
      )
    : null;
  if (initialHeroUrl) {
    ReactDOM.preload(initialHeroUrl, { as: 'image', fetchPriority: 'high' });
  }

  // Form states
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryPhone, setInquiryPhone] = useState('');
  const [inquiryEmail, setInquiryEmail] = useState('');
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Load visitor details and interests from localStorage
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [interestStatus, setInterestStatus] = useState<
    Record<string, 'interested' | 'not_interested'>
  >({});

  // ── Property Ratings ───────────────────────────────────────────
  // A one-tap, anonymous 1–10 "how well does this fit?" score — the single
  // feedback control that replaced the separate Like and Interested
  // prompts. A mount fetch hydrates this session's earlier ratings so a
  // returning visitor sees their scores. Buyers only — hidden in agent mode.
  const [ratings, setRatings] = useState<
    Record<string, { rating: number; miss_reasons: string[] }>
  >({});
  const nudgedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isAgentMode) return;
    const sessionKey = getShowcaseSessionKey();
    fetch(
      `/api/public/property-ratings?account_id=${accountId}&session_key=${sessionKey}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ratings) setRatings((prev) => ({ ...data.ratings, ...prev }));
      })
      .catch(() => {});
    // Mount-only: accountId is fixed per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postRating = async (
    property: Property,
    rating: number,
    missReasons: string[]
  ) => {
    try {
      await fetch('/api/public/property-ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          property_id: property.id,
          session_key: getShowcaseSessionKey(),
          rating,
          miss_reasons: missReasons,
          ref: visitorRef || referrerContactId || undefined,
        }),
      });
    } catch {
      // Fire-and-forget: the optimistic UI keeps the visitor's score.
    }
  };

  // Document request states
  const [docReqOpen, setDocReqOpen] = useState(false);
  const [docReqName, setDocReqName] = useState('');
  const [docReqPhone, setDocReqPhone] = useState('');
  const [docReqEmail, setDocReqEmail] = useState('');
  const [docReqSubmitting, setDocReqSubmitting] = useState(false);
  const [docReqSuccess, setDocReqSuccess] = useState<string | null>(null); // property id that was requested

  // Location reveal request states
  const [locReqOpen, setLocReqOpen] = useState(false);
  const [locReqName, setLocReqName] = useState('');
  const [locReqPhone, setLocReqPhone] = useState('');
  const [locReqSubmitting, setLocReqSubmitting] = useState(false);
  const [locReqSuccess, setLocReqSuccess] = useState<string | null>(null); // property id that was requested

  // Co-broker re-share link states (agent mode)
  const [reshareOpen, setReshareOpen] = useState(false);
  const [reshareName, setReshareName] = useState('');
  const [resharePhone, setResharePhone] = useState('');
  const [reshareSubmitting, setReshareSubmitting] = useState(false);
  const [reshareLink, setReshareLink] = useState<string | null>(null);
  const [reshareCopied, setReshareCopied] = useState(false);

  const isStateLoadedRef = useRef(false);

  // 1. Client-side mount hook to load state from URL and localStorage (retained for 7 days)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlCategory = urlParams.get('category');
    const urlPropertyId = urlParams.get('property_id');
    const urlListingType = urlParams.get('listing_type');
    const urlMinBeds = urlParams.get('beds');
    const urlSortBy = urlParams.get('sort');
    const urlSearchQuery = urlParams.get('search');

    // Clean listing mode: hide inquiry form, buttons, document requests
    // ('agent' is the legacy value for links shared before the rename)
    const urlMode = urlParams.get('mode');
    if (urlMode === 'view' || urlMode === 'agent') {
      setIsAgentMode(true);
    }

    let categoryToSet = 'All';
    let listingTypeToSet: 'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit' =
      'All';
    let bedsToSet = 'All';
    let sortByToSet = 'newest';
    let searchQueryToSet = '';
    let propertyIdToSet = '';

    interface SavedShowcaseState {
      timestamp: number;
      selectedType?: string;
      selectedListingType?: 'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';
      minBeds?: string;
      sortBy?: string;
      searchQuery?: string;
      selectedPropertyId?: string | null;
    }

    // Load from localStorage if less than 7 days old
    const savedStateStr = disableSavedState
      ? null
      : readStored('showcase_state');
    let savedState: SavedShowcaseState | null = null;
    if (savedStateStr) {
      try {
        const parsed = JSON.parse(savedStateStr) as SavedShowcaseState;
        const age = Date.now() - (parsed.timestamp || 0);
        if (age < 7 * 24 * 60 * 60 * 1000) {
          savedState = parsed;
        } else {
          removeStored('showcase_state');
        }
      } catch (e) {
        console.error('Failed to parse showcase state:', e);
      }
    }

    if (urlCategory) {
      categoryToSet = urlCategory;
    } else if (initialCategory) {
      categoryToSet = initialCategory;
    }

    if (
      urlListingType === 'Sale' ||
      urlListingType === 'Rent' ||
      urlListingType === 'JV/JD' ||
      urlListingType === 'Built to Suit'
    ) {
      listingTypeToSet = urlListingType;
    } else if (savedState?.selectedListingType) {
      listingTypeToSet = savedState.selectedListingType;
    }

    if (urlMinBeds) {
      bedsToSet = urlMinBeds;
    } else if (savedState?.minBeds) {
      bedsToSet = savedState.minBeds;
    }

    if (urlSortBy) {
      sortByToSet = urlSortBy;
    } else if (savedState?.sortBy) {
      sortByToSet = savedState.sortBy;
    }

    if (urlSearchQuery) {
      searchQueryToSet = urlSearchQuery;
    } else if (savedState?.searchQuery) {
      searchQueryToSet = savedState.searchQuery;
    }

    if (urlPropertyId) {
      propertyIdToSet = urlPropertyId;
    } else if (initialPropertyId) {
      propertyIdToSet = initialPropertyId;
    } else if (savedState?.selectedPropertyId) {
      propertyIdToSet = savedState.selectedPropertyId;
    }

    // Restore state
    if (categoryToSet !== 'All') setSelectedType(categoryToSet);
    if (listingTypeToSet !== 'All') setSelectedListingType(listingTypeToSet);
    if (bedsToSet !== 'All') setMinBeds(bedsToSet);
    if (sortByToSet !== 'newest') setSortBy(sortByToSet);
    if (searchQueryToSet) setSearchQuery(searchQueryToSet);

    if (propertyIdToSet) {
      const match = properties.find(
        (p) =>
          p.id === propertyIdToSet ||
          (p.property_code &&
            p.property_code.toLowerCase() === propertyIdToSet.toLowerCase())
      );
      if (match) {
        setSelectedProperty(match);
      }
    }

    isStateLoadedRef.current = true;
  }, [initialCategory, initialPropertyId, properties, disableSavedState]);

  // 2. Hook to save state to localStorage whenever filters or property details modal changes
  useEffect(() => {
    if (
      disableSavedState ||
      !isStateLoadedRef.current ||
      typeof window === 'undefined'
    )
      return;

    const stateToSave = {
      timestamp: Date.now(),
      selectedType,
      selectedListingType,
      minBeds,
      sortBy,
      searchQuery,
      selectedPropertyId:
        selectedProperty?.property_code || selectedProperty?.id || null,
    };

    writeStored('showcase_state', JSON.stringify(stateToSave));
  }, [
    selectedType,
    selectedListingType,
    minBeds,
    sortBy,
    searchQuery,
    selectedProperty,
    disableSavedState,
  ]);

  // 3. Debounced Search Analytics Event
  useEffect(() => {
    if (!isStateLoadedRef.current || !searchQuery.trim()) return;

    const timer = setTimeout(() => {
      trackPixelEvent('Search', {
        search_string: searchQuery.trim(),
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 4. Custom Filter Properties Analytics Event
  useEffect(() => {
    if (!isStateLoadedRef.current) return;
    if (
      selectedType === 'All' &&
      selectedListingType === 'All' &&
      minBeds === 'All' &&
      sortBy === 'newest'
    )
      return;

    trackPixelEvent('FilterProperties', {
      category: selectedType,
      listing_type: selectedListingType,
      bedrooms: minBeds,
      sort_by: sortBy,
    });
  }, [selectedType, selectedListingType, minBeds, sortBy]);

  // General requirements modal
  const [requirementsModalOpen, setRequirementsModalOpen] = useState(false);

  // General Requirements Form inputs
  const [reqName, setReqName] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqCategories, setReqCategories] = useState<string[]>([]);
  const [reqLocations, setReqLocations] = useState<string[]>([]);
  const [reqMinBudget, setReqMinBudget] = useState('');
  const [reqMaxBudget, setReqMaxBudget] = useState('');
  const [reqMinRoi, setReqMinRoi] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [newLocationTag, setNewLocationTag] = useState('');

  const isCommercialSelected = useMemo(() => {
    return reqCategories.some((cat) =>
      [
        'Commercial Building',
        'Office Space',
        'Shop/ Showroom',
        'Warehouse',
        'Commercial Land',
      ].includes(cat)
    );
  }, [reqCategories]);

  const toggleCategory = (cat: string) => {
    if (reqCategories.includes(cat)) {
      setReqCategories(reqCategories.filter((c) => c !== cat));
    } else {
      setReqCategories([...reqCategories, cat]);
    }
  };

  const addLocationTag = () => {
    if (
      newLocationTag.trim() &&
      !reqLocations.includes(newLocationTag.trim())
    ) {
      setReqLocations([...reqLocations, newLocationTag.trim()]);
      setNewLocationTag('');
    }
  };

  const removeLocationTag = (loc: string) => {
    setReqLocations(reqLocations.filter((l) => l !== loc));
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedName = readStored('visitor_name') || '';
      const storedPhone = readStored('visitor_phone') || '';
      const storedEmail = readStored('visitor_email') || '';
      const storedInterests = readStored('visitor_interests');

      setVisitorName(storedName);
      setVisitorPhone(storedPhone);
      setVisitorEmail(storedEmail);

      // Pre-fill inquiry form inputs if stored
      if (storedName) setInquiryName(storedName);
      if (storedPhone) setInquiryPhone(storedPhone);
      if (storedEmail) setInquiryEmail(storedEmail);

      if (storedInterests) {
        try {
          setInterestStatus(JSON.parse(storedInterests));
        } catch (e) {
          console.error('Failed to parse interests:', e);
        }
      }
    }
  }, []);

  // Dynamically inject Meta Pixel script if configured for this showcase/account
  useEffect(() => {
    if (settings?.meta_pixel_id) {
      if (!document.getElementById('meta-pixel-script')) {
        const script = document.createElement('script');
        script.id = 'meta-pixel-script';
        script.innerHTML = `
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
        `;
        document.head.appendChild(script);
      }

      // Initialize and fire PageView for the current ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fbq = (window as any).fbq;
      if (typeof fbq === 'function') {
        fbq('init', settings.meta_pixel_id);
        fbq('track', 'PageView');
      }
    }
  }, [settings?.meta_pixel_id]);

  const saveVisitorInfo = (name: string, phone: string, email?: string) => {
    writeStored('visitor_name', name);
    writeStored('visitor_phone', phone);
    if (email) {
      writeStored('visitor_email', email);
    }
    setVisitorName(name);
    setVisitorPhone(phone);
    if (email) {
      setVisitorEmail(email);
    }
    // Also update inquiry form states
    setInquiryName(name);
    setInquiryPhone(phone);
    if (email) setInquiryEmail(email);
  };

  const updateInterestStatus = (
    propertyId: string,
    status: 'interested' | 'not_interested'
  ) => {
    const updated = { ...interestStatus, [propertyId]: status };
    setInterestStatus(updated);
    writeStored('visitor_interests', JSON.stringify(updated));
  };

  // High ratings from a visitor we already know become a priority
  // follow-up lead, exactly like the old "Interested — Yes" flow, but
  // without interrupting the rating tap. First threshold-crossing only —
  // re-rating 8 → 9 must not create duplicate inquiries.
  const recordPriorityInterest = async (property: Property, rating: number) => {
    if (interestStatus[property.id] === 'interested') return;
    updateInterestStatus(property.id, 'interested');

    trackPixelEvent('Lead', {
      content_name: property.title,
      content_ids: [property.property_code || property.id],
      content_type: 'product',
      value: Number(property.price) || 0,
      currency: settings?.currency || 'INR',
      inquiry_type: 'high_rating',
    });

    if (!visitorName.trim() || !visitorPhone.trim()) return;
    try {
      await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: visitorName.trim(),
          phone: visitorPhone.trim(),
          email: visitorEmail.trim() || undefined,
          message: `Visitor rated this property ${rating}/10 — high interest.`,
          propertyId: property.id,
          propertyTitle: property.title,
          propertyCode: property.property_code,
          accountId,
          referrerContactId: property.agent_details?.id || referrerContactId,
          sessionKey: getShowcaseSessionKey(),
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const submitRating = (property: Property, rating: number) => {
    const existing = ratings[property.id];
    const missReasons =
      rating < HIGH_INTEREST_RATING ? (existing?.miss_reasons ?? []) : [];
    setRatings((prev) => ({
      ...prev,
      [property.id]: { rating, miss_reasons: missReasons },
    }));

    if (rating >= HIGH_INTEREST_RATING) {
      void recordPriorityInterest(property, rating);
    } else if (interestStatus[property.id] === 'interested') {
      const updated = { ...interestStatus };
      delete updated[property.id];
      setInterestStatus(updated);
      writeStored('visitor_interests', JSON.stringify(updated));
    }

    void postRating(property, rating, missReasons);
  };

  const toggleMissReason = (property: Property, reason: string) => {
    const existing = ratings[property.id];
    if (!existing) return;
    const missReasons = existing.miss_reasons.includes(reason)
      ? existing.miss_reasons.filter((r) => r !== reason)
      : [...existing.miss_reasons, reason];
    setRatings((prev) => ({
      ...prev,
      [property.id]: { ...existing, miss_reasons: missReasons },
    }));
    void postRating(property, existing.rating, missReasons);
  };

  const hideProperty = (property: Property) => {
    updateInterestStatus(property.id, 'not_interested');
    toast.info('Property hidden. You can undo this anytime.');
  };

  // Nudge: once a visitor has dwelled on a property for a few seconds
  // (they opened the detail modal and stuck around), gently prompt a
  // rating — but only once per property per session, and never if they
  // already rated it.
  useEffect(() => {
    if (isAgentMode || !selectedProperty) return;
    const property = selectedProperty;
    if (ratings[property.id] || nudgedRef.current.has(property.id)) return;
    const timer = setTimeout(() => {
      if (ratings[property.id] || nudgedRef.current.has(property.id)) return;
      nudgedRef.current.add(property.id);
      toast('How well does this one fit?', {
        description:
          'Rate it 1–10 below — one tap helps us fine-tune your matches.',
      });
    }, RATING_NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropertyId, isAgentMode, ratings]);

  const openRequirementsModal = () => {
    setReqName(visitorName);
    setReqPhone(visitorPhone);
    setReqEmail(visitorEmail);
    setRequirementsModalOpen(true);
  };

  const handleRequirementsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqName.trim() || !reqPhone.trim()) return;

    setReqSubmitting(true);
    try {
      const res = await fetch('/api/public/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reqName.trim(),
          phone: reqPhone.trim(),
          email: reqEmail.trim() || undefined,
          categories: reqCategories,
          locations: reqLocations,
          minBudget: reqMinBudget ? Number(reqMinBudget) : null,
          maxBudget: reqMaxBudget ? Number(reqMaxBudget) : null,
          minRoi: reqMinRoi ? Number(reqMinRoi) : null,
          notes: reqNotes.trim() || undefined,
          accountId,
          referrerContactId,
        }),
      });

      if (!res.ok) {
        throw new Error('Requirements submission failed');
      }

      saveVisitorInfo(reqName.trim(), reqPhone.trim(), reqEmail.trim());
      toast.success(
        'Your requirements have been recorded. Our team will contact you shortly!'
      );
      setRequirementsModalOpen(false);

      // Track Meta Pixel Lead event
      trackPixelEvent('Lead', {
        content_name: 'Requirements Submission',
        content_category: reqCategories.join(','),
        inquiry_type: 'requirements_form',
      });

      setReqCategories([]);
      setReqLocations([]);
      setReqMinBudget('');
      setReqMaxBudget('');
      setReqMinRoi('');
      setReqNotes('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to submit requirements. Please try again.');
    } finally {
      setReqSubmitting(false);
    }
  };

  // Fallback defaults if settings don't exist yet
  const siteName = siteNameProp || BRANDING.name;
  const displayPhone = referrerPhone || settings?.contact_phone || '';

  const getWhatsAppLink = (property: Property) => {
    const defaultTemplate =
      settings?.whatsapp_message_template ||
      'Hi! I am interested in your property "{title}" in {location}. Please share details.';

    let message = defaultTemplate
      .replace('{title}', property.title)
      .replace('{location}', property.location);

    if (property.property_code) {
      if (message.includes('{property_code}')) {
        message = message.replace('{property_code}', property.property_code);
      } else {
        message += ` (Property ID: ${property.property_code})`;
      }
    } else {
      message = message
        .replace('({property_code})', '')
        .replace('{property_code}', '');
    }

    const phone = property.agent_details?.phone || displayPhone || '';
    const cleanPhone = phone.replace(/\D/g, '') || '919876543210';
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  // Account-level handoff for the assistant, which talks about the
  // catalog rather than any one listing.
  const catalogWhatsAppLink = useMemo(() => {
    const cleanPhone = (displayPhone || '').replace(/\D/g, '');
    if (!cleanPhone) return undefined;
    const message = `Hi! I was browsing your property showcase and would like some help.`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  }, [displayPhone]);

  // Check if selected property is land/plot type
  const isSelectedPropertyLand = useMemo(() => {
    if (!selectedProperty) return false;
    return [
      'Residential Land/ Plot',
      'Commercial Land',
      'Industrial Land',
      'Agricultural Land',
    ].includes(selectedProperty.type);
  }, [selectedProperty]);

  // Check if selected property has technical specifications to show
  const hasSpecs = useMemo(() => {
    if (!selectedProperty) return false;
    return !!(
      selectedProperty.project ||
      (isSelectedPropertyLand
        ? selectedProperty.land_area
        : selectedProperty.area_sqft) ||
      selectedProperty.facing_direction ||
      selectedProperty.dimensions ||
      selectedProperty.land_zone ||
      selectedProperty.road_width
    );
  }, [selectedProperty, isSelectedPropertyLand]);

  // Get distinct property types
  const propertyTypes = useMemo(() => {
    const types = new Set<string>();
    let hasResidential = false;
    let hasCommercial = false;
    let hasAgricultural = false;

    properties.forEach((p) => {
      if (p.type) {
        types.add(p.type);
        if (CATEGORY_SUBTYPES.Residential.includes(p.type))
          hasResidential = true;
        if (CATEGORY_SUBTYPES.Commercial.includes(p.type)) hasCommercial = true;
        if (CATEGORY_SUBTYPES.Agricultural.includes(p.type))
          hasAgricultural = true;
      }
    });

    const list = ['All'];
    if (hasResidential) list.push('Residential');
    if (hasCommercial) list.push('Commercial');
    if (hasAgricultural) list.push('Agricultural');

    return [...list, ...Array.from(types)];
  }, [properties]);

  // Format price helper
  const formatPrice = (amount: number) => {
    const currency = settings?.currency || 'INR';
    if (currency === 'INR') {
      if (amount >= 10000000) {
        const cr = amount / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      } else if (amount >= 100000) {
        const lakhs = amount / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Filter & Sort properties
  const filteredProperties = useMemo(() => {
    let result = [...properties];

    // Filter by type
    if (selectedType !== 'All') {
      if (selectedType in CATEGORY_SUBTYPES) {
        result = result.filter((p) =>
          CATEGORY_SUBTYPES[selectedType].includes(p.type)
        );
      } else {
        result = result.filter((p) => p.type === selectedType);
      }
    }

    // Filter by listing type
    if (selectedListingType !== 'All') {
      result = result.filter(
        (p) => (p.listing_type || 'Sale') === selectedListingType
      );
    }

    // Filter by beds
    if (minBeds !== 'All') {
      const beds = parseInt(minBeds, 10);
      result = result.filter((p) => p.bedrooms && p.bedrooms >= beds);
    }

    // Filter by search query — supports natural language
    if (searchQuery) {
      const parsed = parsePropertyQuery(searchQuery);

      // Apply price range from parsed query
      if (parsed.minPrice !== null) {
        result = result.filter((p) => p.price >= parsed.minPrice!);
      }
      if (parsed.maxPrice !== null) {
        result = result.filter((p) => p.price <= parsed.maxPrice!);
      }

      // Apply type filter from parsed query
      if (parsed.types.length > 0) {
        result = result.filter((p) => parsed.types.includes(p.type));
      }

      if (parsed.rentYielding) {
        result = result.filter(
          (p) => (p.rental_income ?? 0) > 0 || (p.roi ?? 0) > 0
        );
      }

      if (parsed.listingSource) {
        result = result.filter(
          (p) => (p.listing_source ?? 'owner') === parsed.listingSource
        );
      }

      // Apply text search on remaining search terms
      if (parsed.remainingSearch) {
        const text = parsed.remainingSearch;
        result = result.filter(
          (p) =>
            p.title.toLowerCase().includes(text) ||
            p.location.toLowerCase().includes(text) ||
            p.sublocality?.toLowerCase().includes(text) ||
            p.city?.toLowerCase().includes(text) ||
            (p.project && p.project.toLowerCase().includes(text)) ||
            p.property_code?.toLowerCase().includes(text)
        );
      }
    }

    // Sort
    if (sortBy === 'price-low') {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-high') {
      result.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'area-high') {
      result.sort((a, b) => (b.area_sqft || 0) - (a.area_sqft || 0));
    } else {
      // newest
      result.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return result;
  }, [
    properties,
    selectedType,
    selectedListingType,
    minBeds,
    searchQuery,
    sortBy,
  ]);

  // Document request submission handler
  const handleDocRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docReqName.trim() || !docReqPhone.trim() || !selectedProperty) return;
    setDocReqSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/properties/${selectedProperty.id}/document-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_name: docReqName.trim(),
            requester_phone: docReqPhone.trim(),
            requester_email: docReqEmail.trim() || undefined,
            account_id: accountId,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      // Pre-fill visitor info for future forms
      saveVisitorInfo(
        docReqName.trim(),
        docReqPhone.trim(),
        docReqEmail.trim()
      );
      setDocReqSuccess(selectedProperty.id);
      toast.success(
        'Document request submitted! The agent will review and share documents with you via WhatsApp.'
      );
    } catch (err) {
      console.error(err);
      const msg =
        err instanceof Error ? err.message : 'Failed to submit request';
      toast.error(msg);
    } finally {
      setDocReqSubmitting(false);
    }
  };

  // Location reveal request submission handler
  const handleLocReqSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locReqName.trim() || !locReqPhone.trim() || !selectedProperty) return;
    setLocReqSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/properties/${selectedProperty.id}/location-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_name: locReqName.trim(),
            requester_phone: locReqPhone.trim(),
            account_id: accountId,
            via_contact_id: visitorRef || undefined,
            via_share_id: shareId || undefined,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      saveVisitorInfo(locReqName.trim(), locReqPhone.trim());
      setLocReqSuccess(selectedProperty.id);
      toast.success(
        'Location request submitted! You will receive the exact location on WhatsApp once approved.'
      );
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to submit request'
      );
    } finally {
      setLocReqSubmitting(false);
    }
  };

  // Co-broker re-share link mint handler
  const handleReshareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reshareName.trim() || !resharePhone.trim() || !selectedProperty)
      return;
    setReshareSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/properties/${selectedProperty.id}/reshare-link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: reshareName.trim(),
            phone: resharePhone.trim(),
            account_id: accountId,
            via_contact_id: visitorRef || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Request failed');
      }
      setReshareLink(data.link || null);
      toast.success(
        data.delivered
          ? 'Your personal share link is ready — also sent to your WhatsApp.'
          : 'Your personal share link is ready — copy it below.'
      );
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to create your link'
      );
    } finally {
      setReshareSubmitting(false);
    }
  };

  // Form submission handler
  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryName.trim() || !inquiryPhone.trim() || !selectedProperty)
      return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inquiryName.trim(),
          phone: inquiryPhone.trim(),
          email: inquiryEmail.trim() || undefined,
          message: inquiryMessage.trim() || undefined,
          propertyId: selectedProperty.id,
          propertyTitle: selectedProperty.title,
          propertyCode: selectedProperty.property_code,
          accountId,
          referrerContactId:
            selectedProperty.agent_details?.id || referrerContactId,
          sessionKey: getShowcaseSessionKey(),
        }),
      });

      if (!res.ok) {
        throw new Error('Inquiry submission failed');
      }

      setSubmitSuccess(true);
      toast.success('Your inquiry has been submitted successfully!');

      // Track Meta Pixel Lead event
      trackPixelEvent('Lead', {
        content_name: selectedProperty.title,
        content_ids: [selectedProperty.property_code || selectedProperty.id],
        content_type: 'product',
        value: Number(selectedProperty.price) || 0,
        currency: settings?.currency || 'INR',
        inquiry_type: 'inquiry_form',
      });

      // Clear inputs
      setInquiryName('');
      setInquiryPhone('');
      setInquiryEmail('');
      setInquiryMessage('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to submit inquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Deep-linking mount logic
  useEffect(() => {
    if (initialPropertyId) {
      const match = properties.find(
        (p) =>
          p.id === initialPropertyId ||
          (p.property_code &&
            p.property_code.toLowerCase() === initialPropertyId.toLowerCase())
      );
      if (match) {
        setSelectedProperty(match);
        setActiveImageIdx(0);
        setSubmitSuccess(false);

        // Track Meta Pixel ViewContent event on deep-link mount
        trackPixelEvent('ViewContent', {
          content_ids: [match.property_code || match.id],
          content_type: 'product',
          content_name: match.title,
          value: Number(match.price) || 0,
          currency: settings?.currency || 'INR',
        });
      }
    }
  }, [initialPropertyId, properties, settings?.currency]);

  const openPropertyModal = (property: Property) => {
    setSelectedProperty(property);
    setActiveImageIdx(0);
    setSubmitSuccess(false);
    // Reset doc request form when switching property
    setDocReqOpen(false);
    setDocReqSuccess(null);

    // Sync URL property_id parameter
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set(
        'property_id',
        property.property_code || property.id
      );
      window.history.pushState({}, '', url.toString());

      // Track Meta Pixel ViewContent event
      trackPixelEvent('ViewContent', {
        content_ids: [property.property_code || property.id],
        content_type: 'product',
        content_name: property.title,
        value: Number(property.price) || 0,
        currency: settings?.currency || 'INR',
      });
    }
  };

  const trackWhatsAppInquiry = (property: Property) => {
    trackPixelEvent('Lead', {
      content_name: property.title,
      content_ids: [property.property_code || property.id],
      content_type: 'product',
      value: Number(property.price) || 0,
      currency: settings?.currency || 'INR',
      inquiry_type: 'whatsapp_click',
    });

    trackPixelEvent('Contact', {
      content_name: property.title,
      content_ids: [property.property_code || property.id],
      contact_method: 'whatsapp',
    });
  };

  const closePropertyModal = () => {
    setSelectedProperty(null);

    // Sync URL property_id parameter (remove it)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('property_id');
      window.history.pushState({}, '', url.toString());
    }
  };

  const getPropertyShareUrl = (property: Property) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('property_id', property.property_code || property.id);

    // Preserve ref/agent_id parameter if active
    const currentUrl = new URL(window.location.href);
    const refParam =
      currentUrl.searchParams.get('ref') ||
      currentUrl.searchParams.get('account_id') ||
      currentUrl.searchParams.get('agent_id');
    if (refParam) {
      url.searchParams.set('ref', refParam);
    }
    return url.toString();
  };

  const handleShareListing = async (
    property: Property,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    trackPixelEvent('ShareProperty', {
      content_name: property.title,
      content_ids: [property.property_code || property.id],
      content_type: 'product',
    });

    const url = getPropertyShareUrl(property);
    if (!url) return;

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      try {
        await navigator.share({
          title: property.title,
          text: `Check out this property: ${property.title}${property.property_code ? ` (ID: ${property.property_code})` : ''}`,
          url: url,
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }

    navigator.clipboard.writeText(url);
    toast.success('Property link copied to clipboard!');
  };

  return (
    <div className="selection:bg-primary relative flex min-h-screen flex-col overflow-hidden bg-slate-950 font-sans text-slate-100 selection:text-white">
      {/* Decorative Radial Background Lights */}
      <div className="bg-primary/8 pointer-events-none absolute top-0 left-1/4 h-[600px] w-[600px] rounded-full blur-[130px]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 h-[500px] w-[500px] rounded-full bg-indigo-500/8 blur-[110px]" />

      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-900/60 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="from-primary to-indigo-650 shadow-primary/20 flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-gradient-to-br text-base font-black tracking-tighter text-white shadow-md">
              {siteName.charAt(0).toUpperCase()}
            </div>
            <span className="via-slate-150 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-base font-black tracking-tight text-transparent">
              {siteName}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {displayPhone && (
              <a
                href={`tel:${displayPhone.replace(/\s+/g, '')}`}
                onClick={() =>
                  trackPixelEvent('Contact', { contact_method: 'phone' })
                }
                className="hidden items-center gap-1.5 text-xs font-semibold text-slate-400 transition-all hover:text-white md:flex"
              >
                <Phone className="text-primary size-3.5 shrink-0" />
                {displayPhone}
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={openRequirementsModal}
              className="border-primary/20 bg-primary/8 hover:bg-primary/15 text-primary hover:text-primary-hover cursor-pointer rounded-xl px-4 text-xs font-bold transition-all"
            >
              Share Requirements
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (window.location.href = '/dashboard')}
              className="hover:bg-slate-850 cursor-pointer rounded-xl border-slate-900 bg-slate-900/40 px-4 text-xs font-bold text-slate-300 transition-all hover:text-white"
            >
              Portal Login
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="animate-fade-in mx-auto mb-12 max-w-3xl text-center">
          <h1 className="text-4xl leading-tight font-black tracking-tight text-white sm:text-5xl">
            {hero?.title || 'Discover Your Dream'}{' '}
            <span className="from-primary to-primary/80 bg-gradient-to-r via-indigo-400 bg-clip-text text-transparent">
              {hero?.highlight || 'Properties & Spaces'}
            </span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed font-medium text-slate-400 sm:text-base">
            {hero?.subtitle ||
              'Browse through our handpicked collection of premium villa plots, residential land, apartments, and commercial spaces. Managed directly by property owners and agents.'}
          </p>
          {hero?.badges && hero.badges.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {hero.badges.map((badge) => (
                <span
                  key={badge}
                  className="border-primary/20 bg-primary/8 text-primary rounded-full border px-3.5 py-1.5 text-xs font-bold"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Project facts — builder, gallery, amenities. Only set on
            /projects/[slug] pages, where every listing below shares one
            building and this is the one place to say so. */}
        {projectInfo &&
          (projectInfo.builder ||
            projectInfo.description ||
            projectInfo.images?.length ||
            projectInfo.amenities?.length) && (
            <div className="animate-fade-in mb-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              {(projectInfo.builder || projectInfo.description) && (
                <div className="mb-5">
                  {projectInfo.builder && (
                    <p className="text-primary text-xs font-bold tracking-wider uppercase">
                      By {projectInfo.builder}
                    </p>
                  )}
                  {projectInfo.description && (
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                      {projectInfo.description}
                    </p>
                  )}
                </div>
              )}
              {projectInfo.images && projectInfo.images.length > 0 && (
                <div className="mb-5 flex gap-3 overflow-x-auto pb-1">
                  {projectInfo.images.map((img, idx) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={img}
                      src={showcaseImageUrl(
                        storagePublicUrl(img),
                        SHOWCASE_IMAGE_WIDTHS.card
                      )}
                      alt={`${hero?.highlight || 'Project'} photo ${idx + 1}`}
                      loading="lazy"
                      className="h-32 w-48 shrink-0 rounded-xl border border-slate-800 object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ))}
                </div>
              )}
              {projectInfo.amenities && projectInfo.amenities.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {projectInfo.amenities.map((amenity) => (
                    <span
                      key={amenity}
                      className="border-slate-750 rounded-full border bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300"
                    >
                      {amenity}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

        {/* Next-step CTAs — get alerted on hot deals, or list your own property */}
        <div className="animate-fade-in mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="border-primary/20 bg-primary/5 flex flex-col items-start gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center">
            <div className="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
              <Bell className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black text-white">
                Never miss a hot or urgent deal
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                Tell us your budget and locality — we&apos;ll message you on
                WhatsApp the moment a matching or urgently-priced listing goes
                live.
              </p>
            </div>
            <Button
              onClick={openRequirementsModal}
              className="bg-primary hover:bg-primary/90 text-primary-foreground w-full shrink-0 cursor-pointer px-4 text-xs font-bold sm:w-auto"
            >
              Get Deal Alerts
            </Button>
          </div>

          <div className="flex flex-col items-start gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:flex-row sm:items-center">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Home className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black text-white">
                Have a property to sell or rent?
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                List it in minutes — paste the details, add photos, and
                we&apos;ll verify you on WhatsApp. Or just message us and
                we&apos;ll walk you through it.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <a
                href={`/list?ref=${accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackPixelEvent('Lead', {
                    inquiry_type: 'list_property_click',
                  })
                }
              >
                <Button className="w-full cursor-pointer bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500 sm:w-auto">
                  List My Property
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-900/60 bg-slate-900/35 p-5 shadow-xl backdrop-blur-md transition-all duration-300 hover:border-slate-800/80">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Search Input */}
            <div className="relative lg:col-span-4">
              <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search properties — "2 BHK villa" or "price > 50 Cr"'
                className="placeholder:text-slate-650 focus:border-primary focus:ring-primary w-full rounded-xl border-slate-900 bg-slate-950/60 pl-11 text-white transition-all focus:ring-1"
              />
            </div>

            {/* Listing Type Filter */}
            <div className="relative flex items-center gap-2 lg:col-span-2">
              <Filter className="size-4 shrink-0 text-slate-500" />
              <select
                value={selectedListingType}
                onChange={(e) =>
                  setSelectedListingType(
                    e.target.value as
                      | 'All'
                      | 'Sale'
                      | 'Rent'
                      | 'JV/JD'
                      | 'Built to Suit'
                  )
                }
                className="text-slate-350 focus:border-primary focus:ring-primary w-full cursor-pointer rounded-xl border border-slate-900 bg-slate-950/60 p-2.5 text-sm transition-all focus:ring-1 focus:outline-none"
              >
                <option value="All">All Listings</option>
                <option value="Sale">For Sale</option>
                <option value="Rent">For Rent</option>
                <option value="JV/JD">JV / Joint Development</option>
                <option value="Built to Suit">Built to Suit</option>
              </select>
            </div>

            {/* Bedroom Filter */}
            <div className="relative flex items-center gap-2 lg:col-span-2">
              <Filter className="size-4 shrink-0 text-slate-500" />
              <select
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                className="text-slate-350 focus:border-primary focus:ring-primary w-full cursor-pointer rounded-xl border border-slate-900 bg-slate-950/60 p-2.5 text-sm transition-all focus:ring-1 focus:outline-none"
              >
                <option value="All">All Bedrooms</option>
                <option value="1">1+ BHK</option>
                <option value="2">2+ BHK</option>
                <option value="3">3+ BHK</option>
                <option value="4">4+ BHK</option>
              </select>
            </div>

            {/* Sort Control */}
            <div className="relative flex items-center gap-2 lg:col-span-4">
              <ArrowUpDown className="size-4 shrink-0 text-slate-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-slate-350 focus:border-primary focus:ring-primary w-full cursor-pointer rounded-xl border border-slate-900 bg-slate-950/60 p-2.5 text-sm transition-all focus:ring-1 focus:outline-none"
              >
                <option value="newest">Newest Listed</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="area-high">Area: Largest First</option>
              </select>
            </div>
          </div>

          {/* Type Pills */}
          <div className="flex scrollbar-none flex-wrap items-center gap-2 overflow-x-auto border-t border-slate-900/60 pt-2.5">
            <span className="text-slate-550 mr-2 text-xs font-bold tracking-wider uppercase">
              Category:
            </span>
            {propertyTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all ${
                  selectedType === type
                    ? 'bg-primary text-primary-foreground border-primary shadow-primary/20 shadow-md'
                    : 'border-slate-900 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Listings Result Grid */}
        {filteredProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-900 bg-slate-900/10 py-20 text-center">
            <Building className="text-slate-750 mb-3 size-16 animate-pulse opacity-40" />
            <h3 className="mb-1 text-lg font-bold text-white">
              No matching properties found
            </h3>
            <p className="max-w-sm text-sm text-slate-400">
              We couldn&apos;t find any published properties matching your
              criteria. Try adjusting filters or search phrase.
            </p>
          </div>
        ) : (
          <div className="animate-fade-in-up grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredProperties.map((property) => {
              const hasImages = property.images && property.images.length > 0;
              const mainImage = hasImages
                ? storagePublicUrl(property.images[0])
                : null;
              const isLand = [
                'Residential Land/ Plot',
                'Commercial Land',
                'Industrial Land',
                'Agricultural Land',
                'Land',
              ].includes(property.type);

              if (interestStatus[property.id] === 'not_interested') {
                return (
                  <div
                    key={property.id}
                    className="flex h-52 flex-col items-center justify-center space-y-3 rounded-2xl border border-dashed border-slate-900 bg-slate-900/10 p-6 text-center transition-all duration-300"
                  >
                    <Building className="size-8 text-slate-700 opacity-40" />
                    <div>
                      <h4 className="line-clamp-1 text-sm font-bold text-slate-400">
                        {property.title}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        You marked this property as not interested.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const updated = { ...interestStatus };
                        delete updated[property.id];
                        setInterestStatus(updated);
                        writeStored(
                          'visitor_interests',
                          JSON.stringify(updated)
                        );
                      }}
                      className="border-slate-850 cursor-pointer bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                    >
                      Show property again
                    </Button>
                  </div>
                );
              }

              return (
                <div
                  key={property.id}
                  className={`hover:shadow-primary/4 group relative flex flex-col overflow-hidden rounded-3xl border bg-slate-900/20 transition-all duration-500 hover:border-slate-800 hover:shadow-2xl ${
                    interestStatus[property.id] === 'interested'
                      ? 'border-emerald-500/35 shadow-lg ring-1 shadow-emerald-950/10 ring-emerald-500/20'
                      : 'border-slate-900/60'
                  }`}
                >
                  {/* Image Container */}
                  <div
                    onClick={() => openPropertyModal(property)}
                    className="relative h-52 w-full shrink-0 cursor-pointer overflow-hidden bg-slate-950"
                  >
                    {mainImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={showcaseImageUrl(
                          mainImage,
                          SHOWCASE_IMAGE_WIDTHS.card
                        )}
                        alt={property.title}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          // Resize endpoint unavailable → fall back to the original file
                          if (e.currentTarget.src !== mainImage)
                            e.currentTarget.src = mainImage;
                        }}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-950 text-slate-600">
                        <Building className="size-12 opacity-30" />
                        <span className="text-[11px] font-semibold text-slate-500">
                          No Photos Available
                        </span>
                      </div>
                    )}

                    {/* Subtle gradient overlay at the bottom of the image */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/60 to-transparent" />

                    {/* Overlay Category Tag */}
                    <div className="text-primary absolute top-3 left-3 rounded-full border border-slate-800/80 bg-slate-950/80 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider uppercase backdrop-blur-md">
                      {property.type}
                    </div>

                    {interestStatus[property.id] === 'interested' && (
                      <div className="absolute top-3 right-3 rounded-full bg-emerald-500/90 px-2.5 py-0.5 text-[9px] font-extrabold tracking-wider text-white uppercase shadow-md backdrop-blur-sm">
                        Interested
                      </div>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                          {property.project ? `🏢 ${property.project}` : ''}
                        </span>
                        {property.property_code && (
                          <span className="shrink-0 rounded border border-slate-900/30 bg-slate-950/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                            {property.property_code}
                          </span>
                        )}
                      </div>
                      <h3
                        onClick={() => openPropertyModal(property)}
                        className="group-hover:text-primary line-clamp-1 cursor-pointer text-base font-bold text-white transition-colors"
                        title={property.title}
                      >
                        {property.title}
                      </h3>
                      <div className="mt-1 mb-3 flex items-center gap-1 text-xs text-slate-400">
                        <MapPin className="text-slate-650 size-3.5 shrink-0" />
                        <span className="truncate">
                          {property.sublocality && property.city
                            ? `${property.sublocality}, ${property.city}`
                            : property.city ||
                              property.sublocality ||
                              'Location shared on inquiry'}
                        </span>
                      </div>

                      {/* Specs Grid */}
                      <div className="text-slate-350 mb-4 grid grid-cols-3 gap-2 border-y border-slate-900/60 py-3 text-xs font-semibold">
                        {[
                          'Flat/ Apartment',
                          'Residential House',
                          'Villa',
                          'Builder Floor Apartment',
                          'Penthouse',
                          'Studio Apartment',
                          'Farm House',
                          'House',
                        ].includes(property.type) ? (
                          <>
                            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/40 py-2">
                              <BedDouble className="mb-0.5 size-3.5 text-slate-500" />
                              <span>
                                {property.bedrooms
                                  ? `${property.bedrooms} BHK`
                                  : '--'}
                              </span>
                            </div>
                            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/40 py-2">
                              <Bath className="mb-0.5 size-3.5 text-slate-500" />
                              <span>
                                {property.bathrooms
                                  ? `${property.bathrooms} Bath`
                                  : '--'}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="col-span-2 flex flex-col items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/40 py-2">
                              <span className="text-[10px] text-slate-500">
                                Zoning
                              </span>
                              <span className="max-w-full truncate text-slate-300">
                                {property.land_zone || 'Residential'}
                              </span>
                            </div>
                          </>
                        )}
                        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/40 py-2">
                          <Maximize2 className="mb-0.5 size-3.5 text-slate-500" />
                          <span className="max-w-full truncate">
                            {isLand
                              ? property.land_area
                                ? `${property.land_area} ${property.land_area_unit || 'Sq.Ft.'}`
                                : '--'
                              : property.area_sqft
                                ? `${property.area_sqft} ${property.area_unit || 'Sq.Ft.'}`
                                : '--'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {/* Quick rating bar — hidden in agent mode */}
                      {!isAgentMode && (
                        <div className="mb-3 border-b border-slate-900/60 pb-3">
                          <PropertyRatingBar
                            compact
                            value={ratings[property.id]?.rating ?? null}
                            missReasons={
                              ratings[property.id]?.miss_reasons ?? []
                            }
                            onRate={(rating) => submitRating(property, rating)}
                            onToggleReason={(reason) =>
                              toggleMissReason(property, reason)
                            }
                            onHide={() => hideProperty(property)}
                          />
                        </div>
                      )}

                      {/* Price & Primary CTA */}
                      <div className="mt-2 flex items-center justify-between gap-2 pt-2">
                        <div className="flex flex-col">
                          <span className="text-slate-550 text-[10px] font-bold tracking-wider uppercase">
                            {property.listing_type === 'Rent' ||
                            property.listing_type === 'Built to Suit'
                              ? 'Rent'
                              : property.listing_type === 'JV/JD'
                                ? 'JV / JD'
                                : property.teaser_gated
                                  ? 'Guide Price'
                                  : 'Price'}
                          </span>
                          <span className="text-lg leading-tight font-black text-white">
                            {property.listing_type === 'Rent' ||
                            property.listing_type === 'Built to Suit' ? (
                              <span>
                                {formatPrice(property.rent_per_month || 0)}/mo
                              </span>
                            ) : property.listing_type === 'JV/JD' ? (
                              <span>
                                {property.owner_share_percent &&
                                property.builder_share_percent
                                  ? `${property.owner_share_percent}:${property.builder_share_percent} share`
                                  : 'Enquire'}
                              </span>
                            ) : property.teaser_gated ? (
                              <span>{property.price_band || 'On request'}</span>
                            ) : (
                              formatPrice(property.price)
                            )}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {!isAgentMode &&
                            (displayPhone || property.agent_details?.phone) && (
                              <a
                                href={getWhatsAppLink(property)}
                                onClick={() => trackWhatsAppInquiry(property)}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:bg-green-550 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-green-600 text-white shadow-md shadow-green-950/40 transition-all hover:scale-105"
                                title="Inquire via WhatsApp"
                              >
                                <MessageCircle className="text-green-650 size-4.5 fill-white" />
                              </a>
                            )}
                          <Button
                            size="icon"
                            onClick={(e) => handleShareListing(property, e)}
                            className="hover:bg-slate-850 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-900 bg-slate-950/60 text-slate-300 shadow-md transition-all hover:scale-105 hover:text-white"
                            title="Share Listing"
                          >
                            <Share2 className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => openPropertyModal(property)}
                            className="hover:bg-slate-850 cursor-pointer rounded-xl border border-slate-900 bg-slate-950/60 text-xs font-semibold text-white"
                          >
                            Details
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA Requirements Ingestion Banner */}
        <div className="relative mt-12 overflow-hidden rounded-3xl border border-slate-900/60 bg-gradient-to-r from-slate-900/40 via-indigo-950/10 to-slate-900/20 p-6 shadow-2xl backdrop-blur-xl transition-all duration-500 hover:border-slate-800/80 sm:p-8">
          {/* Decorative glows */}
          <div className="bg-primary/10 pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-indigo-500/10 blur-[70px]" />

          <div className="relative z-10 grid grid-cols-1 items-center gap-6 lg:grid-cols-2">
            <div className="text-left">
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                Can&apos;t find your ideal property?
              </h2>
              <p className="mt-2 text-sm leading-relaxed font-medium text-slate-400">
                Tell the assistant what you&apos;re after — it will pull matches
                from this catalog straight away, and the team will follow up
                with the off-market ones on WhatsApp.
              </p>
              <Button
                onClick={openRequirementsModal}
                className="bg-primary hover:bg-primary-hover hover:shadow-primary/30 shadow-primary/25 mt-4 cursor-pointer rounded-xl px-6 py-5 text-xs font-bold text-white shadow-lg transition-all hover:scale-102"
              >
                Submit Requirements
              </Button>
            </div>
            {!isAgentMode && (
              <ShowcaseLeadBot
                variant="inline"
                accountId={accountId}
                properties={properties}
                whatsappLink={catalogWhatsAppLink}
                referrerContactId={referrerContactId}
                onSelectProperty={openPropertyModal}
                onWhatsAppClick={() =>
                  trackPixelEvent('Contact', {
                    contact_method: 'whatsapp_assistant',
                  })
                }
                onAccountClick={() =>
                  trackPixelEvent('CompleteRegistration', {
                    content_name: 'Buyer Den account',
                  })
                }
              />
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 w-full border-t border-slate-900 bg-slate-950 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:px-6 md:flex-row lg:px-8">
          <p className="text-xs text-slate-500">
            © 2026 {siteName}. Powered by ConvoReal. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {displayPhone && <span>Inquire: {displayPhone}</span>}
            <span className="text-slate-700">|</span>
            <a
              href="/login"
              className="hover:text-primary transition-colors hover:underline"
            >
              Agent Portal
            </a>
          </div>
        </div>
      </footer>
      {/* Property Detail Modal.
             Mobile/tablet: the card takes its natural height and the overlay
             itself scrolls — centering a taller-than-viewport card with
             items-center clipped its top half off-screen with no way to
             scroll up to it (the "partially visible" modal). The close
             button is pinned to the overlay so it survives the scroll.
             Desktop (lg): side-by-side panes capped at 90dvh, details
             pane scrolls internally. */}
      {/* A teaser-gated listing gets the gate INSTEAD of the detail
          modal — the detail modal renders fields the server withheld,
          so it has nothing to show and would only look broken. */}
      {selectedProperty?.teaser_gated && (
        <TeaserGate
          property={selectedProperty}
          accountId={accountId}
          visitorName={visitorName}
          visitorPhone={visitorPhone}
          visitorRef={visitorRef}
          shareId={shareId}
          onSaveVisitorInfo={saveVisitorInfo}
          onClose={closePropertyModal}
        />
      )}

      {selectedProperty && !selectedProperty.teaser_gated && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md">
          <div className="sticky top-0 z-20 h-0 lg:hidden">
            <button
              onClick={closePropertyModal}
              className="absolute top-3 right-3 cursor-pointer rounded-full border border-slate-700 bg-slate-950/80 p-2 text-slate-300 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          <div
            className="flex min-h-full items-center justify-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) closePropertyModal();
            }}
          >
            <div className="animate-zoom-in relative flex w-full max-w-4xl flex-col overflow-hidden border border-slate-900/60 bg-slate-900/85 shadow-2xl backdrop-blur-xl sm:rounded-3xl lg:max-h-[90dvh] lg:flex-row">
              {/* Close Button */}
              <button
                onClick={closePropertyModal}
                className="absolute top-3 right-3 z-10 hidden cursor-pointer rounded-full border border-slate-800/80 bg-slate-950/80 p-1.5 text-slate-400 hover:text-white lg:block"
              >
                <X className="size-4" />
              </button>

              {/* Left Pane: Gallery — shrink-0 so the details pane below
                can't squeeze it (or its thumbnail strip) on mobile.
                45dvh gives portrait listing videos a usable stage.
                overflow-hidden keeps anything inside the 45dvh box: the
                pane is positioned, so an overflowing child paints over
                the details pane below it (the card's own overflow-hidden
                only clips at the card edge). */}
              <div className="relative flex h-[45dvh] min-h-[300px] w-full shrink-0 flex-col overflow-hidden bg-slate-950 lg:h-auto lg:w-[50%] lg:shrink">
                {detailMediaCount > 0 ? (
                  <>
                    {/* Main Viewer — photos first, the listing video as
                      the last slide of the same carousel. Touch swipe
                      navigates alongside the arrow buttons.
                      min-h-0 (and no h-full) so it yields the thumbnail
                      strip's 64px: with an automatic minimum size the
                      viewer refused to shrink and the strip was pushed
                      over the title below it. */}
                    <div
                      className="relative flex min-h-0 w-full flex-1 items-center justify-center bg-slate-950"
                      onTouchStart={(e) => {
                        detailTouchXRef.current = e.touches[0].clientX;
                      }}
                      onTouchEnd={(e) => {
                        const startX = detailTouchXRef.current;
                        detailTouchXRef.current = null;
                        // A drag on the video element is scrubbing, not a swipe.
                        if (
                          startX === null ||
                          (e.target as HTMLElement).tagName === 'VIDEO'
                        )
                          return;
                        const delta = e.changedTouches[0].clientX - startX;
                        if (Math.abs(delta) < 50 || detailMediaCount < 2)
                          return;
                        setActiveImageIdx((prev) =>
                          delta < 0
                            ? prev < detailMediaCount - 1
                              ? prev + 1
                              : 0
                            : prev > 0
                              ? prev - 1
                              : detailMediaCount - 1
                        );
                      }}
                    >
                      {isVideoSlide ? (
                        detailYouTubeId ? (
                          <iframe
                            src={`https://www.youtube-nocookie.com/embed/${detailYouTubeId}`}
                            title={`${selectedProperty.title} — listing video`}
                            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="h-full w-full"
                          />
                        ) : (
                          <video
                            src={detailVideoUrl!}
                            controls
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-contain"
                          />
                        )
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={showcaseImageUrl(
                            detailImages[activeImageIdx],
                            SHOWCASE_IMAGE_WIDTHS.hero
                          )}
                          alt={selectedProperty.title}
                          fetchPriority="high"
                          onError={(e) => {
                            // Resize endpoint unavailable → fall back to the original file
                            const original = detailImages[activeImageIdx];
                            if (e.currentTarget.src !== original)
                              e.currentTarget.src = original;
                          }}
                          className="h-full w-full object-contain"
                        />
                      )}

                      {/* Slider Navigation */}
                      {detailMediaCount > 1 && (
                        <>
                          <button
                            onClick={() => {
                              trackerRef.current?.track(
                                'gallery',
                                selectedProperty.id
                              );
                              setActiveImageIdx((prev) =>
                                prev > 0 ? prev - 1 : detailMediaCount - 1
                              );
                            }}
                            className="text-slate-350 absolute top-1/2 left-2 -translate-y-1/2 cursor-pointer rounded-full border border-slate-800/40 bg-slate-950/60 p-1 hover:text-white"
                          >
                            <ChevronLeft className="size-4" />
                          </button>
                          <button
                            onClick={() => {
                              trackerRef.current?.track(
                                'gallery',
                                selectedProperty.id
                              );
                              setActiveImageIdx((prev) =>
                                prev < detailMediaCount - 1 ? prev + 1 : 0
                              );
                            }}
                            className="text-slate-350 absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-full border border-slate-800/40 bg-slate-950/60 p-1 hover:text-white"
                          >
                            <ChevronRight className="size-4" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Thumbnail Row */}
                    {detailMediaCount > 1 && (
                      <div className="border-slate-850 flex h-16 shrink-0 gap-1.5 overflow-x-auto border-t bg-slate-950/80 p-2">
                        {detailImages.map((imgUrl, i) => (
                          <button
                            key={imgUrl}
                            onClick={() => setActiveImageIdx(i)}
                            className={`h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-all ${
                              !isVideoSlide && activeImageIdx === i
                                ? 'border-primary'
                                : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={showcaseImageUrl(
                                imgUrl,
                                SHOWCASE_IMAGE_WIDTHS.thumb
                              )}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                if (e.currentTarget.src !== imgUrl)
                                  e.currentTarget.src = imgUrl;
                              }}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ))}
                        {detailHasVideo && (
                          <button
                            onClick={() =>
                              setActiveImageIdx(detailImages.length)
                            }
                            className={`relative h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-all ${
                              isVideoSlide
                                ? 'border-primary'
                                : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                            title="Listing video"
                          >
                            {detailYouTubeId ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={`https://i.ytimg.com/vi/${detailYouTubeId}/mqdefault.jpg`}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full bg-slate-900" />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
                              <Play className="size-4 fill-white text-white" />
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-650 flex h-full w-full flex-1 flex-col items-center justify-center gap-2 bg-slate-950">
                    <Building className="size-16 opacity-30" />
                    <span className="text-xs font-semibold text-slate-500">
                      No Photos Available
                    </span>
                  </div>
                )}
              </div>

              {/* Right Pane: Details & Form. Mobile: natural height, the
                overlay scrolls the whole card as one flow. Desktop: the
                pane scrolls internally inside the 90dvh card. */}
              <div className="flex w-full flex-col justify-between p-6 lg:max-h-[90dvh] lg:w-[50%] lg:overflow-y-auto">
                {/* Header Info */}
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-primary flex items-center gap-1.5 text-xs font-extrabold tracking-widest uppercase">
                        <Building className="size-3.5" />
                        {selectedProperty.type}
                      </div>
                      {/* lg:mr-8 clears the card's absolute close button,
                        which sat over the tail of the code chip. */}
                      <div className="flex shrink-0 items-center gap-2 lg:mr-8">
                        {/* Buyers only: a co-broker gets the attributed
                          "Get My Share Link" below instead, and an
                          unattributed link beside it would quietly break
                          the chain that block exists to keep. */}
                        {!isAgentMode && (
                          <button
                            type="button"
                            onClick={(e) =>
                              handleShareListing(selectedProperty, e)
                            }
                            title="Share this property"
                            aria-label="Share this property"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
                          >
                            <Share2 className="size-3.5" />
                            Share
                          </button>
                        )}
                        {selectedProperty.property_code && (
                          <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400 select-all">
                            {selectedProperty.property_code}
                          </span>
                        )}
                      </div>
                    </div>
                    <h2 className="text-xl leading-tight font-bold text-white">
                      {selectedProperty.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                      <MapPin className="text-slate-550 size-3.5" />
                      <span>
                        {selectedProperty.sublocality && selectedProperty.city
                          ? `${selectedProperty.sublocality}, ${selectedProperty.city}`
                          : selectedProperty.city ||
                            selectedProperty.sublocality ||
                            'Location shared on inquiry'}
                      </span>
                    </div>
                  </div>

                  {/* Price Box */}
                  <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-900/80 bg-slate-950/65 p-4 backdrop-blur-md md:flex-row md:items-center">
                    <div className="flex flex-col">
                      <span className="text-slate-550 text-[10px] font-bold tracking-wider uppercase">
                        {selectedProperty.listing_type === 'Rent' ||
                        selectedProperty.listing_type === 'Built to Suit'
                          ? 'Rent'
                          : selectedProperty.listing_type === 'JV/JD'
                            ? 'JV / JD'
                            : 'Price'}
                      </span>
                      <span className="text-2xl leading-tight font-black text-white">
                        {selectedProperty.listing_type === 'Rent' ||
                        selectedProperty.listing_type === 'Built to Suit' ? (
                          <span>
                            {formatPrice(selectedProperty.rent_per_month || 0)}
                            /mo
                          </span>
                        ) : selectedProperty.listing_type === 'JV/JD' ? (
                          <span>
                            {selectedProperty.owner_share_percent &&
                            selectedProperty.builder_share_percent
                              ? `${selectedProperty.owner_share_percent}:${selectedProperty.builder_share_percent} share`
                              : 'Enquire'}
                          </span>
                        ) : (
                          formatPrice(selectedProperty.price)
                        )}
                      </span>
                      {(selectedProperty.listing_type === 'Rent' ||
                        selectedProperty.listing_type === 'Built to Suit') &&
                      (selectedProperty.maintenance ||
                        selectedProperty.advance ||
                        selectedProperty.gst) ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
                          {selectedProperty.maintenance &&
                          selectedProperty.maintenance > 0 ? (
                            <span>
                              Maint: {formatPrice(selectedProperty.maintenance)}
                            </span>
                          ) : null}
                          {selectedProperty.advance &&
                          selectedProperty.advance > 0 ? (
                            <span>
                              Deposit: {formatPrice(selectedProperty.advance)}
                            </span>
                          ) : null}
                          {selectedProperty.gst && selectedProperty.gst > 0 ? (
                            <span>
                              GST: {formatPrice(selectedProperty.gst)}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {selectedProperty.listing_type === 'JV/JD' &&
                      (selectedProperty.jv_structure ||
                        selectedProperty.goodwill_amount ||
                        selectedProperty.price > 0) ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
                          {selectedProperty.jv_structure ? (
                            <span>
                              Structure: {selectedProperty.jv_structure}
                            </span>
                          ) : null}
                          {selectedProperty.price > 0 ? (
                            <span>
                              Est. value: {formatPrice(selectedProperty.price)}
                            </span>
                          ) : null}
                          {selectedProperty.goodwill_amount &&
                          selectedProperty.goodwill_amount > 0 ? (
                            <span>
                              Goodwill:{' '}
                              {formatPrice(selectedProperty.goodwill_amount)}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {!isAgentMode &&
                      (displayPhone ||
                        selectedProperty.agent_details?.phone) && (
                        <a
                          href={getWhatsAppLink(selectedProperty)}
                          onClick={() => trackWhatsAppInquiry(selectedProperty)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:bg-green-550 animate-pulse-slow flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-green-600 px-5 py-3 text-xs font-bold text-white shadow-md shadow-green-950/30 transition-all hover:scale-[1.02]"
                        >
                          <MessageCircle className="size-4 fill-white text-green-600" />
                          WhatsApp Inquiry
                        </a>
                      )}
                  </div>

                  {/* Location on Map — agent mode, or a share grant that
                    unmasked this link (?g=) */}
                  {(isAgentMode || selectedProperty.location_revealed) &&
                    selectedProperty.google_map_link && (
                      <div className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/50 p-3.5">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                            <MapPin className="size-4 text-amber-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h5 className="text-[11px] font-extrabold tracking-wider text-amber-500 uppercase">
                              Location on Map
                            </h5>
                            <a
                              href={selectedProperty.google_map_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                trackerRef.current?.track(
                                  'map_click',
                                  selectedProperty.id
                                )
                              }
                              className="mt-1.5 inline-flex items-center gap-1.5 text-xs break-all text-blue-400 underline underline-offset-2 hover:text-blue-300"
                            >
                              <MapPin className="size-3.5 shrink-0" />
                              {selectedProperty.google_map_link.length > 60
                                ? selectedProperty.google_map_link.substring(
                                    0,
                                    60
                                  ) + '...'
                                : selectedProperty.google_map_link}
                            </a>
                          </div>
                        </div>
                        <div className="h-40 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                          <iframe
                            title="Property Location"
                            src={
                              selectedProperty.google_map_link.includes('q=')
                                ? selectedProperty.google_map_link.replace(
                                    /\/+$/,
                                    ''
                                  ) + '&output=embed'
                                : `https://maps.google.com/maps?q=${encodeURIComponent(selectedProperty.sublocality || selectedProperty.location || '')}&output=embed`
                            }
                            width="100%"
                            height="100%"
                            style={{ border: 0 }}
                            allowFullScreen
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                      </div>
                    )}

                  {/* Masked Exact Location Block — shown to buyers, and to
                    co-broker (agent-mode) viewers when the listing's
                    location is guarded. A share grant stands it down:
                    there is nothing left to request. */}
                  {!selectedProperty.location_revealed &&
                    (!isAgentMode || selectedProperty.location_guarded) && (
                      <div className="border-slate-850 group relative space-y-2 overflow-hidden rounded-xl border bg-slate-950/50 p-3.5 backdrop-blur-sm">
                        <div className="from-primary/5 pointer-events-none absolute inset-0 bg-gradient-to-r via-transparent to-transparent" />
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                            <MapPin className="size-4 text-amber-500" />
                          </div>
                          <div>
                            <h5 className="text-[11px] font-extrabold tracking-wider text-amber-500 uppercase">
                              Exact Address Masked
                            </h5>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                              Street address & Google Maps pin link are hidden
                              for privacy.
                              {(selectedProperty.private_images_count ?? 0) >
                                0 && !selectedProperty.private_images_revealed
                                ? ` ${selectedProperty.private_images_count} more photo${(selectedProperty.private_images_count ?? 0) > 1 ? 's' : ''} and the exact location are shared on request.`
                                : ' They are shared directly to your WhatsApp number on request approval.'}
                            </p>
                          </div>
                        </div>
                        <div className="pl-9 font-mono text-[10px] text-slate-400 opacity-25 blur-[2px] filter select-none">
                          Exact coordinates: 12.9348° N, 77.6189° E. Map pin:
                          https://maps.google.com/?q=...
                        </div>
                        <div className="relative pl-9">
                          {locReqSuccess === selectedProperty.id ? (
                            <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                              <CheckCircle className="size-3.5 shrink-0" />
                              Request submitted — you&apos;ll receive the exact
                              location on WhatsApp once approved.
                            </div>
                          ) : locReqOpen ? (
                            <form
                              onSubmit={handleLocReqSubmit}
                              className="space-y-2"
                            >
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  required
                                  value={locReqName}
                                  onChange={(e) =>
                                    setLocReqName(e.target.value)
                                  }
                                  placeholder="Your Name"
                                  className="h-8 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                                />
                                <Input
                                  required
                                  type="tel"
                                  value={locReqPhone}
                                  onChange={(e) =>
                                    setLocReqPhone(e.target.value)
                                  }
                                  placeholder="WhatsApp Number"
                                  className="h-8 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                                />
                              </div>
                              <Button
                                type="submit"
                                disabled={locReqSubmitting}
                                className="bg-primary hover:bg-primary-hover text-primary-foreground flex h-8 w-full items-center justify-center gap-2 text-xs font-bold"
                              >
                                {locReqSubmitting ? (
                                  <div className="border-primary-foreground h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                                ) : (
                                  <Send className="size-3" />
                                )}
                                Request Exact Location
                              </Button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setLocReqName(visitorName);
                                setLocReqPhone(visitorPhone);
                                setLocReqOpen(true);
                              }}
                              className="text-primary hover:text-primary/85 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold"
                            >
                              <MapPin className="size-3.5" />
                              Request Exact Location
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Co-broker re-share link — clean view only. Whoever
                    holds a forwarded link mints their own attributed
                    link here, keeping onward shares visible to the
                    location-consent chain. Needs an attribution to hang
                    the new hop from, so it is hidden on an unattributed
                    visit rather than offering a form the API refuses. */}
                  {isAgentMode && visitorRef && (
                    <div className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/50 p-3.5">
                      <div className="flex items-start gap-2.5">
                        <div className="bg-primary/10 border-primary/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border">
                          <Share2 className="text-primary size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h5 className="text-primary text-[11px] font-extrabold tracking-wider uppercase">
                            Forwarding this property?
                          </h5>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                            Get your own share link. Location requests from
                            people you share it with come to you first — their
                            details stay private to you.
                          </p>
                        </div>
                      </div>
                      <div className="pl-9">
                        {reshareLink ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="flex-1 truncate rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 font-mono text-[11px] text-slate-300">
                                {reshareLink}
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard
                                    .writeText(reshareLink)
                                    .then(() => {
                                      setReshareCopied(true);
                                      setTimeout(
                                        () => setReshareCopied(false),
                                        3000
                                      );
                                    });
                                }}
                                className="bg-primary hover:bg-primary-hover text-primary-foreground h-8 shrink-0 px-3 text-[11px] font-bold"
                              >
                                {reshareCopied ? 'Copied!' : 'Copy'}
                              </Button>
                            </div>
                            <p className="text-[10px] text-slate-500">
                              Also sent to your WhatsApp — forward it from
                              there.
                            </p>
                          </div>
                        ) : reshareOpen ? (
                          <form
                            onSubmit={handleReshareSubmit}
                            className="space-y-2"
                          >
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                required
                                value={reshareName}
                                onChange={(e) => setReshareName(e.target.value)}
                                placeholder="Your Name"
                                className="h-8 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                              />
                              <Input
                                required
                                type="tel"
                                value={resharePhone}
                                onChange={(e) =>
                                  setResharePhone(e.target.value)
                                }
                                placeholder="Your WhatsApp Number"
                                className="h-8 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                              />
                            </div>
                            <Button
                              type="submit"
                              disabled={reshareSubmitting}
                              className="bg-primary hover:bg-primary-hover text-primary-foreground flex h-8 w-full items-center justify-center gap-2 text-xs font-bold"
                            >
                              {reshareSubmitting ? (
                                <div className="border-primary-foreground h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                              ) : (
                                <Share2 className="size-3" />
                              )}
                              Get My Share Link
                            </Button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReshareName(visitorName);
                              setResharePhone(visitorPhone);
                              setReshareOpen(true);
                            }}
                            className="text-primary hover:text-primary/85 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold"
                          >
                            <Share2 className="size-3.5" />
                            Get My Share Link
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Grid Technical Specifications */}
                  {hasSpecs && (
                    <div>
                      <h4 className="mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                        Specifications
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {selectedProperty.project && (
                          <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                            <span className="block text-[9px] font-bold text-slate-500 uppercase">
                              Project Name
                            </span>
                            <span className="font-semibold text-slate-200">
                              {selectedProperty.project}
                            </span>
                          </div>
                        )}

                        {isSelectedPropertyLand
                          ? selectedProperty.land_area && (
                              <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                                <span className="block text-[9px] font-bold text-slate-500 uppercase">
                                  Land Area
                                </span>
                                <span className="font-semibold text-slate-200">
                                  {selectedProperty.land_area.toLocaleString(
                                    'en-IN'
                                  )}{' '}
                                  {selectedProperty.land_area_unit || 'Sq.Ft.'}
                                </span>
                              </div>
                            )
                          : selectedProperty.area_sqft && (
                              <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                                <span className="block text-[9px] font-bold text-slate-500 uppercase">
                                  Total Area
                                </span>
                                <span className="font-semibold text-slate-200">
                                  {selectedProperty.area_sqft.toLocaleString(
                                    'en-IN'
                                  )}{' '}
                                  {selectedProperty.area_unit || 'Sq.Ft.'}
                                </span>
                              </div>
                            )}

                        {selectedProperty.facing_direction && (
                          <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                            <span className="block text-[9px] font-bold text-slate-500 uppercase">
                              Facing Direction
                            </span>
                            <span className="font-semibold text-slate-200">
                              {selectedProperty.facing_direction}
                            </span>
                          </div>
                        )}

                        {selectedProperty.dimensions && (
                          <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                            <span className="block text-[9px] font-bold text-slate-500 uppercase">
                              Dimensions
                            </span>
                            <span className="font-semibold text-slate-200">
                              {selectedProperty.dimensions}
                            </span>
                          </div>
                        )}

                        {selectedProperty.land_zone && (
                          <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                            <span className="block text-[9px] font-bold text-slate-500 uppercase">
                              Land Zone / Zoning
                            </span>
                            <span className="font-semibold text-slate-200">
                              {selectedProperty.land_zone}
                            </span>
                          </div>
                        )}

                        {selectedProperty.road_width && (
                          <div className="border-slate-850/40 rounded border bg-slate-950/20 p-2.5">
                            <span className="block text-[9px] font-bold text-slate-500 uppercase">
                              Road Width
                            </span>
                            <span className="font-semibold text-slate-200">
                              {selectedProperty.road_width}{' '}
                              {selectedProperty.road_width_unit || 'Ft.'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {selectedProperty.description && (
                    <div>
                      <h4 className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                        <FileText className="text-slate-650 size-3.5" />
                        About Property
                      </h4>
                      <p className="text-slate-350 rounded-xl border border-slate-900 bg-slate-950/10 p-3 text-xs leading-relaxed whitespace-pre-line">
                        {selectedProperty.description}
                      </p>
                    </div>
                  )}

                  {/* Nearby Highlights */}
                  {selectedProperty.nearby_highlights &&
                    selectedProperty.nearby_highlights.length > 0 && (
                      <div>
                        <h4 className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                          <Calendar className="text-slate-650 size-3.5" />
                          Landmarks & Highlights
                        </h4>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {selectedProperty.nearby_highlights.map((hl) => (
                            <span
                              key={hl}
                              className="border-slate-850 rounded border bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-300"
                            >
                              📍 {hl}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>

                {/* ─── Documents — a share grant (?g=) delivers the files
                   inline; otherwise buyers ask and the agent approves ─── */}
                {grantedDocuments.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <h4 className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                      <FileText className="text-slate-650 size-3.5" />
                      Property Documents ({grantedDocuments.length})
                    </h4>
                    {grantedDocuments.map((doc, idx) => (
                      <a
                        key={idx}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:bg-slate-850 hover:border-primary/40 group flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className="bg-primary/10 border-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border">
                            <FileText className="text-primary size-4" />
                          </div>
                          <p className="group-hover:text-primary truncate text-xs font-semibold text-white transition-colors">
                            {doc.title?.trim() ||
                              documentDisplayName(doc.url, idx)}
                          </p>
                        </div>
                        <Download className="group-hover:text-primary size-4 shrink-0 text-slate-500 transition-colors" />
                      </a>
                    ))}
                  </div>
                ) : !isAgentMode ? (
                  <div className="mt-4">
                    {docReqSuccess === selectedProperty.id ? (
                      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                        <CheckCircle className="mt-0.5 size-5 shrink-0 text-emerald-400" />
                        <div>
                          <p className="text-sm font-bold text-white">
                            Request Submitted!
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                            The agent will review your request and send the
                            documents to your WhatsApp number once approved.
                          </p>
                        </div>
                      </div>
                    ) : docReqOpen ? (
                      <form
                        onSubmit={handleDocRequestSubmit}
                        className="border-primary/20 space-y-3 rounded-xl border bg-slate-950/60 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="text-primary size-4" />
                            <h4 className="text-xs font-bold tracking-wider text-white uppercase">
                              Request Property Documents
                            </h4>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDocReqOpen(false)}
                            className="cursor-pointer text-slate-500 hover:text-slate-300"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-400">
                          Enter your details below. The agent will review and
                          send documents to your WhatsApp once approved.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            required
                            value={docReqName}
                            onChange={(e) => setDocReqName(e.target.value)}
                            placeholder="Your Name"
                            className="border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                          />
                          <Input
                            required
                            type="tel"
                            value={docReqPhone}
                            onChange={(e) => setDocReqPhone(e.target.value)}
                            placeholder="WhatsApp Number"
                            className="border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                          />
                        </div>
                        <Input
                          type="email"
                          value={docReqEmail}
                          onChange={(e) => setDocReqEmail(e.target.value)}
                          placeholder="Email Address (Optional)"
                          className="w-full border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                        />
                        <Button
                          type="submit"
                          disabled={docReqSubmitting}
                          className="bg-primary hover:bg-primary-hover text-primary-foreground flex w-full items-center justify-center gap-2 text-xs font-bold"
                        >
                          {docReqSubmitting ? (
                            <div className="border-primary-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                          ) : (
                            <Send className="size-3.5" />
                          )}
                          Submit Document Request
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDocReqName(visitorName);
                          setDocReqPhone(visitorPhone);
                          setDocReqEmail(visitorEmail);
                          setDocReqOpen(true);
                        }}
                        className="hover:border-primary/40 group flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 py-3 text-xs font-semibold text-slate-300 transition-all hover:bg-slate-900 hover:text-white"
                      >
                        <FileText className="text-primary size-4 transition-transform group-hover:scale-110" />
                        Request Property Documents
                      </button>
                    )}
                  </div>
                ) : null}

                {/* Inquiry Form Block — hidden in agent mode */}
                {!isAgentMode && (
                  <div className="border-slate-850 mt-6 space-y-4 border-t pt-6">
                    {/* Agent Profile & Direct Message option */}
                    {selectedProperty.agent_details && (
                      <div className="border-slate-850 space-y-3 rounded-xl border bg-slate-950/40 p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                            Managing Agent
                          </h4>
                          <span className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-400 select-all">
                            ID:{' '}
                            {selectedProperty.agent_details.id.substring(0, 8)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {selectedProperty.agent_details.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={storagePublicUrl(
                                  selectedProperty.agent_details.avatar_url
                                )}
                                alt={selectedProperty.agent_details.name}
                                className="size-10 rounded-full border border-slate-800 object-cover"
                              />
                            ) : (
                              <div className="bg-primary/25 border-primary/40 text-primary flex size-10 items-center justify-center rounded-full border text-sm font-black">
                                {selectedProperty.agent_details.name
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white">
                                {selectedProperty.agent_details.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Listing Specialist
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <a
                              href={`tel:${selectedProperty.agent_details.phone.replace(/\D/g, '')}`}
                              onClick={() =>
                                trackPixelEvent('Contact', {
                                  content_name: selectedProperty.title,
                                  content_ids: [
                                    selectedProperty.property_code ||
                                      selectedProperty.id,
                                  ],
                                  contact_method: 'phone',
                                })
                              }
                              className="hover:bg-slate-850 text-slate-250 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 text-[11px] font-semibold hover:text-white"
                            >
                              <Phone className="text-primary size-3" />
                              Call
                            </a>
                            <a
                              href={getWhatsAppLink(selectedProperty)}
                              onClick={() =>
                                trackWhatsAppInquiry(selectedProperty)
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 text-[11px] font-bold text-white shadow-md shadow-green-950/20 hover:bg-green-500"
                            >
                              <MessageCircle className="text-green-650 size-3.5 fill-white" />
                              Chat
                            </a>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ask about this property — AI Q&A funnel */}
                    <AskPropertyChat
                      accountId={accountId}
                      propertyId={selectedProperty.id}
                      propertyTitle={selectedProperty.title}
                      whatsappLink={getWhatsAppLink(selectedProperty)}
                      prefillName={inquiryName}
                      prefillPhone={inquiryPhone}
                      onWhatsAppClick={() =>
                        trackWhatsAppInquiry(selectedProperty)
                      }
                    />

                    {/* Similar properties — browse-more growth loop */}
                    <SimilarProperties
                      accountId={accountId}
                      currentProperty={selectedProperty}
                      onSelect={openPropertyModal}
                    />

                    {/* Interest rating bar inside Modal — hidden in agent mode */}
                    {!isAgentMode && (
                      <PropertyRatingBar
                        value={ratings[selectedProperty.id]?.rating ?? null}
                        missReasons={
                          ratings[selectedProperty.id]?.miss_reasons ?? []
                        }
                        onRate={(rating) =>
                          submitRating(selectedProperty, rating)
                        }
                        onToggleReason={(reason) =>
                          toggleMissReason(selectedProperty, reason)
                        }
                        onHide={() => {
                          hideProperty(selectedProperty);
                          closePropertyModal();
                        }}
                      />
                    )}
                    {submitSuccess ? (
                      <div className="animate-zoom-in space-y-2 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center">
                        <CheckCircle className="mx-auto size-10 text-green-400" />
                        <h4 className="text-sm font-bold text-white">
                          Inquiry Submitted
                        </h4>
                        <p className="text-slate-350 text-xs leading-relaxed">
                          Thank you for your interest! An agent has been
                          assigned to review your inquiry and will reach out to
                          you shortly.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSubmitSuccess(false)}
                          className="mt-2 border-slate-800 text-xs text-slate-200"
                        >
                          Send another message
                        </Button>
                      </div>
                    ) : (
                      <form
                        onSubmit={handleInquirySubmit}
                        className="space-y-3"
                      >
                        <h4 className="text-xs font-bold tracking-wider text-white uppercase">
                          Send Instant Inquiry
                        </h4>

                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            required
                            value={inquiryName}
                            onChange={(e) => setInquiryName(e.target.value)}
                            placeholder="Your Name"
                            className="border-slate-850 focus:border-primary bg-slate-950 text-xs text-white placeholder:text-slate-600"
                          />
                          <Input
                            required
                            type="tel"
                            value={inquiryPhone}
                            onChange={(e) => setInquiryPhone(e.target.value)}
                            placeholder="Mobile Number"
                            className="border-slate-850 focus:border-primary bg-slate-950 text-xs text-white placeholder:text-slate-600"
                          />
                        </div>

                        <Input
                          type="email"
                          value={inquiryEmail}
                          onChange={(e) => setInquiryEmail(e.target.value)}
                          placeholder="Email Address (Optional)"
                          className="border-slate-850 focus:border-primary w-full bg-slate-950 text-xs text-white placeholder:text-slate-600"
                        />

                        <Textarea
                          value={inquiryMessage}
                          onChange={(e) => setInquiryMessage(e.target.value)}
                          placeholder={`I am interested in "${selectedProperty.title}". Please share details.`}
                          rows={2}
                          className="border-slate-850 placeholder:text-slate-650 focus:border-primary min-h-[50px] w-full bg-slate-950 text-xs text-white"
                        />

                        <div className="flex flex-col gap-3 sm:flex-row">
                          {(displayPhone ||
                            selectedProperty.agent_details?.phone) && (
                            <a
                              href={getWhatsAppLink(selectedProperty)}
                              onClick={() =>
                                trackWhatsAppInquiry(selectedProperty)
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-center text-xs font-bold text-white shadow-md shadow-emerald-950/20 transition-all hover:scale-[1.01] hover:bg-emerald-500"
                            >
                              <MessageCircle className="size-4 fill-white text-emerald-600" />
                              WhatsApp Inquiry
                            </a>
                          )}
                          <Button
                            type="submit"
                            disabled={submitting}
                            className="bg-primary hover:bg-primary-hover text-primary-foreground shadow-primary/20 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold shadow-md"
                          >
                            {submitting ? (
                              <div className="border-primary-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                            ) : (
                              <Send className="size-3.5" />
                            )}
                            Submit Lead Form
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Property Requirements Modal */}
      {requirementsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="animate-zoom-in relative my-8 max-h-[90vh] w-full max-w-lg space-y-6 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
            {/* Close Button */}
            <button
              onClick={() => setRequirementsModalOpen(false)}
              className="absolute top-4 right-4 cursor-pointer rounded-full border border-slate-800/80 bg-slate-950/80 p-1.5 text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="space-y-1">
              <h3 className="text-xl font-black tracking-tight text-white">
                Submit Your Requirements
              </h3>
              <p className="text-xs text-slate-400">
                Share what you are looking for, and our engine will notify you
                when matching properties are listed.
              </p>
            </div>

            <form
              onSubmit={handleRequirementsSubmit}
              className="space-y-4 pt-2"
            >
              {/* Basic Details */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Your Name *
                  </label>
                  <Input
                    required
                    value={reqName}
                    onChange={(e) => setReqName(e.target.value)}
                    placeholder="Enter name"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary bg-slate-950 text-xs text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Mobile Number *
                  </label>
                  <Input
                    required
                    type="tel"
                    value={reqPhone}
                    onChange={(e) => setReqPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary bg-slate-950 text-xs text-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Email Address (Optional)
                </label>
                <Input
                  type="email"
                  value={reqEmail}
                  onChange={(e) => setReqEmail(e.target.value)}
                  placeholder="e.g. buyer@example.com"
                  className="border-slate-850 placeholder:text-slate-750 focus:border-primary w-full bg-slate-950 text-xs text-white"
                />
              </div>

              {/* Category Pills Choice */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Property Categories
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Flat/ Apartment',
                    'Villa',
                    'Residential Land/ Plot',
                    'Commercial Building',
                    'Office Space',
                    'Shop/ Showroom',
                    'Warehouse',
                    'Commercial Land',
                  ].map((cat) => {
                    const selected = reqCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`cursor-pointer rounded-full border px-3 py-1.5 text-[10px] font-bold transition-all ${
                          selected
                            ? 'bg-primary border-primary shadow-primary/20 text-white shadow-md'
                            : 'border-slate-850 bg-slate-950 text-slate-400 hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Locations Input & List */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Areas of Interest
                </label>
                <div className="flex gap-2">
                  <Input
                    value={newLocationTag}
                    onChange={(e) => setNewLocationTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLocationTag();
                      }
                    }}
                    placeholder="Type area (e.g. Indiranagar) and press enter or click +"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary flex-1 bg-slate-950 text-xs text-white"
                  />
                  <Button
                    type="button"
                    onClick={addLocationTag}
                    className="border-slate-850 text-slate-350 shrink-0 cursor-pointer border bg-slate-950 px-3 text-xs font-bold hover:bg-slate-900"
                  >
                    +
                  </Button>
                </div>
                {reqLocations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1.5">
                    {reqLocations.map((loc) => (
                      <span
                        key={loc}
                        onClick={() => removeLocationTag(loc)}
                        className="border-slate-850 flex cursor-pointer items-center gap-1 rounded-full border bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-300 transition-all hover:border-red-500/20 hover:text-red-400"
                        title="Click to remove"
                      >
                        📍 {loc}
                        <span className="text-[8px] font-bold text-slate-500">
                          ×
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Budget Range Input */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Min Budget (₹ / Rupees)
                  </label>
                  <Input
                    type="number"
                    value={reqMinBudget}
                    onChange={(e) => setReqMinBudget(e.target.value)}
                    placeholder="e.g. 5000000 (50 Lakhs)"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary bg-slate-950 text-xs text-white"
                  />
                  <PriceHint
                    value={reqMinBudget}
                    compact
                    className="text-[10px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Max Budget (₹ / Rupees)
                  </label>
                  <Input
                    type="number"
                    value={reqMaxBudget}
                    onChange={(e) => setReqMaxBudget(e.target.value)}
                    placeholder="e.g. 20000000 (2 Crores)"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary bg-slate-950 text-xs text-white"
                  />
                  <PriceHint
                    value={reqMaxBudget}
                    compact
                    className="text-[10px]"
                  />
                </div>
              </div>

              {/* Expected ROI Yield - Conditional */}
              {isCommercialSelected && (
                <div className="animate-zoom-in space-y-1.5">
                  <label className="text-[10px] font-bold tracking-wider text-amber-500 uppercase">
                    Expected Min ROI / Yield (% per annum)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={reqMinRoi}
                    onChange={(e) => setReqMinRoi(e.target.value)}
                    placeholder="e.g. 4.5 (for 4.5% rent yield)"
                    className="border-slate-850 placeholder:text-slate-750 focus:border-primary w-full bg-slate-950 text-xs text-white"
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Additional Requirements / Notes
                </label>
                <Textarea
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  placeholder="Tell us about specific needs (e.g. corner plot, road width, hospital proximity, not near Jayanagar, etc.)"
                  rows={3}
                  className="border-slate-850 placeholder:text-slate-650 focus:border-primary min-h-[70px] w-full bg-slate-950 text-xs text-white"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={reqSubmitting}
                  className="bg-primary hover:bg-primary-hover shadow-primary/20 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold text-white shadow-lg"
                >
                  {reqSubmitting ? (
                    <div className="border-primary-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                  ) : (
                    <>
                      <Send className="size-4" />
                      Submit Profile Requirements
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating assistant — buyers qualify themselves and see matches;
          agents and builders branch into the ConvoReal prospect funnel.
          Hidden on clean-view (co-broker) links, like every other form. */}
      {!isAgentMode && (
        <ShowcaseLeadBot
          variant="floating"
          accountId={accountId}
          properties={properties}
          whatsappLink={catalogWhatsAppLink}
          referrerContactId={referrerContactId}
          onSelectProperty={openPropertyModal}
          onWhatsAppClick={() =>
            trackPixelEvent('Contact', { contact_method: 'whatsapp_assistant' })
          }
          onAccountClick={() =>
            trackPixelEvent('CompleteRegistration', {
              content_name: 'Buyer Den account',
            })
          }
        />
      )}
    </div>
  );
}
