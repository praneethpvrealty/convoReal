'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
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
  ThumbsUp,
  ThumbsDown,
  Bell,
  Home,
} from 'lucide-react';
import type { Property, ShowcaseSettings } from '@/types';
import { BRANDING } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AskPropertyChat } from '@/components/showcase/ask-property-chat';
import { SimilarProperties } from '@/components/showcase/similar-properties';

// Dwell-time cap for Pulse view_property events — a tab left open in the
// background must not report hours of "viewing".
const MAX_DWELL_MS = 30 * 60 * 1000;

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
  referrerContactId?: string;
  referrerPhone?: string;
  initialPropertyId?: string;
  initialCategory?: string;
  /** ?mode=view (legacy: agent) resolved on the server so the first paint is already the clean listing view. */
  initialAgentMode?: boolean;
  /** Contact id from per-contact share links (?v=…) — Showcase Pulse
   *  attribution only, never filters the catalog. */
  visitorRef?: string;
}

/** Resolve the share-link target so the detail modal is part of the server render. */
function findInitialProperty(properties: Property[], initialPropertyId?: string): Property | null {
  if (!initialPropertyId) return null;
  return (
    properties.find(
      (p) =>
        p.id === initialPropertyId ||
        (p.property_code && p.property_code.toLowerCase() === initialPropertyId.toLowerCase())
    ) || null
  );
}

