'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Property } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  Users,
  Send,
  Check,
  CheckSquare,
  Square,
  ArrowLeft,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { getMatchingContacts } from '@/lib/matching';
import type { Contact, MessageTemplate } from '@/types';
import {
  POPULAR_PROJECTS,
  POPULAR_SUBLOCALITIES,
} from '@/lib/data/real-estate-data';

// Exhaustive amenities list for checkbox selection
export const AMENITIES_BY_CATEGORY = {
  "Security & Utilities": [
    "24/7 Security",
    "CCTV Surveillance",
    "Power Backup",
    "Intercom",
    "Fire Fighting System",
    "Water Supply (Corporation)",
    "Water Supply (Borewell)",
    "Rain Water Harvesting",
    "Waste Disposal",
  ],
  "Leisure & Community": [
    "Lift/Elevator",
    "Swimming Pool",
    "Gymnasium",
    "Club House",
    "Children's Play Area",
    "Reserved Parking",
    "Visitor Parking",
    "Gated Community",
  ],
  "Commercial & Agricultural Specs": [
    "Centrally Air Conditioned",
    "Service/Goods Lift",
    "Conference Room",
    "Cafeteria/Food Court",
    "Wi-Fi Connectivity",
    "ATM",
    "Fenced Boundary",
    "Electricity Connection",
    "Access Road",
  ]
};

// Exhaustive list of nearby landmarks
export const NEARBY_HIGHLIGHTS_OPTIONS = [
  "Metro Station",
  "School",
  "Hospital",
  "Mall",
  "Supermarket",
  "Park",
  "Highway",
  "Airport",
  "Railway Station",
  "Bus Stop",
  "Bank / ATM"
];

export const FACING_DIRECTIONS = [
  "East",
  "North",
  "South",
  "West",
  "North-East",
  "North-West",
  "South-East",
  "South-West"
];

export const AREA_UNITS = [
  "Sq.Ft.",
  "Sq.Mtr.",
  "Acre",
  "Gunta",
  "Cent",
  "Ground"
];

interface PropertyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
  onSaved: () => void;
}