export function ShowcaseView({
  properties,
  settings,
  accountId,
  referrerContactId,
  referrerPhone,
  initialPropertyId,
  initialCategory,
  initialAgentMode = false,
  visitorRef
}: ShowcaseViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // ── Showcase Pulse tracking (fire-and-forget beacons) ──────────
  // One tracker per page load; 'open' fires once on mount, property
  // views are tracked with dwell time when the detail modal closes or
  // switches. Failures are swallowed inside the tracker — engagement
  // analytics must never affect the visitor experience.
  const trackerRef = useRef<ReturnType<typeof createShowcaseTracker> | null>(null);
  const viewStartRef = useRef<{ propertyId: string; at: number } | null>(null);
  // Mirror of selectedProperty?.id for the mount-only listeners below.
  const selectedPropertyIdRef = useRef<string | null>(null);
  useEffect(() => {
    trackerRef.current = createShowcaseTracker(accountId, visitorRef);
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
        viewStartRef.current = { propertyId: selectedPropertyIdRef.current, at: Date.now() };
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
    // Mount-only by design: accountId/visitorRef are fixed per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamic Theme Resolver
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const urlTheme = urlParams.get('theme');
    const resolvedTheme = urlTheme || settings?.theme || 'violet';
    
    const validThemes = ['violet', 'emerald', 'cobalt', 'amber', 'rose'];
    if (validThemes.includes(resolvedTheme)) {
      document.documentElement.dataset.theme = resolvedTheme;
    }
  }, [settings?.theme]);

  const [selectedType, setSelectedType] = useState('All');
  const [selectedListingType, setSelectedListingType] = useState<'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit'>('All');
  const [minBeds, setMinBeds] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  // Share links (?property_id=...) render with the detail modal already open —
  // it's part of the server HTML, so the visitor never sees the grid flash
  // before the property appears.
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(() =>
    findInitialProperty(properties, initialPropertyId)
  );
  const [activeImageIdx, setActiveImageIdx] = useState(0);

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
    if (selectedPropertyId && (!prev || prev.propertyId !== selectedPropertyId)) {
      viewStartRef.current = { propertyId: selectedPropertyId, at: Date.now() };
    }
  }, [selectedPropertyId]);

  // ?mode=view (legacy: agent): clean listing detail view (no forms, buttons, or document requests)
  const [isAgentMode, setIsAgentMode] = useState(initialAgentMode);

  // Start fetching the share target's hero image from the document head,
  // before hydration and ahead of the grid's card images.
  const initialHeroUrl = selectedProperty?.images?.[0]
    ? showcaseImageUrl(selectedProperty.images[0], SHOWCASE_IMAGE_WIDTHS.hero)
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
  const [interestStatus, setInterestStatus] = useState<Record<string, 'interested' | 'not_interested'>>({});

  // Trigger modal for interest submission
  const [interestProperty, setInterestProperty] = useState<Property | null>(null);
  const [interestModalOpen, setInterestModalOpen] = useState(false);
  const [interestSubmitting, setInterestSubmitting] = useState(false);

  // Document request states
  const [docReqOpen, setDocReqOpen] = useState(false);
  const [docReqName, setDocReqName] = useState('');
  const [docReqPhone, setDocReqPhone] = useState('');
  const [docReqEmail, setDocReqEmail] = useState('');
  const [docReqSubmitting, setDocReqSubmitting] = useState(false);
  const [docReqSuccess, setDocReqSuccess] = useState<string | null>(null); // property id that was requested

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
    let listingTypeToSet: 'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit' = 'All';
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
    const savedStateStr = localStorage.getItem('showcase_state');
    let savedState: SavedShowcaseState | null = null;
    if (savedStateStr) {
      try {
        const parsed = JSON.parse(savedStateStr) as SavedShowcaseState;
        const age = Date.now() - (parsed.timestamp || 0);
        if (age < 7 * 24 * 60 * 60 * 1000) {
          savedState = parsed;
        } else {
          localStorage.removeItem('showcase_state');
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

    if (urlListingType === 'Sale' || urlListingType === 'Rent' || urlListingType === 'JV/JD' || urlListingType === 'Built to Suit') {
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
        (p) => p.id === propertyIdToSet || (p.property_code && p.property_code.toLowerCase() === propertyIdToSet.toLowerCase())
      );
      if (match) {
        setSelectedProperty(match);
      }
    }

    isStateLoadedRef.current = true;
  }, [initialCategory, initialPropertyId, properties]);

  // 2. Hook to save state to localStorage whenever filters or property details modal changes
  useEffect(() => {
    if (!isStateLoadedRef.current || typeof window === 'undefined') return;

    const stateToSave = {
      timestamp: Date.now(),
      selectedType,
      selectedListingType,
      minBeds,
      sortBy,
      searchQuery,
      selectedPropertyId: selectedProperty?.property_code || selectedProperty?.id || null
    };

    localStorage.setItem('showcase_state', JSON.stringify(stateToSave));
  }, [selectedType, selectedListingType, minBeds, sortBy, searchQuery, selectedProperty]);

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
    if (selectedType === 'All' && selectedListingType === 'All' && minBeds === 'All' && sortBy === 'newest') return;

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
    return reqCategories.some(cat => 
      ['Commercial Building', 'Office Space', 'Shop/ Showroom', 'Warehouse', 'Commercial Land'].includes(cat)
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
    if (newLocationTag.trim() && !reqLocations.includes(newLocationTag.trim())) {
      setReqLocations([...reqLocations, newLocationTag.trim()]);
      setNewLocationTag('');
    }
  };

  const removeLocationTag = (loc: string) => {
    setReqLocations(reqLocations.filter((l) => l !== loc));
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem('visitor_name') || '';
      const storedPhone = localStorage.getItem('visitor_phone') || '';
      const storedEmail = localStorage.getItem('visitor_email') || '';
      const storedInterests = localStorage.getItem('visitor_interests');

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
    localStorage.setItem('visitor_name', name);
    localStorage.setItem('visitor_phone', phone);
    if (email) {
      localStorage.setItem('visitor_email', email);
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

  const updateInterestStatus = (propertyId: string, status: 'interested' | 'not_interested') => {
    const updated = { ...interestStatus, [propertyId]: status };
    setInterestStatus(updated);
    localStorage.setItem('visitor_interests', JSON.stringify(updated));
  };

  const handleInterestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorName.trim() || !visitorPhone.trim() || !interestProperty) return;

    setInterestSubmitting(true);
    try {
      const res = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: visitorName.trim(),
          phone: visitorPhone.trim(),
          email: visitorEmail.trim() || undefined,
          message: `Visitor expressed quick interest in this property listing.`,
          propertyId: interestProperty.id,
          propertyTitle: interestProperty.title,
          propertyCode: interestProperty.property_code,
          accountId,
          referrerContactId: interestProperty.agent_details?.id || referrerContactId,
          sessionKey: getShowcaseSessionKey(),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to register interest');
      }

      saveVisitorInfo(visitorName, visitorPhone, visitorEmail);
      updateInterestStatus(interestProperty.id, 'interested');
      setInterestModalOpen(false);
      setInterestProperty(null);
      toast.success(`Interest recorded for "${interestProperty.title}"!`);

      // Track Meta Pixel Lead event
      trackPixelEvent('Lead', {
        content_name: interestProperty.title,
        content_ids: [interestProperty.property_code || interestProperty.id],
        content_type: 'product',
        value: Number(interestProperty.price) || 0,
        currency: settings?.currency || 'INR',
        inquiry_type: 'quick_interest',
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to register interest. Please try again.');
    } finally {
      setInterestSubmitting(false);
    }
  };

  const handleQuickInterestClick = async (property: Property) => {
    if (!visitorName || !visitorPhone) {
      setInterestProperty(property);
      setInterestModalOpen(true);
      return;
    }

    try {
      updateInterestStatus(property.id, 'interested');
      toast.success(`Interest recorded for "${property.title}"!`);

      // Track Meta Pixel Lead event
      trackPixelEvent('Lead', {
        content_name: property.title,
        content_ids: [property.property_code || property.id],
        content_type: 'product',
        value: Number(property.price) || 0,
        currency: settings?.currency || 'INR',
        inquiry_type: 'quick_interest_prefilled',
      });

      await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: visitorName.trim(),
          phone: visitorPhone.trim(),
          email: visitorEmail.trim() || undefined,
          message: `Visitor expressed quick interest in this property listing.`,
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
      const updated = { ...interestStatus };
      delete updated[property.id];
      setInterestStatus(updated);
      localStorage.setItem('visitor_interests', JSON.stringify(updated));
      toast.error('Failed to register interest. Please try again.');
    }
  };

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
      toast.success('Your requirements have been recorded. Our team will contact you shortly!');
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
  const siteName = settings?.website_name || BRANDING.name;
  const displayPhone = referrerPhone || settings?.contact_phone || '';

  const getWhatsAppLink = (property: Property) => {
    const defaultTemplate = settings?.whatsapp_message_template || 'Hi! I am interested in your property "{title}" in {location}. Please share details.';
    
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
      message = message.replace('({property_code})', '').replace('{property_code}', '');
    }

    const phone = property.agent_details?.phone || displayPhone || '';
    const cleanPhone = phone.replace(/\D/g, '') || '919876543210';
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  // Check if selected property is land/plot type
  const isSelectedPropertyLand = useMemo(() => {
    if (!selectedProperty) return false;
    return [
      'Residential Land/ Plot',
      'Commercial Land',
      'Industrial Land',
      'Agricultural Land'
    ].includes(selectedProperty.type);
  }, [selectedProperty]);

  // Check if selected property has technical specifications to show
  const hasSpecs = useMemo(() => {
    if (!selectedProperty) return false;
    return !!(
      selectedProperty.project ||
      (isSelectedPropertyLand ? selectedProperty.land_area : selectedProperty.area_sqft) ||
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
        if (CATEGORY_SUBTYPES.Residential.includes(p.type)) hasResidential = true;
        if (CATEGORY_SUBTYPES.Commercial.includes(p.type)) hasCommercial = true;
        if (CATEGORY_SUBTYPES.Agricultural.includes(p.type)) hasAgricultural = true;
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
        result = result.filter((p) => CATEGORY_SUBTYPES[selectedType].includes(p.type));
      } else {
        result = result.filter((p) => p.type === selectedType);
      }
    }

    // Filter by listing type
    if (selectedListingType !== 'All') {
      result = result.filter((p) => (p.listing_type || 'Sale') === selectedListingType);
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
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return result;
  }, [properties, selectedType, selectedListingType, minBeds, searchQuery, sortBy]);

  // Document request submission handler
  const handleDocRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docReqName.trim() || !docReqPhone.trim() || !selectedProperty) return;
    setDocReqSubmitting(true);
    try {
      const res = await fetch(`/api/public/properties/${selectedProperty.id}/document-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_name: docReqName.trim(),
          requester_phone: docReqPhone.trim(),
          requester_email: docReqEmail.trim() || undefined,
          account_id: accountId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      // Pre-fill visitor info for future forms
      saveVisitorInfo(docReqName.trim(), docReqPhone.trim(), docReqEmail.trim());
      setDocReqSuccess(selectedProperty.id);
      toast.success('Document request submitted! The agent will review and share documents with you via WhatsApp.');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Failed to submit request';
      toast.error(msg);
    } finally {
      setDocReqSubmitting(false);
    }
  };

  // Form submission handler
  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryName.trim() || !inquiryPhone.trim() || !selectedProperty) return;

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
          referrerContactId: selectedProperty.agent_details?.id || referrerContactId,
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
        (p) => p.id === initialPropertyId || (p.property_code && p.property_code.toLowerCase() === initialPropertyId.toLowerCase())
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
      url.searchParams.set('property_id', property.property_code || property.id);
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
    const refParam = currentUrl.searchParams.get('ref') || currentUrl.searchParams.get('account_id') || currentUrl.searchParams.get('agent_id');
    if (refParam) {
      url.searchParams.set('ref', refParam);
    }
    return url.toString();
  };


  const handleShareListing = async (property: Property, e: React.MouseEvent) => {
    e.stopPropagation();

    trackPixelEvent('ShareProperty', {
      content_name: property.title,
      content_ids: [property.property_code || property.id],
      content_type: 'product',
    });

    const url = getPropertyShareUrl(property);
    if (!url) return;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-primary selection:text-white relative overflow-hidden">
      {/* Decorative Radial Background Lights */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-indigo-500/8 rounded-full blur-[110px] pointer-events-none" />
      
      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-900/60 bg-slate-950/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8.5 w-8.5 rounded-xl bg-gradient-to-br from-primary to-indigo-650 flex items-center justify-center font-black text-white text-base tracking-tighter shadow-md shadow-primary/20">
              {siteName.charAt(0).toUpperCase()}
            </div>
            <span className="text-base font-black tracking-tight bg-gradient-to-r from-white via-slate-150 to-slate-400 bg-clip-text text-transparent">
              {siteName}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {displayPhone && (
              <a
                href={`tel:${displayPhone.replace(/\s+/g, '')}`}
                onClick={() => trackPixelEvent('Contact', { contact_method: 'phone' })}
                className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-all font-semibold"
              >
                <Phone className="size-3.5 text-primary shrink-0" />
                {displayPhone}
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={openRequirementsModal}
              className="border-primary/20 bg-primary/8 hover:bg-primary/15 text-primary hover:text-primary-hover text-xs font-bold px-4 rounded-xl cursor-pointer transition-all"
            >
              Share Requirements
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.href = '/dashboard'}
              className="border-slate-900 bg-slate-900/40 hover:bg-slate-850 text-slate-300 hover:text-white text-xs font-bold px-4 rounded-xl cursor-pointer transition-all"
            >
              Portal Login
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 z-10">
        
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-12 animate-fade-in">
          <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Discover Your Dream{' '}
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-primary/80 bg-clip-text text-transparent">
              Properties & Spaces
            </span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-slate-400 font-medium leading-relaxed">
            Browse through our handpicked collection of premium villa plots, residential land, apartments, and commercial spaces. Managed directly by property owners and agents.
          </p>
        </div>

        {/* Next-step CTAs — get alerted on hot deals, or list your own property */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 animate-fade-in">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="size-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
              <Bell className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-white">Never miss a hot or urgent deal</h3>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Tell us your budget and locality — we&apos;ll message you on WhatsApp the moment a matching or urgently-priced listing goes live.
              </p>
            </div>
            <Button
              onClick={openRequirementsModal}
              className="w-full sm:w-auto shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold px-4 cursor-pointer"
            >
              Get Deal Alerts
            </Button>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="size-11 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
              <Home className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-white">Have a property to sell or rent?</h3>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                List it in minutes — paste the details, add photos, and we&apos;ll verify you on WhatsApp. Or just message us and we&apos;ll walk you through it.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
              <a
                href={`/list?ref=${accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackPixelEvent('Lead', { inquiry_type: 'list_property_click' })}
              >
                <Button className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 cursor-pointer">
                  List My Property
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-slate-900/35 border border-slate-900/60 rounded-3xl p-5 mb-8 backdrop-blur-md shadow-xl flex flex-col gap-4 hover:border-slate-800/80 transition-all duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Search Input */}
            <div className="relative lg:col-span-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search properties — "2 BHK villa" or "price > 50 Cr"'
                className="pl-11 bg-slate-950/60 border-slate-900 text-white placeholder:text-slate-650 focus:border-primary focus:ring-1 focus:ring-primary w-full rounded-xl transition-all"
              />
            </div>

            {/* Listing Type Filter */}
            <div className="relative lg:col-span-2 flex items-center gap-2">
              <Filter className="size-4 text-slate-500 shrink-0" />
              <select
                value={selectedListingType}
                onChange={(e) => setSelectedListingType(e.target.value as 'All' | 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit')}
                className="bg-slate-950/60 border border-slate-900 rounded-xl text-slate-350 text-sm p-2.5 w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all cursor-pointer"
              >
                <option value="All">All Listings</option>
                <option value="Sale">For Sale</option>
                <option value="Rent">For Rent</option>
                <option value="JV/JD">JV / Joint Development</option>
                <option value="Built to Suit">Built to Suit</option>
              </select>
            </div>

            {/* Bedroom Filter */}
            <div className="relative lg:col-span-2 flex items-center gap-2">
              <Filter className="size-4 text-slate-500 shrink-0" />
              <select
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                className="bg-slate-950/60 border border-slate-900 rounded-xl text-slate-350 text-sm p-2.5 w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all cursor-pointer"
              >
                <option value="All">All Bedrooms</option>
                <option value="1">1+ BHK</option>
                <option value="2">2+ BHK</option>
                <option value="3">3+ BHK</option>
                <option value="4">4+ BHK</option>
              </select>
            </div>

            {/* Sort Control */}
            <div className="relative lg:col-span-4 flex items-center gap-2">
              <ArrowUpDown className="size-4 text-slate-500 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-slate-950/60 border border-slate-900 rounded-xl text-slate-350 text-sm p-2.5 w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all cursor-pointer"
              >
                <option value="newest">Newest Listed</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="area-high">Area: Largest First</option>
              </select>
            </div>
          </div>

          {/* Type Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-900/60 overflow-x-auto scrollbar-none">
            <span className="text-xs text-slate-550 font-bold uppercase tracking-wider mr-2">Category:</span>
            {propertyTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`text-xs px-3.5 py-1.5 rounded-full border transition-all cursor-pointer font-bold ${
                  selectedType === type
                    ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Listings Result Grid */}
        {filteredProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 border border-dashed border-slate-900 rounded-3xl bg-slate-900/10">
            <Building className="size-16 text-slate-750 opacity-40 mb-3 animate-pulse" />
            <h3 className="text-lg font-bold text-white mb-1">No matching properties found</h3>
            <p className="text-slate-400 max-w-sm text-sm">
              We couldn&apos;t find any published properties matching your criteria. Try adjusting filters or search phrase.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up">
            {filteredProperties.map((property) => {
              const hasImages = property.images && property.images.length > 0;
              const mainImage = hasImages ? property.images[0] : null;
              const isLand = [
                'Residential Land/ Plot',
                'Commercial Land',
                'Industrial Land',
                'Agricultural Land',
                'Land'
              ].includes(property.type);

              if (interestStatus[property.id] === 'not_interested') {
                return (
                  <div
                    key={property.id}
                    className="flex flex-col justify-center items-center p-6 h-52 rounded-2xl border border-slate-900 border-dashed bg-slate-900/10 text-center space-y-3 transition-all duration-300"
                  >
                    <Building className="size-8 text-slate-700 opacity-40" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-400 line-clamp-1">{property.title}</h4>
                      <p className="text-[11px] text-slate-500">You marked this property as not interested.</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const updated = { ...interestStatus };
                        delete updated[property.id];
                        setInterestStatus(updated);
                        localStorage.setItem('visitor_interests', JSON.stringify(updated));
                      }}
                      className="border-slate-850 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 text-slate-300 text-xs font-semibold px-3 py-1 cursor-pointer"
                    >
                      Show property again
                    </Button>
                  </div>
                );
              }

              return (
                <div
                  key={property.id}
                  className={`flex flex-col rounded-3xl border bg-slate-900/20 overflow-hidden hover:border-slate-805 hover:shadow-2xl hover:shadow-primary/4 transition-all duration-500 group relative ${
                    interestStatus[property.id] === 'interested'
                      ? 'border-emerald-500/35 ring-1 ring-emerald-500/20 shadow-lg shadow-emerald-950/10'
                      : 'border-slate-900/60'
                  }`}
                >
                  {/* Image Container */}
                  <div 
                    onClick={() => openPropertyModal(property)}
                    className="relative h-52 w-full bg-slate-950 overflow-hidden cursor-pointer shrink-0"
                  >
                    {mainImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={showcaseImageUrl(mainImage, SHOWCASE_IMAGE_WIDTHS.card)}
                        alt={property.title}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          // Resize endpoint unavailable → fall back to the original file
                          if (e.currentTarget.src !== mainImage) e.currentTarget.src = mainImage;
                        }}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-2 bg-slate-950">
                        <Building className="size-12 opacity-30" />
                        <span className="text-[11px] font-semibold text-slate-500">No Photos Available</span>
                      </div>
                    )}

                    {/* Subtle gradient overlay at the bottom of the image */}
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/60 to-transparent pointer-events-none" />

                    {/* Overlay Category Tag */}
                    <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-slate-800/80 text-[10px] font-extrabold tracking-wider uppercase text-primary">
                      {property.type}
                    </div>

                    {interestStatus[property.id] === 'interested' && (
                      <div className="absolute top-3 right-3 bg-emerald-500/90 text-white font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-md backdrop-blur-sm">
                        Interested
                      </div>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="flex-1 p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest truncate">
                          {property.project ? `🏢 ${property.project}` : ''}
                        </span>
                        {property.property_code && (
                          <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-950/40 px-1.5 py-0.5 rounded shrink-0 border border-slate-900/30">
                            {property.property_code}
                          </span>
                        )}
                      </div>
                      <h3
                        onClick={() => openPropertyModal(property)}
                        className="text-base font-bold text-white line-clamp-1 group-hover:text-primary transition-colors cursor-pointer"
                        title={property.title}
                      >
                        {property.title}
                      </h3>
                      <div className="flex items-center text-xs text-slate-400 gap-1 mt-1 mb-3">
                        <MapPin className="size-3.5 shrink-0 text-slate-655" />
                        <span className="truncate">
                          {property.sublocality && property.city
                            ? `${property.sublocality}, ${property.city}`
                            : property.city || property.sublocality || "Location shared on inquiry"}
                        </span>
                      </div>

                      {/* Specs Grid */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-900/60 text-xs text-slate-350 mb-4 font-semibold">
                        {['Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Penthouse', 'Studio Apartment', 'Farm House', 'House'].includes(property.type) ? (
                          <>
                            <div className="flex flex-col items-center justify-center bg-slate-955/40 py-2 rounded-xl border border-slate-900/60">
                              <BedDouble className="size-3.5 text-slate-500 mb-0.5" />
                              <span>{property.bedrooms ? `${property.bedrooms} BHK` : '--'}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center bg-slate-955/40 py-2 rounded-xl border border-slate-900/60">
                              <Bath className="size-3.5 text-slate-500 mb-0.5" />
                              <span>{property.bathrooms ? `${property.bathrooms} Bath` : '--'}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-col items-center justify-center bg-slate-955/40 py-2 rounded-xl border border-slate-900/60 col-span-2">
                              <span className="text-[10px] text-slate-500">Zoning</span>
                              <span className="truncate max-w-full text-slate-300">{property.land_zone || 'Residential'}</span>
                            </div>
                          </>
                        )}
                        <div className="flex flex-col items-center justify-center bg-slate-955/40 py-2 rounded-xl border border-slate-900/60">
                          <Maximize2 className="size-3.5 text-slate-500 mb-0.5" />
                          <span className="truncate max-w-full">
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
                      {/* Quick Feedback Bar — hidden in agent mode */}
                      {!isAgentMode && (
                      <div className="flex items-center justify-between border-b border-slate-900/60 pb-3 mb-3 text-xs">
                        <span className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Are you interested?</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickInterestClick(property);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all font-bold text-[10px] cursor-pointer ${
                              interestStatus[property.id] === 'interested'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-950 border border-slate-900 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <ThumbsUp className="size-3" />
                            <span>{interestStatus[property.id] === 'interested' ? 'Interested' : 'Yes'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateInterestStatus(property.id, 'not_interested');
                              toast.info('Property hidden. You can undo this anytime.');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-900 text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-all font-semibold text-[10px] cursor-pointer"
                          >
                            <ThumbsDown className="size-3" />
                            <span>No</span>
                          </button>
                        </div>
                      </div>
                      )}

                      {/* Price & Primary CTA */}
                      <div className="flex items-center justify-between mt-2 pt-2 gap-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-550 uppercase tracking-wider">
                            {property.listing_type === 'Rent' || property.listing_type === 'Built to Suit'
                              ? 'Rent'
                              : property.listing_type === 'JV/JD'
                                ? 'JV / JD'
                                : 'Price'}
                          </span>
                          <span className="text-lg font-black text-white leading-tight">
                            {property.listing_type === 'Rent' || property.listing_type === 'Built to Suit' ? (
                              <span>{formatPrice(property.rent_per_month || 0)}/mo</span>
                            ) : property.listing_type === 'JV/JD' ? (
                              <span>
                                {property.owner_share_percent && property.builder_share_percent
                                  ? `${property.owner_share_percent}:${property.builder_share_percent} share`
                                  : 'Enquire'}
                              </span>
                            ) : (
                              formatPrice(property.price)
                            )}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isAgentMode && (displayPhone || property.agent_details?.phone) && (
                            <a
                              href={getWhatsAppLink(property)}
                              onClick={() => trackWhatsAppInquiry(property)}
                              target="_blank"
                              rel="noreferrer"
                              className="h-9 w-9 rounded-xl bg-green-600 hover:bg-green-550 text-white flex items-center justify-center hover:scale-105 transition-all shadow-md shadow-green-950/40 cursor-pointer"
                              title="Inquire via WhatsApp"
                            >
                              <MessageCircle className="size-4.5 fill-white text-green-650" />
                            </a>
                          )}
                          <Button
                            size="icon"
                            onClick={(e) => handleShareListing(property, e)}
                            className="h-9 w-9 rounded-xl bg-slate-950/60 border border-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white flex items-center justify-center hover:scale-105 transition-all shadow-md cursor-pointer"
                            title="Share Listing"
                          >
                            <Share2 className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => openPropertyModal(property)}
                            className="bg-slate-950/60 border border-slate-900 hover:bg-slate-850 text-white text-xs font-semibold rounded-xl cursor-pointer"
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
        <div className="relative overflow-hidden bg-gradient-to-r from-slate-900/40 via-indigo-950/10 to-slate-900/20 border border-slate-900/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl hover:border-slate-800/80 transition-all duration-500 mt-12">
          {/* Decorative glows */}
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-[70px] pointer-events-none" />
          
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="max-w-2xl text-left">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Can&apos;t find your ideal property?
              </h2>
              <p className="mt-2 text-slate-405 text-sm leading-relaxed font-medium">
                Tell us your specific requirements, and our team will match you with exclusive, off-market listings. Get notified directly on WhatsApp!
              </p>
            </div>
            <Button
              onClick={openRequirementsModal}
              className="bg-primary hover:bg-primary-hover text-white text-xs font-bold px-6 py-5 rounded-xl hover:scale-102 hover:shadow-primary/30 transition-all shadow-lg shadow-primary/25 cursor-pointer shrink-0"
            >
              Submit Requirements
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-900 py-6 mt-16 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            © 2026 {siteName}. Powered by waCRM. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {displayPhone && <span>Inquire: {displayPhone}</span>}
            <span className="text-slate-700">|</span>
            <a href="/login" className="hover:text-primary transition-colors hover:underline">
              Agent Portal
            </a>
          </div>
        </div>
      </footer>
         {/* Property Detail Modal */}
      {selectedProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative max-w-4xl w-full bg-slate-900/85 border border-slate-900/60 rounded-3xl overflow-hidden shadow-2xl flex flex-col lg:flex-row my-8 animate-zoom-in max-h-[90dvh] backdrop-blur-xl">
            
            {/* Close Button */}
            <button
              onClick={closePropertyModal}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800/80 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            {/* Left Pane: Gallery — shrink-0 so the details pane below
                can't squeeze it (or its thumbnail strip) on mobile. */}
            <div className="w-full lg:w-[50%] h-[300px] lg:h-auto bg-slate-950 relative flex flex-col min-h-[300px] shrink-0 lg:shrink">
              {selectedProperty.images && selectedProperty.images.length > 0 ? (
                <>
                  {/* Main Viewer */}
                  <div className="flex-1 w-full h-full relative bg-slate-950 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={showcaseImageUrl(selectedProperty.images[activeImageIdx], SHOWCASE_IMAGE_WIDTHS.hero)}
                      alt={selectedProperty.title}
                      fetchPriority="high"
                      onError={(e) => {
                        // Resize endpoint unavailable → fall back to the original file
                        const original = selectedProperty.images[activeImageIdx];
                        if (e.currentTarget.src !== original) e.currentTarget.src = original;
                      }}
                      className="w-full h-full object-contain"
                    />
                    
                    {/* Slider Navigation */}
                    {selectedProperty.images.length > 1 && (
                      <>
                        <button
                          onClick={() => setActiveImageIdx((prev) => (prev > 0 ? prev - 1 : selectedProperty.images.length - 1))}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-950/60 text-slate-350 hover:text-white border border-slate-800/40 cursor-pointer"
                        >
                          <ChevronLeft className="size-4" />
                        </button>
                        <button
                          onClick={() => setActiveImageIdx((prev) => (prev < selectedProperty.images.length - 1 ? prev + 1 : 0))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-950/60 text-slate-350 hover:text-white border border-slate-800/40 cursor-pointer"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Listing video — rendered above the thumbnails so
                      visitors see moving footage next to the photos. */}
                  {selectedProperty.video_url && selectedProperty.video_status === 'ready' && (
                    <div className="border-t border-slate-850 bg-slate-950/80 p-2">
                      <video
                        src={selectedProperty.video_url}
                        controls
                        playsInline
                        preload="metadata"
                        className="mx-auto max-h-64 rounded-lg border border-slate-800"
                      />
                    </div>
                  )}

                  {/* Thumbnail Row */}
                  {selectedProperty.images.length > 1 && (
                    <div className="h-16 border-t border-slate-850 p-2 flex gap-1.5 bg-slate-950/80 overflow-x-auto">
                      {selectedProperty.images.map((imgUrl, i) => (
                        <button
                          key={imgUrl}
                          onClick={() => setActiveImageIdx(i)}
                          className={`h-12 w-16 rounded overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                            activeImageIdx === i ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={showcaseImageUrl(imgUrl, SHOWCASE_IMAGE_WIDTHS.thumb)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              if (e.currentTarget.src !== imgUrl) e.currentTarget.src = imgUrl;
                            }}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-650 gap-2 bg-slate-950 flex-1">
                  <Building className="size-16 opacity-30" />
                  <span className="text-xs font-semibold text-slate-500">No Photos Available</span>
                </div>
              )}
            </div>

            {/* Right Pane: Details & Form. On mobile this must take the
                REMAINING card height (flex-1 min-h-0) so overflow-y-auto
                actually scrolls — with max-h-none the implicit
                min-height:auto let it grow past the clipped 90vh card,
                making everything below the fold unreachable. */}
            <div className="w-full lg:w-[50%] p-6 flex flex-col justify-between overflow-y-auto flex-1 min-h-0 lg:flex-none lg:max-h-[90dvh]">
              
              {/* Header Info */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 text-xs text-primary font-extrabold uppercase tracking-widest">
                      <Building className="size-3.5" />
                      {selectedProperty.type}
                    </div>
                    {selectedProperty.property_code && (
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded select-all">
                        {selectedProperty.property_code}
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-white leading-tight">
                    {selectedProperty.title}
                  </h2>
                  <div className="flex items-center text-xs text-slate-400 gap-1 mt-1">
                    <MapPin className="size-3.5 text-slate-555" />
                    <span>
                      {selectedProperty.sublocality && selectedProperty.city
                        ? `${selectedProperty.sublocality}, ${selectedProperty.city}`
                        : selectedProperty.city || selectedProperty.sublocality || "Location shared on inquiry"}
                    </span>
                  </div>
                </div>

                {/* Price Box */}
                <div className="bg-slate-950/65 border border-slate-900/80 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 backdrop-blur-md">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">
                      {selectedProperty.listing_type === 'Rent' || selectedProperty.listing_type === 'Built to Suit'
                        ? 'Rent'
                        : selectedProperty.listing_type === 'JV/JD'
                          ? 'JV / JD'
                          : 'Price'}
                    </span>
                    <span className="text-2xl font-black text-white leading-tight">
                      {selectedProperty.listing_type === 'Rent' || selectedProperty.listing_type === 'Built to Suit' ? (
                        <span>{formatPrice(selectedProperty.rent_per_month || 0)}/mo</span>
                      ) : selectedProperty.listing_type === 'JV/JD' ? (
                        <span>
                          {selectedProperty.owner_share_percent && selectedProperty.builder_share_percent
                            ? `${selectedProperty.owner_share_percent}:${selectedProperty.builder_share_percent} share`
                            : 'Enquire'}
                        </span>
                      ) : (
                        formatPrice(selectedProperty.price)
                      )}
                    </span>
                    {(selectedProperty.listing_type === 'Rent' || selectedProperty.listing_type === 'Built to Suit') && (selectedProperty.maintenance || selectedProperty.advance || selectedProperty.gst) ? (
                      <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1 font-medium">
                        {selectedProperty.maintenance && selectedProperty.maintenance > 0 ? (
                          <span>Maint: {formatPrice(selectedProperty.maintenance)}</span>
                        ) : null}
                        {selectedProperty.advance && selectedProperty.advance > 0 ? (
                          <span>Deposit: {formatPrice(selectedProperty.advance)}</span>
                        ) : null}
                        {selectedProperty.gst && selectedProperty.gst > 0 ? (
                          <span>GST: {formatPrice(selectedProperty.gst)}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedProperty.listing_type === 'JV/JD' && (selectedProperty.jv_structure || selectedProperty.goodwill_amount || selectedProperty.price > 0) ? (
                      <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1 font-medium">
                        {selectedProperty.jv_structure ? <span>Structure: {selectedProperty.jv_structure}</span> : null}
                        {selectedProperty.price > 0 ? <span>Est. value: {formatPrice(selectedProperty.price)}</span> : null}
                        {selectedProperty.goodwill_amount && selectedProperty.goodwill_amount > 0 ? (
                          <span>Goodwill: {formatPrice(selectedProperty.goodwill_amount)}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {!isAgentMode && (displayPhone || selectedProperty.agent_details?.phone) && (
                    <a
                      href={getWhatsAppLink(selectedProperty)}
                      onClick={() => trackWhatsAppInquiry(selectedProperty)}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-green-600 hover:bg-green-550 text-white text-xs font-bold px-5 py-3 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-green-950/30 hover:scale-[1.02] transition-all shrink-0 animate-pulse-slow"
                    >
                      <MessageCircle className="size-4 fill-white text-green-600" />
                      WhatsApp Inquiry
                    </a>
                  )}
                </div>

                {/* Location on Map — shown in agent mode with google_map_link */}
                {isAgentMode && selectedProperty.google_map_link && (
                  <div className="bg-slate-950/50 border border-slate-850 p-3.5 rounded-xl space-y-2">
                    <div className="flex items-start gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <MapPin className="size-4 text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="text-[11px] font-extrabold text-amber-500 uppercase tracking-wider">Location on Map</h5>
                        <a
                          href={selectedProperty.google_map_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
                        >
                          <MapPin className="size-3.5 shrink-0" />
                          {selectedProperty.google_map_link.length > 60
                            ? selectedProperty.google_map_link.substring(0, 60) + '...'
                            : selectedProperty.google_map_link}
                        </a>
                      </div>
                    </div>
                    <div className="rounded-lg overflow-hidden border border-slate-800 h-40 bg-slate-900">
                      <iframe
                        title="Property Location"
                        src={selectedProperty.google_map_link.includes('q=')
                          ? selectedProperty.google_map_link.replace(/\/+$/, '') + '&output=embed'
                          : `https://maps.google.com/maps?q=${encodeURIComponent(selectedProperty.sublocality || selectedProperty.location || '')}&output=embed`}
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

                {/* Masked Exact Location Block — shown to buyers */}
                {!isAgentMode && (
                <div className="bg-slate-950/50 border border-slate-850 p-3.5 rounded-xl space-y-1.5 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
                  <div className="flex items-start gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <MapPin className="size-4 text-amber-500" />
                    </div>
                    <div>
                      <h5 className="text-[11px] font-extrabold text-amber-500 uppercase tracking-wider">Exact Address Masked</h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                        Street address & Google Maps pin link are hidden for privacy. They will be sent directly to your WhatsApp number upon inquiry approval.
                      </p>
                    </div>
                  </div>
                  <div className="filter blur-[2px] opacity-25 select-none text-[10px] pl-9 text-slate-400 font-mono">
                    Exact coordinates: 12.9348° N, 77.6189° E. Map pin: https://maps.google.com/?q=...
                  </div>
                </div>
                )}

                {/* Grid Technical Specifications */}
                {hasSpecs && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Specifications</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {selectedProperty.project && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Project Name</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.project}</span>
                        </div>
                      )}

                      {isSelectedPropertyLand ? (
                        selectedProperty.land_area && (
                          <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                            <span className="text-slate-500 block text-[9px] uppercase font-bold">Land Area</span>
                            <span className="text-slate-200 font-semibold">
                              {selectedProperty.land_area.toLocaleString('en-IN')} {selectedProperty.land_area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        )
                      ) : (
                        selectedProperty.area_sqft && (
                          <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                            <span className="text-slate-500 block text-[9px] uppercase font-bold">Total Area</span>
                            <span className="text-slate-200 font-semibold">
                              {selectedProperty.area_sqft.toLocaleString('en-IN')} {selectedProperty.area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        )
                      )}

                      {selectedProperty.facing_direction && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Facing Direction</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.facing_direction}</span>
                        </div>
                      )}

                      {selectedProperty.dimensions && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Dimensions</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.dimensions}</span>
                        </div>
                      )}

                      {selectedProperty.land_zone && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Land Zone / Zoning</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.land_zone}</span>
                        </div>
                      )}

                      {selectedProperty.road_width && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Road Width</span>
                          <span className="text-slate-200 font-semibold">
                            {selectedProperty.road_width} {selectedProperty.road_width_unit || 'Ft.'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedProperty.description && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                      <FileText className="size-3.5 text-slate-650" />
                      About Property
                    </h4>
                    <p className="text-slate-350 text-xs leading-relaxed whitespace-pre-line bg-slate-950/10 p-3 border border-slate-900 rounded-xl">
                      {selectedProperty.description}
                    </p>
                  </div>
                )}

                {/* Nearby Highlights */}
                {selectedProperty.nearby_highlights && selectedProperty.nearby_highlights.length > 0 && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Calendar className="size-3.5 text-slate-650" />
                      Landmarks & Highlights
                    </h4>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {selectedProperty.nearby_highlights.map((hl) => (
                        <span
                          key={hl}
                          className="bg-slate-900 border border-slate-850 text-slate-300 text-[10px] font-semibold px-2 py-0.5 rounded"
                        >
                          📍 {hl}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ─── Request Documents Block — hidden in agent mode ─── */}
              {!isAgentMode && (
              <div className="mt-4">
                {docReqSuccess === selectedProperty.id ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 flex items-start gap-3">
                    <CheckCircle className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-white">Request Submitted!</p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        The agent will review your request and send the documents to your WhatsApp number once approved.
                      </p>
                    </div>
                  </div>
                ) : docReqOpen ? (
                  <form
                    onSubmit={handleDocRequestSubmit}
                    className="bg-slate-950/60 border border-primary/20 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-primary" />
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Request Property Documents</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDocReqOpen(false)}
                        className="text-slate-500 hover:text-slate-300 cursor-pointer"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Enter your details below. The agent will review and send documents to your WhatsApp once approved.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        required
                        value={docReqName}
                        onChange={(e) => setDocReqName(e.target.value)}
                        placeholder="Your Name"
                        className="bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 text-xs"
                      />
                      <Input
                        required
                        type="tel"
                        value={docReqPhone}
                        onChange={(e) => setDocReqPhone(e.target.value)}
                        placeholder="WhatsApp Number"
                        className="bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 text-xs"
                      />
                    </div>
                    <Input
                      type="email"
                      value={docReqEmail}
                      onChange={(e) => setDocReqEmail(e.target.value)}
                      placeholder="Email Address (Optional)"
                      className="bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 text-xs w-full"
                    />
                    <Button
                      type="submit"
                      disabled={docReqSubmitting}
                      className="w-full bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold flex items-center justify-center gap-2"
                    >
                      {docReqSubmitting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
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
                    className="w-full flex items-center justify-center gap-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-900 hover:border-primary/40 text-slate-300 hover:text-white text-xs font-semibold py-3 rounded-xl transition-all cursor-pointer group"
                  >
                    <FileText className="size-4 text-primary group-hover:scale-110 transition-transform" />
                    Request Property Documents
                  </button>
                )}
              </div>
              )}

              {/* Inquiry Form Block — hidden in agent mode */}
              {!isAgentMode && (
              <div className="mt-6 pt-6 border-t border-slate-850 space-y-4">
                {/* Agent Profile & Direct Message option */}
                {selectedProperty.agent_details && (
                  <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Managing Agent</h4>
                      <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded select-all">
                        ID: {selectedProperty.agent_details.id.substring(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {selectedProperty.agent_details.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedProperty.agent_details.avatar_url}
                            alt={selectedProperty.agent_details.name}
                            className="size-10 rounded-full border border-slate-800 object-cover"
                          />
                        ) : (
                          <div className="size-10 rounded-full bg-primary/25 border border-primary/40 flex items-center justify-center font-black text-primary text-sm">
                            {selectedProperty.agent_details.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white">{selectedProperty.agent_details.name}</span>
                          <span className="text-[10px] text-slate-400">Listing Specialist</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${selectedProperty.agent_details.phone.replace(/\D/g, '')}`}
                          onClick={() => trackPixelEvent('Contact', {
                            content_name: selectedProperty.title,
                            content_ids: [selectedProperty.property_code || selectedProperty.id],
                            contact_method: 'phone',
                          })}
                          className="h-8 px-3 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-850 text-slate-250 hover:text-white flex items-center justify-center gap-1.5 text-[11px] font-semibold cursor-pointer"
                        >
                          <Phone className="size-3 text-primary" />
                          Call
                        </a>
                        <a
                          href={getWhatsAppLink(selectedProperty)}
                          onClick={() => trackWhatsAppInquiry(selectedProperty)}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 px-3 rounded-lg bg-green-600 hover:bg-green-500 text-white flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer shadow-md shadow-green-950/20"
                        >
                          <MessageCircle className="size-3.5 fill-white text-green-650" />
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
                  onWhatsAppClick={() => trackWhatsAppInquiry(selectedProperty)}
                />

                {/* Similar properties — browse-more growth loop */}
                <SimilarProperties
                  accountId={accountId}
                  currentProperty={selectedProperty}
                  onSelect={openPropertyModal}
                />

                {/* Quick Feedback Bar inside Modal — hidden in agent mode */}
                {!isAgentMode && (
                <div className="bg-slate-950/30 border border-slate-850 p-4 rounded-xl flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <h5 className="text-[11px] font-bold text-slate-350 uppercase tracking-wider">Are you interested?</h5>
                    <p className="text-[10px] text-slate-500">Expressing interest creates a priority follow-up.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        handleQuickInterestClick(selectedProperty);
                      }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all text-xs font-bold cursor-pointer ${
                        interestStatus[selectedProperty.id] === 'interested'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ThumbsUp className="size-3.5" />
                      <span>{interestStatus[selectedProperty.id] === 'interested' ? 'Interested' : 'Yes'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateInterestStatus(selectedProperty.id, 'not_interested');
                        toast.info('Property marked as not interested.');
                        closePropertyModal();
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-550/20 transition-all text-xs font-semibold cursor-pointer"
                    >
                      <ThumbsDown className="size-3.5" />
                      <span>No</span>
                    </button>
                  </div>
                </div>
                )}
                {submitSuccess ? (
                  <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-xl text-center space-y-2 animate-zoom-in">
                    <CheckCircle className="size-10 text-green-400 mx-auto" />
                    <h4 className="text-sm font-bold text-white">Inquiry Submitted</h4>
                    <p className="text-xs text-slate-350 leading-relaxed">
                      Thank you for your interest! An agent has been assigned to review your inquiry and will reach out to you shortly.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubmitSuccess(false)}
                      className="border-slate-800 text-xs mt-2 text-slate-200"
                    >
                      Send another message
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="space-y-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      Send Instant Inquiry
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        required
                        value={inquiryName}
                        onChange={(e) => setInquiryName(e.target.value)}
                        placeholder="Your Name"
                        className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
                      />
                      <Input
                        required
                        type="tel"
                        value={inquiryPhone}
                        onChange={(e) => setInquiryPhone(e.target.value)}
                        placeholder="Mobile Number"
                        className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
                      />
                    </div>

                    <Input
                      type="email"
                      value={inquiryEmail}
                      onChange={(e) => setInquiryEmail(e.target.value)}
                      placeholder="Email Address (Optional)"
                      className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs w-full"
                    />

                    <Textarea
                      value={inquiryMessage}
                      onChange={(e) => setInquiryMessage(e.target.value)}
                      placeholder={`I am interested in "${selectedProperty.title}". Please share details.`}
                      rows={2}
                      className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-650 focus:border-primary text-xs w-full min-h-[50px]"
                    />

                    <div className="flex flex-col sm:flex-row gap-3">
                      {(displayPhone || selectedProperty.agent_details?.phone) && (
                        <a
                          href={getWhatsAppLink(selectedProperty)}
                          onClick={() => trackWhatsAppInquiry(selectedProperty)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/20 hover:scale-[1.01] transition-all text-center"
                        >
                          <MessageCircle className="size-4 fill-white text-emerald-600" />
                          WhatsApp Inquiry
                        </a>
                      )}
                      <Button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-primary/20"
                      >
                        {submitting ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
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
      )}

      {/* Quick Interest Modal */}
      {interestModalOpen && interestProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="relative max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 animate-zoom-in">
            {/* Close Button */}
            <button
              onClick={() => {
                setInterestModalOpen(false);
                setInterestProperty(null);
              }}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800/80 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-white">Express Interest</h3>
              <p className="text-xs text-slate-400">
                Share your details for &quot;{interestProperty.title}&quot; to receive priority updates.
              </p>
            </div>

            <form onSubmit={handleInterestSubmit} className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Your Name</label>
                <Input
                  required
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="John Doe"
                  className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-700 focus:border-primary text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Mobile Number</label>
                <Input
                  required
                  type="tel"
                  value={visitorPhone}
                  onChange={(e) => setVisitorPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-700 focus:border-primary text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Email (Optional)</label>
                <Input
                  type="email"
                  value={visitorEmail}
                  onChange={(e) => setVisitorEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-700 focus:border-primary text-xs w-full"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={interestSubmitting}
                  className="w-full bg-primary hover:bg-primary-hover text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20 cursor-pointer"
                >
                  {interestSubmitting ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <>
                      <Send className="size-3.5" />
                      Submit Interest
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Property Requirements Modal */}
      {requirementsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 animate-zoom-in my-8 max-h-[90vh] overflow-y-auto">
            {/* Close Button */}
            <button
              onClick={() => setRequirementsModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800/80 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-white tracking-tight">Submit Your Requirements</h3>
              <p className="text-xs text-slate-400">
                Share what you are looking for, and our engine will notify you when matching properties are listed.
              </p>
            </div>

            <form onSubmit={handleRequirementsSubmit} className="space-y-4 pt-2">
              
              {/* Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Your Name *</label>
                  <Input
                    required
                    value={reqName}
                    onChange={(e) => setReqName(e.target.value)}
                    placeholder="Enter name"
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Mobile Number *</label>
                  <Input
                    required
                    type="tel"
                    value={reqPhone}
                    onChange={(e) => setReqPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Email Address (Optional)</label>
                <Input
                  type="email"
                  value={reqEmail}
                  onChange={(e) => setReqEmail(e.target.value)}
                  placeholder="e.g. buyer@example.com"
                  className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs w-full"
                />
              </div>

              {/* Category Pills Choice */}
              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Property Categories</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Flat/ Apartment',
                    'Villa',
                    'Residential Land/ Plot',
                    'Commercial Building',
                    'Office Space',
                    'Shop/ Showroom',
                    'Warehouse',
                    'Commercial Land'
                  ].map((cat) => {
                    const selected = reqCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                          selected
                            ? 'bg-primary border-primary text-white shadow-md shadow-primary/20'
                            : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
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
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Areas of Interest</label>
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
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs flex-1"
                  />
                  <Button
                    type="button"
                    onClick={addLocationTag}
                    className="bg-slate-950 border border-slate-850 hover:bg-slate-900 text-slate-350 text-xs font-bold px-3 cursor-pointer shrink-0"
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
                        className="bg-slate-950 border border-slate-850 hover:border-red-500/20 text-slate-300 hover:text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full cursor-pointer transition-all flex items-center gap-1"
                        title="Click to remove"
                      >
                        📍 {loc}
                        <span className="text-[8px] text-slate-500 font-bold">×</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Budget Range Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Min Budget (₹ / Rupees)</label>
                  <Input
                    type="number"
                    value={reqMinBudget}
                    onChange={(e) => setReqMinBudget(e.target.value)}
                    placeholder="e.g. 5000000 (50 Lakhs)"
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Max Budget (₹ / Rupees)</label>
                  <Input
                    type="number"
                    value={reqMaxBudget}
                    onChange={(e) => setReqMaxBudget(e.target.value)}
                    placeholder="e.g. 20000000 (2 Crores)"
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs"
                  />
                </div>
              </div>

              {/* Expected ROI Yield - Conditional */}
              {isCommercialSelected && (
                <div className="space-y-1.5 animate-zoom-in">
                  <label className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">
                    Expected Min ROI / Yield (% per annum)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={reqMinRoi}
                    onChange={(e) => setReqMinRoi(e.target.value)}
                    placeholder="e.g. 4.5 (for 4.5% rent yield)"
                    className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-755 focus:border-primary text-xs w-full"
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Additional Requirements / Notes</label>
                <Textarea
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  placeholder="Tell us about specific needs (e.g. corner plot, road width, hospital proximity, not near Jayanagar, etc.)"
                  rows={3}
                  className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-650 focus:border-primary text-xs w-full min-h-[70px]"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={reqSubmitting}
                  className="w-full bg-primary hover:bg-primary-hover text-white text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-primary/20 cursor-pointer"
                >
                  {reqSubmitting ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
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
    </div>
  );
}