export function PropertyForm({
  open,
  onOpenChange,
  property,
  onSaved,
}: PropertyFormProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const isEdit = !!property;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(''); // Whole rupee amount (INR)
  const [type, setType] = useState('Flat/ Apartment');
  const [status, setStatus] = useState('Available');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [areaSqft, setAreaSqft] = useState('');
  const [areaUnit, setAreaUnit] = useState('Sq.Ft.');
  const [landArea, setLandArea] = useState('');
  const [landAreaUnit, setLandAreaUnit] = useState('Sq.Ft.');
  const [superBuiltArea, setSuperBuiltArea] = useState('');
  const [frontage, setFrontage] = useState('');
  const [depth, setDepth] = useState('');
  const [sublocality, setSublocality] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [address, setAddress] = useState('');
  const [project, setProject] = useState('');
  const [landZone, setLandZone] = useState('');
  const [idealFor, setIdealFor] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [roadWidth, setRoadWidth] = useState('');
  const [roadWidthUnit, setRoadWidthUnit] = useState('Feet');
  const [facingDirection, setFacingDirection] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [nearbyHighlights, setNearbyHighlights] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>(['']);
  const [localitiesDb, setLocalitiesDb] = useState<{ detailed: string[] } | null>(null);
  
  const [saving, setSaving] = useState(false);

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
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  
  // Broadcast steps: 'matches' | 'configure' | 'sending' | 'results'
  const [broadcastStep, setBroadcastStep] = useState<'matches' | 'configure' | 'sending' | 'results'>('matches');
  const [variableMappings, setVariableMappings] = useState<Record<string, { type: 'field' | 'static'; value: string }>>({});
  const [customVariableValues, setCustomVariableValues] = useState<Record<string, string>>({});
  const [broadcastResults, setBroadcastResults] = useState<Array<{ name: string; phone: string; status: 'sent' | 'failed'; error?: string }>>([]);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // Fetch contacts and templates
  useEffect(() => {
    if (open) {
      fetchContacts();
      fetchTemplates();
      // Reset broadcast wizard
      setBroadcastStep('matches');
      setSelectedContactIds([]);
      setSelectedTemplate(null);
      setVariableMappings({});
      setCustomVariableValues({});
      setBroadcastResults([]);
      setActiveTab('details');
    }
  }, [open]);

  async function fetchContacts() {
    setLoadingContacts(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch (err) {
      console.error('Failed to load contacts for matching:', err);
    } finally {
      setLoadingContacts(false);
    }
  }

  async function fetchTemplates() {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to load templates for broadcast:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }

  const formattedPrice = useMemo(() => {
    const amount = Number(price);
    if (isNaN(amount) || amount <= 0) return '';
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
  }, [price]);

  const matchedContacts = useMemo(() => {
    const fullLocation = [address.trim(), sublocality.trim(), city.trim(), stateVal.trim()]
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
      features,
      nearby_highlights: nearbyHighlights,
    };
    return getMatchingContacts(currentProp, contacts);
  }, [contacts, title, description, price, address, type, sublocality, city, stateVal, project, features, nearbyHighlights]);

  const placeholders = useMemo(() => {
    if (!selectedTemplate) return [];
    const matches = selectedTemplate.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [selectedTemplate]);

  useEffect(() => {
    if (selectedTemplate && placeholders.length > 0) {
      const mappings: Record<string, { type: 'field' | 'static'; value: string }> = {};
      const customVals: Record<string, string> = {};

      placeholders.forEach((placeholder, idx) => {
        const key = placeholder.replace(/^\{\{|\}\}$/g, '');
        // Default mapping: idx 0 -> Name, idx 1 -> Title, idx 2 -> Price, idx 3 -> Location
        if (idx === 0) {
          mappings[key] = { type: 'field', value: 'name' };
        } else if (idx === 1) {
          mappings[key] = { type: 'static', value: 'title' };
        } else if (idx === 2) {
          mappings[key] = { type: 'static', value: 'price' };
        } else if (idx === 3) {
          mappings[key] = { type: 'static', value: 'location' };
        } else {
          mappings[key] = { type: 'static', value: 'custom' };
          customVals[key] = '';
        }
      });
      setVariableMappings(mappings);
      setCustomVariableValues(customVals);
    }
  }, [selectedTemplate, placeholders]);

  async function handleSendBroadcast() {
    if (!selectedTemplate || selectedContactIds.length === 0) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) => selectedContactIds.includes(c.id));
      const fullLoc = [address.trim(), sublocality.trim(), city.trim(), stateVal.trim()]
        .filter(Boolean)
        .join(', ');

      const recipientsPayload = selectedContacts.map((contact) => {
        const params: string[] = [];
        placeholders.forEach((placeholder) => {
          const key = placeholder.replace(/^\{\{|\}\}$/g, '');
          const mapping = variableMappings[key];

          let val = '';
          if (mapping) {
            if (mapping.type === 'field') {
              if (mapping.value === 'name') val = contact.name || 'Customer';
              else if (mapping.value === 'phone') val = contact.phone;
              else if (mapping.value === 'email') val = contact.email || '';
              else if (mapping.value === 'company') val = contact.company || '';
            } else {
              if (mapping.value === 'title') val = title || '';
              else if (mapping.value === 'price') val = formattedPrice || '';
              else if (mapping.value === 'location') val = sublocality || fullLoc || '';
              else if (mapping.value === 'custom') val = customVariableValues[key] || '';
            }
          }
          params.push(val);
        });

        return {
          phone: contact.phone,
          params,
        };
      });

      const response = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: recipientsPayload,
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language || 'en_US',
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Broadcast request failed');
      }

      const resData = await response.json();
      
      const resultsMap = selectedContacts.map((c) => {
        const matchResult = resData.results?.find(
          (r: any) =>
            r.phone === c.phone ||
            r.phone.includes(c.phone) ||
            c.phone.includes(r.phone)
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone,
          status: matchResult?.status || 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      setBroadcastResults(resultsMap);
      setBroadcastStep('results');
      toast.success(`Broadcast finished: ${resData.sent} sent, ${resData.failed} failed.`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send broadcast');
      setBroadcastStep('configure');
    } finally {
      setSendingBroadcast(false);
    }
  }

  function toggleContactSelection(id: string) {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]
    );
  }

  function toggleSelectAllContacts() {
    if (selectedContactIds.length === matchedContacts.length) {
      setSelectedContactIds([]);
    } else {
      setSelectedContactIds(matchedContacts.map((m) => m.contact.id));
    }
  }

  function handleToggleFeature(feature: string) {
    setFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  }

  function handleToggleHighlight(highlight: string) {
    setNearbyHighlights((prev) =>
      prev.includes(highlight) ? prev.filter((h) => h !== highlight) : [...prev, highlight]
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
          location: [address.trim(), sublocality.trim(), city.trim(), stateVal.trim()].filter(Boolean).join(', ') || null,
          bedrooms: bedrooms.trim() ? Number(bedrooms) : null,
          bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
          area: isLand ? (landArea.trim() ? Number(landArea) : null) : (areaSqft.trim() ? Number(areaSqft) : null),
          areaUnit: isLand ? landAreaUnit : areaUnit,
          frontage: frontage.trim() || null,
          depth: depth.trim() || null,
          features,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate description');
      }

      const data = await response.json();
      setDescription(data.description || '');
      toast.success('Description generated successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate description');
    } finally {
      setGeneratingDescription(false);
    }
  }

  // Autocomplete states
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Close autocomplete on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      if (property) {
        setTitle(property.title);
        setDescription(property.description ?? '');
        setPrice(property.price !== null && property.price !== undefined ? String(property.price) : '');
        setType(property.type);
        setStatus(property.status);
        setBedrooms(property.bedrooms !== null && property.bedrooms !== undefined ? String(property.bedrooms) : '');
        setBathrooms(property.bathrooms !== null && property.bathrooms !== undefined ? String(property.bathrooms) : '');
        setAreaSqft(property.area_sqft !== null && property.area_sqft !== undefined ? String(property.area_sqft) : '');
        setAreaUnit(property.area_unit ?? 'Sq.Ft.');
        setLandArea(property.land_area !== null && property.land_area !== undefined ? String(property.land_area) : '');
        setLandAreaUnit(property.land_area_unit ?? 'Sq.Ft.');
        setSuperBuiltArea(property.super_built_area !== null && property.super_built_area !== undefined ? String(property.super_built_area) : '');
        setSublocality(property.sublocality ?? '');
        setCity(property.city ?? '');
        setStateVal(property.state ?? '');
        setProject(property.project ?? '');
        setLandZone(property.land_zone ?? '');
        setIdealFor(property.ideal_for ?? '');
        const dims = property.dimensions ?? '';
        setDimensions(dims);
        if (dims && dims.includes('x')) {
          const parts = dims.split('x');
          if (parts.length === 2) {
            setFrontage(parts[0].trim());
            setDepth(parts[1].trim());
          } else {
            setFrontage('');
            setDepth('');
          }
        } else {
          setFrontage('');
          setDepth('');
        }
        setRoadWidth(property.road_width !== null && property.road_width !== undefined ? String(property.road_width) : '');
        setRoadWidthUnit(property.road_width_unit ?? 'Feet');
        setFacingDirection(property.facing_direction ?? '');
        setIsPublished(property.is_published);
        setFeatures(property.features || []);
        setNearbyHighlights(property.nearby_highlights || []);
        setImages(property.images && property.images.length > 0 ? property.images : ['']);

        // Set unified query string on open
        if (property.project) {
          setSearchQuery(property.project);
        } else {
          setSearchQuery(property.sublocality ?? '');
        }

        // Attempt to parse address from location
        const locSegments = property.location.split(',').map(s => s.trim());
        const matchedState = property.state ?? '';
        const matchedCity = property.city ?? '';
        const matchedSublocality = property.sublocality ?? '';
        
        const addrSegments: string[] = [];
        locSegments.forEach(seg => {
          if (
            seg.toLowerCase() !== matchedState.toLowerCase() &&
            seg.toLowerCase() !== matchedCity.toLowerCase() &&
            seg.toLowerCase() !== matchedSublocality.toLowerCase()
          ) {
            addrSegments.push(seg);
          }
        });
        setAddress(addrSegments.join(', ') || '');
      } else {
        setTitle('');
        setDescription('');
        setPrice('');
        setType('Flat/ Apartment');
        setStatus('Available');
        setBedrooms('');
        setBathrooms('');
        setAreaSqft('');
        setAreaUnit('Sq.Ft.');
        setLandArea('');
        setLandAreaUnit('Sq.Ft.');
        setSuperBuiltArea('');
        setSublocality('');
        setCity('');
        setStateVal('');
        setAddress('');
        setProject('');
        setLandZone('');
        setIdealFor('');
        setDimensions('');
        setFrontage('');
        setDepth('');
        setRoadWidth('');
        setRoadWidthUnit('Feet');
        setFacingDirection('');
        setIsPublished(false);
        setFeatures([]);
        setNearbyHighlights([]);
        setImages(['']);
        setSearchQuery('');
      }
    }
  }, [open, property]);

  const isProjectMatched = !!project && POPULAR_PROJECTS.some(
    (p) => p.name.toLowerCase() === project.trim().toLowerCase()
  );

  function handleSearchQueryChange(val: string) {
    setSearchQuery(val);
    setShowSuggestions(true);
    
    // Check if the query matches a popular project exactly (case-insensitive)
    const exactProj = POPULAR_PROJECTS.find(
      (p) => p.name.toLowerCase() === val.trim().toLowerCase()
    );
    if (exactProj) {
      setProject(exactProj.name);
      setSublocality(exactProj.sublocality);
      setCity(exactProj.city);
      setStateVal(exactProj.state);
      setAddress(exactProj.address);
    } else {
      // Check if it matches a layout, sector, or main/cross (split by comma)
      const parts = val.split(',').map(s => s.trim());
      if (parts.length > 1) {
        setSublocality(parts[0]);
        setAddress(parts[1]);
      } else {
        const exactArea = POPULAR_SUBLOCALITIES.find(
          (a) => a.toLowerCase() === val.trim().toLowerCase()
        );
        if (exactArea) {
          setSublocality(exactArea);
        } else {
          setSublocality(val);
        }
      }
      setProject('');
    }
  }

  // Helper classifications based on selected type
  const hasBedsBaths = [
    'Flat/ Apartment',
    'Residential House',
    'Villa',
    'Builder Floor Apartment',
    'Penthouse',
    'Studio Apartment',
    'Farm House'
  ].includes(type);

  const hasCommercialFields = [
    'Commercial Office Space',
    'Office in IT Park/ SEZ',
    'Commercial Shop',
    'Commercial Showroom',
    'Commercial Land',
    'Warehouse/ Godown',
    'Industrial Land',
    'Industrial Building',
    'Industrial Shed'
  ].includes(type);

  const isLand = [
    'Residential Land/ Plot',
    'Commercial Land',
    'Industrial Land',
    'Agricultural Land'
  ].includes(type);

  // Update land area and dimensions automatically for land types
  useEffect(() => {
    if (!isLand) return;

    const areaNum = Number(landArea);
    const frontageNum = Number(frontage);
    const depthNum = Number(depth);

    // Case A: Frontage and Depth are typed -> Auto-calculate Land Area
    if (frontage && depth) {
      if (!isNaN(frontageNum) && !isNaN(depthNum) && frontageNum > 0 && depthNum > 0) {
        const calculatedArea = frontageNum * depthNum;
        if (Math.abs(Number(landArea) - calculatedArea) > 0.01) {
          setLandArea(String(calculatedArea));
        }
      }
    }
    // Case B: Land Area is typed, user enters Frontage -> Auto-calculate Depth
    else if (landArea && frontage && !depth) {
      if (!isNaN(areaNum) && !isNaN(frontageNum) && areaNum > 0 && frontageNum > 0) {
        const calculatedDepth = Math.round((areaNum / frontageNum) * 100) / 100;
        setDepth(String(calculatedDepth));
      }
    }
    // Case C: Land Area is typed, user enters Depth -> Auto-calculate Frontage
    else if (landArea && depth && !frontage) {
      if (!isNaN(areaNum) && !isNaN(depthNum) && areaNum > 0 && depthNum > 0) {
        const calculatedFrontage = Math.round((areaNum / depthNum) * 100) / 100;
        setFrontage(String(calculatedFrontage));
      }
    }
  }, [frontage, depth, landArea, isLand]);

  const filteredAmenities = useMemo(() => {
    if (isLand) {
      return {
        "Land Specifications": [
          "Fenced Boundary",
          "Access Road",
          "Electricity Connection",
          "Water Supply (Borewell)",
          "Rain Water Harvesting",
          "CCTV Surveillance",
          "24/7 Security",
        ]
      };
    }
    if (hasCommercialFields) {
      return {
        "Commercial Specifications": [
          "Centrally Air Conditioned",
          "Conference Room",
          "Cafeteria/Food Court",
          "Wi-Fi Connectivity",
          "ATM",
          "Service/Goods Lift",
        ],
        "Utilities & Security": [
          "24/7 Security",
          "CCTV Surveillance",
          "Power Backup",
          "Fire Fighting System",
          "Lift/Elevator",
          "Reserved Parking",
          "Visitor Parking",
          "Waste Disposal",
        ]
      };
    }
    // Default Residential
    return {
      "Security & Utilities": [
        "24/7 Security",
        "CCTV Surveillance",
        "Power Backup",
        "Intercom",
        "Fire Fighting System",
        "Water Supply (Corporation)",
        "Water Supply (Borewell)",
        "Rain Water Harvesting",
        "Waste Disposal",
      ],
      "Leisure & Community": [
        "Lift/Elevator",
        "Swimming Pool",
        "Gymnasium",
        "Club House",
        "Children's Play Area",
        "Reserved Parking",
        "Visitor Parking",
        "Gated Community",
      ]
    };
  }, [isLand, hasCommercialFields]);

  function getEquivalentPriceLabel(priceStr: string) {
    const priceNum = Number(priceStr);
    if (!priceStr || isNaN(priceNum) || priceNum <= 0) return '';
    
    if (priceNum >= 10000000) {
      const cr = priceNum / 10000000;
      return `Equivalent to: ₹${cr.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1')} Crore`;
    }
    if (priceNum >= 100000) {
      const lakhs = priceNum / 100000;
      return `Equivalent to: ₹${lakhs.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1')} Lakhs`;
    }
    return `Equivalent to: ₹${priceNum.toLocaleString('en-IN')}`;
  }

  async function onUploadImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingImage(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // 5MB limit
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large. Max size is 5MB.`);
          continue;
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const randomStr = Math.random().toString(36).substring(2, 7);
        // Scoped by account ID folder
        const path = `${accountId}/img-${Date.now()}-${randomStr}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from('property-images')
          .getPublicUrl(path);

        uploadedUrls.push(publicUrl);
      }

      if (uploadedUrls.length > 0) {
        setImages((prev) => {
          const filteredPrev = prev.filter(url => url.trim().length > 0);
          return [...filteredPrev, ...uploadedUrls];
        });
        toast.success(`Uploaded ${uploadedUrls.length} image(s)`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      toast.error(message);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleAddImageUrl() {
    setImages((prev) => [...prev, '']);
  }

  function handleRemoveImageUrl(index: number) {
    if (images.length === 1) {
      setImages(['']);
    } else {
      setImages((prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleImageUrlChange(index: number, value: string) {
    setImages((prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    if (!price.trim() || isNaN(Number(price)) || Number(price) < 0) {
      toast.error('Price must be a valid non-negative number');
      return;
    }

    let finalSublocality = sublocality.trim();
    if (!finalSublocality && searchQuery.trim()) {
      finalSublocality = searchQuery.trim();
    }

    if (!finalSublocality || !city.trim() || !stateVal.trim()) {
      toast.error('Location search query, City, and State are required');
      return;
    }

    if (isLand && (!landArea.trim() || isNaN(Number(landArea)) || Number(landArea) <= 0)) {
      toast.error('Land Area is required and must be a valid positive number');
      return;
    }

    setSaving(true);

    try {
      if (!user || !accountId) throw new Error('Not authenticated or account not loaded');

      const parsedPrice = Number(price);
      const parsedBedrooms = bedrooms.trim() !== '' ? Number(bedrooms) : null;
      const parsedBathrooms = bathrooms.trim() !== '' ? Number(bathrooms) : null;
      const parsedAreaSqft = areaSqft.trim() !== '' ? Number(areaSqft) : null;
      const parsedLandArea = landArea.trim() !== '' ? Number(landArea) : null;
      const parsedSuperBuiltArea = superBuiltArea.trim() !== '' ? Number(superBuiltArea) : null;
      const parsedRoadWidth = roadWidth.trim() !== '' ? Number(roadWidth) : null;

      const parsedFeatures = features;
      const parsedNearbyHighlights = nearbyHighlights;
      const parsedImages = images.map((img) => img.trim()).filter((img) => img.length > 0);

      // Construct formatted complete location string
      const fullLocation = [address.trim(), finalSublocality, city.trim(), stateVal.trim()]
        .filter(Boolean)
        .join(', ');

      let finalDimensions = dimensions.trim();
      if (isLand) {
        if (frontage.trim() && depth.trim()) {
          finalDimensions = `${frontage.trim()}x${depth.trim()}`;
        } else {
          finalDimensions = '';
        }
      }

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        price: parsedPrice,
        location: fullLocation,
        type,
        status: isEdit ? status : "Available", // Force Available for additions
        bedrooms: parsedBedrooms,
        bathrooms: parsedBathrooms,
        area_sqft: parsedAreaSqft,
        area_unit: areaUnit,
        land_area: parsedLandArea,
        land_area_unit: landAreaUnit,
        super_built_area: parsedSuperBuiltArea,
        sublocality: finalSublocality,
        city: city.trim(),
        state: stateVal.trim(),
        project: project.trim() || null,
        land_zone: landZone.trim() || null,
        ideal_for: idealFor.trim() || null,
        dimensions: finalDimensions || null,
        road_width: parsedRoadWidth,
        road_width_unit: roadWidthUnit,
        facing_direction: facingDirection || null,
        nearby_highlights: parsedNearbyHighlights,
        is_published: isPublished,
        features: parsedFeatures,
        images: parsedImages,
        updated_at: new Date().toISOString(),
      };

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
          throw new Error(errData.error || 'Failed to create property');
        }
      }

      toast.success(isEdit ? 'Property updated successfully' : 'Property created successfully');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while saving';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  // Filter project & area lists based on search query
  const query = searchQuery.trim().toLowerCase();
  
  const filteredProjects = query
    ? POPULAR_PROJECTS.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 5)
    : POPULAR_PROJECTS.slice(0, 5);

  const filteredSublocalities = useMemo(() => {
    const dataset = localitiesDb?.detailed || POPULAR_SUBLOCALITIES;
    if (!query) {
      return dataset.slice(0, 8);
    }
    return dataset
      .filter((s) => s.toLowerCase().includes(query))
      .slice(0, 8);
  }, [query, localitiesDb]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          
          <div className="px-6 pt-5 border-b border-slate-800 bg-slate-950/40">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-white flex items-center justify-between">
                <span>{isEdit ? 'Edit Property Listing' : 'Add New Property Listing'}</span>
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Configure listing specifications, location details, and matching preferences.
              </DialogDescription>
            </DialogHeader>

            <TabsList className="bg-slate-900 border border-slate-800 mb-3 w-fit">
              <TabsTrigger value="details" className="data-[state=active]:bg-slate-800 data-[state=active]:text-primary text-slate-400 px-4 py-1.5 text-xs font-semibold">
                Property Details
              </TabsTrigger>
              <TabsTrigger value="matches" className="data-[state=active]:bg-slate-800 data-[state=active]:text-primary text-slate-400 px-4 py-1.5 text-xs font-semibold">
                Matching Contacts ({matchedContacts.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* PROPERTY DETAILS TAB */}
            <TabsContent value="details" className="m-0 px-6 py-4 focus:outline-none">
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Main Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="prop-title" className="text-slate-300">
                      Property Title <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="prop-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Luxurious 3BHK Apartment in Downtown"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prop-price" className="text-slate-300">
                      Price (INR) <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="prop-price"
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="e.g. 12000000"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                    {price && !isNaN(Number(price)) && Number(price) > 0 && (
                      <p className="text-[11px] text-primary font-semibold mt-0.5">
                        {getEquivalentPriceLabel(price)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prop-type" className="text-slate-300">
                      Property Type
                    </Label>
                    <select
                      id="prop-type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-950 font-medium"
                    >
                      <optgroup label="ALL RESIDENTIAL">
                        <option value="Flat/ Apartment">Flat/ Apartment</option>
                        <option value="Residential House">Residential House</option>
                        <option value="Villa">Villa</option>
                        <option value="Builder Floor Apartment">Builder Floor Apartment</option>
                        <option value="Residential Land/ Plot">Residential Land/ Plot</option>
                        <option value="Penthouse">Penthouse</option>
                        <option value="Studio Apartment">Studio Apartment</option>
                      </optgroup>
                      <optgroup label="ALL COMMERCIAL">
                        <option value="Commercial Office Space">Commercial Office Space</option>
                        <option value="Office in IT Park/ SEZ">Office in IT Park/ SEZ</option>
                        <option value="Commercial Shop">Commercial Shop</option>
                        <option value="Commercial Showroom">Commercial Showroom</option>
                        <option value="Commercial Land">Commercial Land</option>
                        <option value="Warehouse/ Godown">Warehouse/ Godown</option>
                        <option value="Industrial Land">Industrial Land</option>
                        <option value="Industrial Building">Industrial Building</option>
                        <option value="Industrial Shed">Industrial Shed</option>
                      </optgroup>
                      <optgroup label="ALL AGRICULTURAL">
                        <option value="Agricultural Land">Agricultural Land</option>
                        <option value="Farm House">Farm House</option>
                      </optgroup>
                    </select>
                  </div>

                  {isEdit && (
                    <div className="space-y-1.5 col-span-2">
                      <Label htmlFor="prop-status" className="text-slate-300">
                        Status
                      </Label>
                      <select
                        id="prop-status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-950 font-medium"
                      >
                        <option value="Available">Available</option>
                        <option value="Under Contract">Under Contract</option>
                        <option value="Sold">Sold</option>
                        <option value="Off Market">Off Market</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <Label htmlFor="prop-description" className="text-slate-300">
                      Description
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateAIDescription}
                      disabled={generatingDescription || !title.trim()}
                      className="h-7 px-2.5 text-xs text-primary hover:text-primary-hover hover:bg-primary/10 flex items-center gap-1 font-semibold disabled:opacity-50 disabled:cursor-not-allowed border border-primary/20 rounded-md"
                    >
                      {generatingDescription ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <span>✨</span> Generate with AI
                        </>
                      )}
                    </Button>
                  </div>
                  <Textarea
                    id="prop-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the property's design, styling details, location benefits, etc..."
                    rows={4}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                  <p className="text-[10px] text-slate-500 font-medium leading-normal">
                    💡 <span className="text-slate-400 font-semibold">Tip for better AI results:</span> fill out title, area, amenities, landmarks, and other specs before generating.
                  </p>
                </div>

                {/* Autocomplete Real Location Details */}
                <div className="space-y-3 p-4 rounded-lg border border-slate-800 bg-slate-950/20">
                  <h4 className="text-sm font-semibold text-white">Property Location</h4>
                  
                  <div className="space-y-1.5 relative" ref={autocompleteRef}>
                    <Label htmlFor="prop-search-query" className="text-slate-300">
                      Project Name or Area / Sublocality <span className="text-red-400">*</span>
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
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                      required
                    />
                    
                    {showSuggestions && (
                      <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-700 bg-slate-800 shadow-xl text-slate-200">
                        {filteredProjects.length === 0 && filteredSublocalities.length === 0 ? (
                          <div className="p-3 text-xs text-slate-500 text-center">
                            No matching projects or areas. Keep typing to enter a custom value.
                          </div>
                        ) : (
                          <div>
                            {filteredProjects.length > 0 && (
                              <div className="p-1">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-2 py-1">
                                  🏢 Projects
                                </div>
                                {filteredProjects.map((p) => (
                                  <button
                                    key={p.name}
                                    type="button"
                                    onClick={() => {
                                      setProject(p.name);
                                      setSublocality(p.sublocality);
                                      setCity(p.city);
                                      setStateVal(p.state);
                                      setAddress(p.address);
                                      setSearchQuery(p.name);
                                      setShowSuggestions(false);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-slate-700 text-slate-200 hover:text-white transition-colors"
                                  >
                                    <span className="font-bold">{p.name}</span>
                                    <span className="text-slate-400"> - {p.sublocality}, {p.city}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            
                            {filteredSublocalities.length > 0 && (
                              <div className="p-1 border-t border-slate-700">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-2 py-1">
                                  📍 Areas / Sublocalities
                                </div>
                                {filteredSublocalities.map((sub) => (
                                  <button
                                    key={sub}
                                    type="button"
                                    onClick={() => {
                                      setProject('');
                                      const parts = sub.split(',').map(s => s.trim());
                                      if (parts.length > 1) {
                                        setSublocality(parts[0]);
                                        setAddress(parts[1]);
                                      } else {
                                        setSublocality(sub);
                                        setAddress('');
                                      }
                                      setCity('Bangalore');
                                      setStateVal('Karnataka');
                                      setSearchQuery(sub);
                                      setShowSuggestions(false);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-slate-700 text-slate-200 hover:text-white transition-colors"
                                  >
                                    <span className="font-medium text-slate-200">{sub}</span>
                                    <span className="text-slate-400"> - Bangalore, Karnataka</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {isProjectMatched && (
                      <p className="text-[10px] text-green-400 font-medium mt-0.5">
                        Linked to project location details (pre-filled fields locked).
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
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Bangalore"
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        onChange={(e) => setStateVal(e.target.value)}
                        placeholder="e.g. Karnataka"
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 disabled:opacity-50 disabled:cursor-not-allowed"
                        required
                        disabled={isProjectMatched}
                      />
                    </div>

                    <div className="space-y-1.5 col-span-2">
                      <Label htmlFor="prop-address" className="text-slate-300">
                        Landmark / Street Address
                      </Label>
                      <Input
                        id="prop-address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="e.g. Near Metro Station"
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isProjectMatched}
                      />
                    </div>

                    {/* Commercial Location Fields */}
                    {hasCommercialFields && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="prop-land-zone" className="text-slate-300">
                            Land Zone
                          </Label>
                          <select
                            id="prop-land-zone"
                            value={landZone}
                            onChange={(e) => setLandZone(e.target.value)}
                            className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-950 font-medium"
                          >
                            <option value="">Select Land Zone</option>
                            <option value="Industrial">Industrial</option>
                            <option value="Commercial">Commercial</option>
                            <option value="Residential">Residential</option>
                            <option value="Agricultural">Agricultural</option>
                            <option value="Mixed Use">Mixed Use</option>
                            <option value="SEZ">SEZ (Special Economic Zone)</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="prop-ideal-for" className="text-slate-300">
                            Ideal For Businesses
                          </Label>
                          <Input
                            id="prop-ideal-for"
                            value={idealFor}
                            onChange={(e) => setIdealFor(e.target.value)}
                            placeholder="e.g. Software, Bank, Clinic"
                            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Area & Specification Fields */}
                <div className="space-y-4 p-4 rounded-lg border border-slate-800 bg-slate-950/20">
                  <h4 className="text-sm font-semibold text-white">Area & Specs</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {hasBedsBaths && (
                      <div className="space-y-1.5">
                        <Label htmlFor="prop-bedrooms" className="text-slate-300">
                          Beds
                        </Label>
                        <Input
                          id="prop-bedrooms"
                          type="number"
                          value={bedrooms}
                          onChange={(e) => setBedrooms(e.target.value)}
                          placeholder="e.g. 3"
                          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                        />
                      </div>
                    )}

                    {hasBedsBaths && (
                      <div className="space-y-1.5">
                        <Label htmlFor="prop-bathrooms" className="text-slate-300">
                          Baths
                        </Label>
                        <Input
                          id="prop-bathrooms"
                          type="number"
                          value={bathrooms}
                          onChange={(e) => setBathrooms(e.target.value)}
                          placeholder="e.g. 2"
                          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                        />
                      </div>
                    )}

                    {isLand ? (
                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="prop-land-area" className="text-slate-300">
                          Land Area <span className="text-red-400">*</span>
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="prop-land-area"
                            type="number"
                            value={landArea}
                            onChange={(e) => setLandArea(e.target.value)}
                            placeholder="e.g. 2400"
                            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 flex-1"
                            required
                          />
                          <select
                            value={landAreaUnit}
                            onChange={(e) => setLandAreaUnit(e.target.value)}
                            className="w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary h-9 font-medium"
                          >
                            {AREA_UNITS.map((unit) => (
                              <option key={unit} value={unit}>{unit}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1.5 col-span-2">
                          <Label htmlFor="prop-area" className="text-slate-300">
                            Built-up Area
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="prop-area"
                              type="number"
                              value={areaSqft}
                              onChange={(e) => setAreaSqft(e.target.value)}
                              placeholder="e.g. 1500"
                              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 flex-1"
                            />
                            <select
                              value={areaUnit}
                              onChange={(e) => setAreaUnit(e.target.value)}
                              className="w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary h-9 font-medium"
                            >
                              {AREA_UNITS.map((unit) => (
                                <option key={unit} value={unit}>{unit}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="prop-super-built" className="text-slate-300">
                            Super Built-up Area ({areaUnit})
                          </Label>
                          <Input
                            id="prop-super-built"
                            type="number"
                            value={superBuiltArea}
                            onChange={(e) => setSuperBuiltArea(e.target.value)}
                            placeholder="e.g. 1800"
                            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="prop-land-area" className="text-slate-300">
                            Land Area
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="prop-land-area"
                              type="number"
                              value={landArea}
                              onChange={(e) => setLandArea(e.target.value)}
                              placeholder="e.g. 2400"
                              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 flex-1"
                            />
                            <select
                              value={landAreaUnit}
                              onChange={(e) => setLandAreaUnit(e.target.value)}
                              className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary h-9 font-medium"
                            >
                              {AREA_UNITS.map((unit) => (
                                <option key={unit} value={unit}>{unit}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    {isLand ? (
                      <div className="col-span-2 grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="prop-frontage" className="text-slate-300">
                            Frontage (Ft)
                          </Label>
                          <Input
                            id="prop-frontage"
                            type="number"
                            value={frontage}
                            onChange={(e) => setFrontage(e.target.value)}
                            placeholder="e.g. 30"
                            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="prop-depth" className="text-slate-300">
                            Depth (Ft)
                          </Label>
                          <Input
                            id="prop-depth"
                            type="number"
                            value={depth}
                            onChange={(e) => setDepth(e.target.value)}
                            placeholder="e.g. 40"
                            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="prop-dimensions" className="text-slate-300">
                          Dimensions
                        </Label>
                        <Input
                          id="prop-dimensions"
                          value={dimensions}
                          onChange={(e) => setDimensions(e.target.value)}
                          placeholder="e.g. 30x40, 50x80 (Width x Length)"
                          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="prop-road-width" className="text-slate-300">
                        Road Width
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="prop-road-width"
                          type="number"
                          value={roadWidth}
                          onChange={(e) => setRoadWidth(e.target.value)}
                          placeholder="e.g. 40"
                          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 flex-1"
                        />
                        <select
                          value={roadWidthUnit}
                          onChange={(e) => setRoadWidthUnit(e.target.value)}
                          className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary h-9 font-medium"
                        >
                          <option value="Feet">Feet</option>
                          <option value="Meters">Meters</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="prop-facing" className="text-slate-300">
                        Facing Direction
                      </Label>
                      <select
                        id="prop-facing"
                        value={facingDirection}
                        onChange={(e) => setFacingDirection(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-950 font-medium"
                      >
                        <option value="">Select Facing</option>
                        {FACING_DIRECTIONS.map((dir) => (
                          <option key={dir} value={dir}>{dir}</option>
                        ))}
                      </select>
                    </div>

                    {/* Amenities Checkbox Selection */}
                    <div className="space-y-3 p-4 rounded-lg border border-slate-800 bg-slate-950/20 col-span-2">
                      <Label className="text-slate-300 font-semibold text-sm">Amenities</Label>
                      <div className="space-y-4 mt-1">
                        {Object.entries(filteredAmenities).map(([category, items]) => (
                          <div key={category} className="space-y-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                              {category}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {items.map((amenity: string) => {
                                const isChecked = features.includes(amenity);
                                return (
                                  <label
                                    key={amenity}
                                    className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleFeature(amenity)}
                                      className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary focus:ring-offset-slate-950 size-3.5"
                                    />
                                    <span>{amenity}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Collapsible Advanced section (landmarks) */}
                    <div className="col-span-2 border-t border-slate-800 pt-4">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                      >
                        {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        <span>{showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}</span>
                      </button>

                      {showAdvanced && (
                        <div className="mt-3 space-y-3 border border-slate-800 bg-slate-950/10 p-4 rounded-lg">
                          <Label className="text-slate-300 font-semibold text-xs">Nearby Highlights / Landmarks</Label>
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            {NEARBY_HIGHLIGHTS_OPTIONS.map((highlight) => {
                              const isChecked = nearbyHighlights.includes(highlight);
                              return (
                                <label
                                  key={highlight}
                                  className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleHighlight(highlight)}
                                    className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary focus:ring-offset-slate-950 size-3.5"
                                  />
                                  <span>{highlight}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Images URLs Input */}
                    <div className="space-y-3 p-4 rounded-lg border border-slate-800 bg-slate-950/20 col-span-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-slate-300">Property Images</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingImage}
                          className="h-7 text-xs text-primary hover:bg-primary/10 flex items-center gap-1 font-semibold"
                        >
                          {uploadingImage ? (
                            <>
                              <Loader2 className="size-3 animate-spin" /> Uploading...
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

                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {images.map((imgUrl, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <Input
                              value={imgUrl}
                              onChange={(e) => handleImageUrlChange(idx, e.target.value)}
                              placeholder="Image URL (e.g. https://...)"
                              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs flex-1"
                            />
                            {images.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveImageUrl(idx)}
                                className="h-8 w-8 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
                          className="h-7 text-xs text-slate-400 hover:text-white flex items-center gap-1 mt-1 font-semibold"
                        >
                          <Plus className="size-3" /> Add Image URL
                        </Button>
                      </div>
                    </div>

                    {/* Publish visibility Switch */}
                    <div className="flex items-center justify-between col-span-2 border-t border-slate-800 pt-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="prop-published"
                          checked={isPublished}
                          onCheckedChange={setIsPublished}
                        />
                        <Label htmlFor="prop-published" className="text-slate-300 text-sm cursor-pointer">
                          Publish / Visible on Listing Page
                        </Label>
                      </div>
                    </div>

                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-800 pt-4 mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={saving}
                    className="border-slate-700 hover:bg-slate-800 text-slate-350"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold flex items-center gap-1.5"
                  >
                    {saving && <Loader2 className="size-3.5 animate-spin" />}
                    {isEdit ? 'Save Changes' : 'Create Listing'}
                  </Button>
                </div>
              </form>
            </TabsContent>

            {/* MATCHING CONTACTS TAB */}
            <TabsContent value="matches" className="m-0 px-6 py-4 focus:outline-none flex flex-col flex-1 min-h-0">
              {!isEdit ? (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-900/35">
                  <Users className="size-8 mx-auto text-slate-600 mb-2" />
                  <p className="text-sm text-slate-400 font-semibold">Please save this property listing first to view matching contacts.</p>
                </div>
              ) : (
                <>
                  {/* STEP 1: Matches list */}
                  {broadcastStep === 'matches' && (
                    <div className="space-y-4 flex flex-col flex-1 min-h-0">
                      <div className="flex justify-between items-center bg-slate-950/20 border border-slate-850 p-3 rounded-lg">
                        <div className="text-xs font-semibold text-slate-400">
                          {loadingContacts ? (
                            'Searching matching profiles...'
                          ) : matchedContacts.length === 0 ? (
                            '0 matching contacts found'
                          ) : (
                            `Found ${matchedContacts.length} matching contact${matchedContacts.length === 1 ? '' : 's'}`
                          )}
                        </div>
                        {matchedContacts.length > 0 && (
                          <button
                            type="button"
                            onClick={toggleSelectAllContacts}
                            className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer"
                          >
                            {selectedContactIds.length === matchedContacts.length ? (
                              <>
                                <CheckSquare className="size-3.5" /> Deselect All
                              </>
                            ) : (
                              <>
                                <Square className="size-3.5" /> Select All ({matchedContacts.length})
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-[30vh]">
                        {loadingContacts ? (
                          <div className="flex justify-center items-center py-12 text-slate-500">
                            <Loader2 className="size-6 animate-spin text-primary mr-2" />
                            Scanning database...
                          </div>
                        ) : matchedContacts.length === 0 ? (
                          <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
                            <Users className="size-8 mx-auto text-slate-600 mb-2" />
                            <p className="text-sm text-slate-400 font-medium">No matching contacts found</p>
                            <p className="text-xs text-slate-550 mt-1">Adjust preferences or add budget tags to contacts.</p>
                          </div>
                        ) : (
                          matchedContacts.map(({ contact: c, score, matchedFields }) => {
                            const isSelected = selectedContactIds.includes(c.id);
                            return (
                              <div
                                key={c.id}
                                onClick={() => toggleContactSelection(c.id)}
                                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-primary/5 border-primary/45 ring-1 ring-primary/10'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-750'
                                }`}
                              >
                                <button
                                  type="button"
                                  className={`shrink-0 mt-0.5 ${isSelected ? 'text-primary' : 'text-slate-650'}`}
                                >
                                  {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <h4 className="text-sm font-bold text-white truncate">{c.name || 'Unnamed Contact'}</h4>
                                    <Badge
                                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                        score >= 70
                                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                          : score >= 30
                                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                            : 'bg-slate-850 text-slate-400'
                                      }`}
                                    >
                                      {score}% Match
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-slate-450 font-mono mt-0.5">{c.phone}</p>

                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {matchedFields.budget && (
                                      <Badge className="bg-emerald-500/5 text-emerald-400 border border-emerald-500/10 text-[9px] px-1.5 py-0">
                                        Budget matches
                                      </Badge>
                                    )}
                                    {matchedFields.area && (
                                      <Badge className="bg-sky-500/5 text-sky-450 border border-sky-500/10 text-[9px] px-1.5 py-0">
                                        Location matches
                                      </Badge>
                                    )}
                                    {matchedFields.interest && (
                                      <Badge className="bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 text-[9px] px-1.5 py-0">
                                        Interest matches
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="border-t border-slate-800 pt-4 flex justify-between items-center mt-auto">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-slate-800 hover:bg-slate-850">
                          Close
                        </Button>
                        <Button
                          type="button"
                          disabled={selectedContactIds.length === 0 || !isEdit}
                          onClick={() => setBroadcastStep('configure')}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-1.5"
                        >
                          <Send className="size-3.5" />
                          Broadcast Alert to Selected ({selectedContactIds.length})
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: Configure Template Parameter Mappings */}
                  {broadcastStep === 'configure' && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setBroadcastStep('matches')}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                        >
                          <ArrowLeft className="size-4" />
                        </Button>
                        <div className="text-sm font-semibold text-white">Configure Broadcast Message</div>
                      </div>

                      {/* Template Selector */}
                      <div className="space-y-1.5">
                        <Label htmlFor="broadcast-template" className="text-slate-300">
                          WhatsApp Template
                        </Label>
                        {loadingTemplates ? (
                          <div className="flex items-center text-xs text-slate-500 gap-1.5 py-1">
                            <Loader2 className="size-3.5 animate-spin text-primary" /> Loading templates...
                          </div>
                        ) : (
                          <select
                            id="broadcast-template"
                            value={selectedTemplate?.id || ''}
                            onChange={(e) => {
                              const t = templates.find((tpl) => tpl.id === e.target.value);
                              setSelectedTemplate(t || null);
                            }}
                            className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">Select Template...</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>{t.name} ({t.language || 'en_US'})</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {selectedTemplate && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-slate-800 p-4 rounded-xl bg-slate-950/15">
                          {/* Parameter mappings */}
                          <div className="space-y-3">
                            <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Message Placeholders</h5>
                            {placeholders.map((placeholder) => {
                              const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                              const mapping = variableMappings[key] || { type: 'static', value: 'custom' };
                              return (
                                <div key={key} className="space-y-1.5 border border-slate-800/40 p-2.5 rounded-lg bg-slate-900/40">
                                  <Label className="text-xs text-slate-350 font-semibold flex items-center justify-between">
                                    <span>Variable {placeholder}</span>
                                  </Label>
                                  <div className="flex gap-2">
                                    <select
                                      value={mapping.type === 'field' ? mapping.value : `static-${mapping.value}`}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setVariableMappings((prev) => {
                                          const copy = { ...prev };
                                          if (val.startsWith('static-')) {
                                            copy[key] = { type: 'static', value: val.replace('static-', '') };
                                          } else {
                                            copy[key] = { type: 'field', value: val };
                                          }
                                          return copy;
                                        });
                                      }}
                                      className="flex-1 h-8 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-white"
                                    >
                                      <optgroup label="Contact Fields">
                                        <option value="name">Contact Name</option>
                                        <option value="phone">Contact Phone</option>
                                        <option value="email">Contact Email</option>
                                        <option value="company">Contact Company</option>
                                      </optgroup>
                                      <optgroup label="Property Fields">
                                        <option value="static-title">Property Title</option>
                                        <option value="static-price">Price (Formatted)</option>
                                        <option value="static-location">Location / Area</option>
                                      </optgroup>
                                      <optgroup label="Custom Static Value">
                                        <option value="static-custom">Custom Text...</option>
                                      </optgroup>
                                    </select>
                                  </div>
                                  {mapping.type === 'static' && mapping.value === 'custom' && (
                                    <Input
                                      value={customVariableValues[key] || ''}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setCustomVariableValues((prev) => ({ ...prev, [key]: v }));
                                      }}
                                      placeholder="Type custom text..."
                                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs mt-1.5"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Live Message Preview */}
                          <div className="space-y-2 flex flex-col h-full">
                            <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                              <Smartphone className="size-3.5" /> Message Preview
                            </h5>
                            
                            <div className="flex-1 bg-slate-950 border border-slate-850 p-4 rounded-xl text-xs flex flex-col font-sans relative min-h-[160px] justify-between">
                              <div className="whitespace-pre-wrap text-slate-300 leading-relaxed">
                                {(() => {
                                  let body = selectedTemplate.body_text;
                                  placeholders.forEach((placeholder) => {
                                    const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                                    const mapping = variableMappings[key];
                                    let val = placeholder;
                                    if (mapping) {
                                      if (mapping.type === 'field') {
                                        if (mapping.value === 'name') val = `[Contact Name]`;
                                        else if (mapping.value === 'phone') val = `[Contact Phone]`;
                                        else if (mapping.value === 'email') val = `[Contact Email]`;
                                        else if (mapping.value === 'company') val = `[Contact Company]`;
                                      } else {
                                        const fullLoc = [address.trim(), sublocality.trim(), city.trim(), stateVal.trim()]
                                          .filter(Boolean)
                                          .join(', ');
                                        if (mapping.value === 'title') val = title || `[Property Title]`;
                                        else if (mapping.value === 'price') val = formattedPrice || `[Formatted Price]`;
                                        else if (mapping.value === 'location') val = sublocality || fullLoc || `[Location]`;
                                        else if (mapping.value === 'custom') val = customVariableValues[key] || `[Custom Text]`;
                                      }
                                    }
                                    body = body.replace(placeholder, val);
                                  });
                                  return body;
                                })()}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-4 border-t border-slate-800/80 pt-2 flex items-center justify-between">
                                <span>Recipient will see dynamic contact details.</span>
                                <span className="font-semibold">{selectedTemplate.language || 'en_US'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="border-t border-slate-800 pt-4 flex justify-between items-center mt-4">
                        <Button type="button" variant="outline" onClick={() => setBroadcastStep('matches')} className="border-slate-800 hover:bg-slate-850">
                          Back to List
                        </Button>
                        <Button
                          type="button"
                          disabled={sendingBroadcast || !selectedTemplate}
                          onClick={handleSendBroadcast}
                          className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold flex items-center gap-1.5"
                        >
                          {sendingBroadcast ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" /> Sending...
                            </>
                          ) : (
                            <>
                              <Send className="size-3.5" />
                              Send Broadcast Alert ({selectedContactIds.length})
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 3: Sending Status */}
                  {broadcastStep === 'sending' && (
                    <div className="flex flex-col items-center justify-center py-16 space-y-4">
                      <Loader2 className="size-10 animate-spin text-primary" />
                      <div className="text-center">
                        <h4 className="text-sm font-semibold text-white">Sending WhatsApp Broadcast</h4>
                        <p className="text-xs text-slate-500 mt-1">Dispatching messages to {selectedContactIds.length} recipients. Please do not close this modal.</p>
                      </div>
                    </div>
                  )}

                  {/* STEP 4: Sending Results */}
                  {broadcastStep === 'results' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-2">
                        <h4 className="text-sm font-semibold text-white">Broadcast Complete</h4>
                        <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                          Dispatched Results
                        </Badge>
                      </div>

                      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        {broadcastResults.map((res, idx) => (
                          <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                            <div>
                              <div className="text-xs font-bold text-white">{res.name}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{res.phone}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {res.status === 'sent' ? (
                                <Badge className="bg-green-500/10 text-green-400 border border-green-500/20 text-[10px] font-bold">
                                  Success
                                </Badge>
                              ) : (
                                <div className="flex flex-col items-end">
                                  <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold">
                                    Failed
                                  </Badge>
                                  {res.error && <span className="text-[9px] text-red-400/80 mt-0.5">{res.error}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t border-slate-850 pt-4 flex justify-end">
                        <Button
                          type="button"
                          onClick={() => {
                            setBroadcastStep('matches');
                            setSelectedContactIds([]);
                            setActiveTab('details');
                            onOpenChange(false);
                            onSaved();
                          }}
                          className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold"
                        >
                          Done & Close
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
