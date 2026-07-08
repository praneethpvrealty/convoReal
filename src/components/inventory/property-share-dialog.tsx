'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Property, Contact, MessageTemplate } from '@/types';
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
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Users,
  Send,
  CheckSquare,
  Square,
  ArrowLeft,
  Smartphone,
  Plus,
  UserPlus,
  Share2,
  X,
  Copy,
  Check,
  ExternalLink,
  Search,
} from 'lucide-react';
import { getMatchingContacts, type MatchDetails } from '@/lib/matching';
import { MatchDetailChips } from '@/components/inventory/match-detail-chips';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

interface PropertyShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
  onSaved?: () => void;
  preSelectedContactId?: string;
}

export function PropertyShareDialog({
  open,
  onOpenChange,
  property,
  onSaved,
  preSelectedContactId,
}: PropertyShareDialogProps) {
  const supabase = createClient();
  const { user, accountId, profile } = useAuth();

  // Dialog flow steps: 'link' | 'matches' | 'configure' | 'sending' | 'results'
  const [broadcastStep, setBroadcastStep] = useState<'link' | 'matches' | 'configure' | 'sending' | 'results'>('link');
  const [copiedLink, setCopiedLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Contact list and selections
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [showAgentsInMatches, setShowAgentsInMatches] = useState(false);

  // Template config
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  const [selectedBroadcastImage, setSelectedBroadcastImage] = useState<string>('');
  const [variableMappings, setVariableMappings] = useState<Record<string, { type: 'field' | 'static'; value: string }>>({});
  const [customVariableValues, setCustomVariableValues] = useState<Record<string, string>>({});

  // Sending status
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastResults, setBroadcastResults] = useState<Array<{ name: string; phone: string; status: 'sent' | 'failed'; error?: string }>>([]);

  // Fresh Contact Form state
  const [showAddFresh, setShowAddFresh] = useState(false);
  const [freshName, setFreshName] = useState('');
  const [freshPhone, setFreshPhone] = useState('');
  const [freshClassification, setFreshClassification] = useState<'Buyer' | 'Agent'>('Buyer');
  const [addingFresh, setAddingFresh] = useState(false);
  const [currency, setCurrency] = useState('INR');
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState<'template' | 'catalog' | 'greeting'>('template');
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [metaCatalogSyncedAt, setMetaCatalogSyncedAt] = useState<string | null>(null);
  const [metaCatalogError, setMetaCatalogError] = useState<string | null>(null);
  const [indexingTimeLeft, setIndexingTimeLeft] = useState<number>(0);
  const [messageStyle, setMessageStyle] = useState<'professional' | 'casual' | 'friendly' | 'custom'>('professional');
  const [customMessage, setCustomMessage] = useState('');
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);

  useEffect(() => {
    if (!metaCatalogSyncedAt) {
      setIndexingTimeLeft(0);
      return;
    }

    const calculateTimeLeft = () => {
      const syncedTime = new Date(metaCatalogSyncedAt).getTime();
      const elapsed = (Date.now() - syncedTime) / 1000;
      const cooldown = 90; // 90 seconds indexing cooldown for Meta Catalog
      if (elapsed < cooldown) {
        setIndexingTimeLeft(Math.ceil(cooldown - elapsed));
      } else {
        setIndexingTimeLeft(0);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [metaCatalogSyncedAt]);

  useEffect(() => {
    if (open && accountId) {
      supabase
        .from('whatsapp_config')
        .select('catalog_id')
        .eq('account_id', accountId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.catalog_id) {
            setCatalogId(data.catalog_id);
          } else {
            setCatalogId(null);
          }
        });
    }
  }, [open, accountId, supabase]);

  // Currency Formatter
  const formattedPrice = useMemo(() => {
    if (!property) return '';
    const amount = Number(property.price);
    if (isNaN(amount) || amount <= 0) return '';
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
  }, [property, currency]);

  // Generate shareable message based on style and property details
  const generateShareMessage = useCallback(() => {
    if (!property) return '';
    
    const showcaseUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/?property_id=${property.id}` 
      : `/?property_id=${property.id}`;
    
    const title = property.title || 'this property';
    const price = formattedPrice || 'Price on request';
    const location = [property.sublocality, property.city, property.state].filter(Boolean).join(', ') || property.location || '';
    const type = property.type || '';
    const beds = property.bedrooms ? `${property.bedrooms} BHK` : '';
    const area = property.area_sqft ? `${property.area_sqft} ${property.area_unit || 'Sq.Ft.'}` : '';
    const agentName = profile?.full_name || '';
    const agentPhone = profile?.phone || '';
    const signOff = agentName ? `Best regards, ${agentName}` : 'Best regards';
    const signOffWithPhone = agentPhone ? `${signOff}\n${agentPhone}` : signOff;
    
    const details = [beds, type, area, location].filter(Boolean).join(' | ');
    
    switch (messageStyle) {
      case 'professional':
        return `Hi,\n\nI wanted to share a property listing that might interest you:\n\n*${title}*\n${details ? `${details}\n` : ''}*Price: ${price}*\n\nFor complete details, photos, and location map, please visit:\n${showcaseUrl}\n\nFeel free to reach out if you have any questions.\n\n${signOffWithPhone}`;
      
      case 'casual':
        return `Hey!\n\nCheck out this property I found:\n\n*${title}*\n${details ? `${details}\n` : ''}*Price: ${price}*\n\nHere's the link with all the details:\n${showcaseUrl}\n\nLet me know what you think!`;
      
      case 'friendly':
        return `Hello! 👋\n\nI thought you might be interested in this property:\n\n*${title}*\n${details ? `${details}\n` : ''}*Price: ${price}*\n\nYou can see all the details, photos, and the exact location here:\n${showcaseUrl}\n\nHappy to help if you'd like to know more!`;
      
      case 'custom':
        return customMessage || `Hi,\n\n${title}\n${showcaseUrl}`;
      
      default:
        return `Hi,\n\n${title}\n${showcaseUrl}`;
    }
  }, [property, formattedPrice, messageStyle, customMessage, profile]);

  // Generate co-broker / agent message with agent-mode URL
  const generateAgentMessage = useCallback(() => {
    if (!property) return '';
    const title = property.title || 'this property';
    const price = formattedPrice || 'Price on request';
    const location = [property.sublocality, property.city, property.state].filter(Boolean).join(', ') || property.location || '';
    const type = property.type || '';
    const beds = property.bedrooms ? `${property.bedrooms} BHK` : '';
    const area = property.area_sqft ? `${property.area_sqft} ${property.area_unit || 'Sq.Ft.'}` : '';
    const agentName = profile?.full_name || '';
    const agentPhone = profile?.phone || '';
    const details = [beds, type, area, location].filter(Boolean).join(' | ');
    const signOff = agentName ? `Regards, ${agentName}` : 'Regards';
    const signOffWithPhone = agentPhone ? `${signOff}\n${agentPhone}` : signOff;

    const agentUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?property_id=${property.id}&mode=view`
      : `/?property_id=${property.id}&mode=view`;

    return `Hi,\n\nThis property is handpicked matching your requirements — check out all the details, photos, and location map:\n\n*${title}*\n${details ? `${details}\n` : ''}*Price: ${price}*\n\n👇 *Click the link below to view photos, location map, and full details:*\n${agentUrl}\n\n${signOffWithPhone}`;
  }, [property, formattedPrice, profile]);

  // Get showcase URL for copying
  const showcaseUrl = useMemo(() => {
    if (!property) return '';
    return typeof window !== 'undefined' 
      ? `${window.location.origin}/?property_id=${property.id}` 
      : `/?property_id=${property.id}`;
  }, [property]);

  // Agent showcase URL — clean listing detail page (no inquiry form, no buttons)
  const agentShowcaseUrl = useMemo(() => {
    if (!property) return '';
    return typeof window !== 'undefined'
      ? `${window.location.origin}/?property_id=${property.id}&mode=view`
      : `/?property_id=${property.id}&mode=view`;
  }, [property]);

  // Fetch all active contacts for matching
  const fetchContacts = useCallback(async () => {
    if (!accountId) return;
    setLoadingContacts(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, contact_notes(note_text)')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      setContacts(data || []);

      // Refresh AI-extracted matching preferences for contacts whose
      // requirements/notes changed since the last extraction (the server
      // hash-skips unchanged ones), then re-pull so matches use fresh data.
      const stale = (data || [])
        .filter(
          (c) =>
            (c.classification === 'Buyer' || c.classification === 'Agent') &&
            ((c.requirements || '').trim() || (c.contact_notes || []).length > 0) &&
            (!c.pref_extracted_at || c.updated_at > c.pref_extracted_at)
        )
        .slice(0, 25)
        .map((c) => c.id);
      if (stale.length > 0) {
        const res = await fetch('/api/contacts/extract-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactIds: stale }),
        });
        if (res.ok) {
          const { updated } = (await res.json()) as { updated: number };
          if (updated > 0) {
            const { data: refreshed } = await supabase
              .from('contacts')
              .select('*, contact_notes(note_text)')
              .eq('account_id', accountId)
              .eq('status', 'active')
              .order('name');
            if (refreshed) setContacts(refreshed);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load contacts for sharing:', err);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, [supabase, accountId]);

  // Fetch approved Meta WhatsApp message templates
  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .in('status', ['APPROVED', 'Approved'])
        .order('name');
      if (error) throw error;
      const tData = data || [];
      setTemplates(tData);

      // Intelligent auto-selection
      if (tData.length > 0) {
        // 1. Try to find a template specifically meant for sharing property details
        let matching = tData.find((t) =>
          /share_property|property_detail|property_share/i.test(t.name)
        );

        // 2. Fall back to templates containing property/share/detail, excluding reminders or appointment visits
        if (!matching) {
          matching = tData.find((t) => {
            const name = t.name.toLowerCase();
            const hasKeywords = /property|share|detail|send/i.test(name);
            const isReminderOrAppointment = /reminder|visit|appointment|schedule|nudge|followup/i.test(name);
            return hasKeywords && !isReminderOrAppointment;
          });
        }

        setSelectedTemplate(matching || tData[0]);
      }
    } catch (err) {
      console.error('Failed to load templates for share:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [supabase]);

  // Reset dialog states only when open changes from false to true
  useEffect(() => {
    if (open) {
      setBroadcastStep(preSelectedContactId ? 'matches' : 'link');
      setSearchQuery('');
      setCopiedLink(false);
      setSelectedContactIds(preSelectedContactId ? [preSelectedContactId] : []);
      setSelectedTemplate(null);
      setVariableMappings({});
      setCustomVariableValues({});
      setBroadcastResults([]);
      setShowAddFresh(false);
      setFreshName('');
      setFreshPhone('');
      setFreshClassification('Buyer');
      setContacts([]); // Clear contacts so we don't show stale cached list
    }
  }, [open, preSelectedContactId]);

  // Track what was last fetched to prevent duplicate/infinite fetching
  const lastFetchedRef = useRef<{ accountId: string | null; propertyId: string | null }>({
    accountId: null,
    propertyId: null,
  });

  // Fetch contacts and templates when open and accountId is available
  useEffect(() => {
    if (open && accountId && property) {
      const propertyId = property.id;
      if (
        lastFetchedRef.current.accountId !== accountId ||
        lastFetchedRef.current.propertyId !== propertyId
      ) {
        lastFetchedRef.current = { accountId, propertyId };
        setMetaCatalogSyncedAt(property.meta_catalog_synced_at || null);
        setMetaCatalogError(property.meta_catalog_error || null);
        fetchContacts();
        fetchTemplates();

        // Load currency settings from showcase_settings
        supabase
          .from('showcase_settings')
          .select('currency')
          .eq('account_id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.currency) {
              setCurrency(data.currency);
            }
          });
      }
    } else if (!open) {
      // Clear cache when closed
      lastFetchedRef.current = { accountId: null, propertyId: null };
    }
  }, [open, accountId, property, fetchContacts, fetchTemplates, supabase]);

  // Get matching contacts from list
  const matchedContacts = useMemo(() => {
    if (!property || contacts.length === 0) return [];
    // Standard matched target pool
    const targetContacts = contacts.filter((c) => c.classification === 'Buyer' || c.classification === 'Agent');
    return getMatchingContacts(property, targetContacts);
  }, [contacts, property]);

  // Combine search query and matching contacts logic
  const displayedContacts = useMemo(() => {
    if (!searchQuery.trim()) {
      return matchedContacts.filter(({ contact: c }) => {
        if (c.classification === 'Buyer') return true;
        if (c.classification === 'Agent' && showAgentsInMatches) return true;
        return false;
      });
    }

    // Search spans every classification (Owner/Seller/Developer/Others too) —
    // unlike the no-search "matched" view, an explicit name/phone search means
    // the user already knows who they're looking for, so we shouldn't hide
    // them just because the property doesn't match their stored preferences
    // or their classification isn't Buyer/Agent. Only the Agent visibility
    // toggle still applies, to keep behaviour predictable.
    const q = searchQuery.toLowerCase().trim();
    const filtered = contacts.filter((c) => {
      if (c.classification === 'Agent' && !showAgentsInMatches) return false;
      return (
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q))
      );
    });

    return filtered.map((c) => {
      const match = matchedContacts.find((m) => m.contact.id === c.id);
      if (match) return match;
      const unknownDetails: MatchDetails = {
        type: 'unknown',
        location: 'unknown',
        budget: 'unknown',
        bhk: 'unknown',
        roi: 'unknown',
      };
      return {
        contact: c,
        score: 0,
        details: unknownDetails,
        matchedFields: { budget: false, area: false, interest: false },
      };
    });
  }, [searchQuery, contacts, matchedContacts, showAgentsInMatches]);

  // Toggle single selection
  function toggleContactSelection(id: string) {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]
    );
  }

  // Toggle select-all control
  function toggleSelectAllContacts() {
    const allIds = displayedContacts.map((m) => m.contact.id);
    const allSelected = displayedContacts.every((m) => selectedContactIds.includes(m.contact.id));
    if (allSelected) {
      // Remove all displayed matches from selected ids
      setSelectedContactIds((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      // Add missing displayed matches to selected ids
      setSelectedContactIds((prev) => [...new Set([...prev, ...allIds])]);
    }
  }

  // Save fresh contact inline
  async function handleAddFreshContact(e: React.FormEvent) {
    e.preventDefault();
    if (!freshPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!user || !accountId) {
      toast.error('Auth account context missing');
      return;
    }

    setAddingFresh(true);
    try {
      const normalizedPhone = normalizePhoneWithCountryCode(freshPhone.trim());

      const newContactRecord = {
        name: freshName.trim() || null,
        phone: normalizedPhone || freshPhone.trim(),
        classification: freshClassification,
        user_id: user.id,
        account_id: accountId,
        status: 'active' as const,
      };

      const { data, error } = await supabase
        .from('contacts')
        .insert(newContactRecord)
        .select('*')
        .single();

      if (error) throw error;

      if (data) {
        toast.success(`Contact "${data.name || data.phone}" created successfully.`);
        // Append to local state list
        setContacts((prev) => [data, ...prev]);
        // Automatically select the contact
        setSelectedContactIds((prev) => [...prev, data.id]);

        // Reset form
        setFreshName('');
        setFreshPhone('');
        setShowAddFresh(false);
      }
    } catch (err) {
      console.error('Failed to create fresh contact:', err);
      const msg = err instanceof Error ? err.message : 'Unknown database error';
      toast.error(`Failed to create contact: ${msg}`);
    } finally {
      setAddingFresh(false);
    }
  }

  // Parse template body text variables
  const placeholders = useMemo(() => {
    if (!selectedTemplate) return [];
    const matches = selectedTemplate.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [selectedTemplate]);

  // Synchronize broadcast image when template is selected
  useEffect(() => {
    if (property) {
      const defaultImg = property.images?.find((img) => img.trim().length > 0) || '';
      setSelectedBroadcastImage(defaultImg);
    }
  }, [selectedTemplate, property]);

  // Pre-fill variable mappings heuristic based on template content text clues
  useEffect(() => {
    if (selectedTemplate && placeholders.length > 0 && property) {
      const mappings: Record<string, { type: 'field' | 'static'; value: string }> = {};
      const customVals: Record<string, string> = {};
      const lines = selectedTemplate.body_text.split(/\\n|\r?\n/);

      placeholders.forEach((placeholder, idx) => {
        const key = placeholder.replace(/^\{\{|\}\}$/g, '');

        let guessedType: 'field' | 'static' = 'static';
        let guessedValue = 'custom';
        let resolved = false;

        const matchingLine = lines.find((line) => line.includes(placeholder));
        if (matchingLine) {
          const lowerLine = matchingLine.toLowerCase();
          if (lowerLine.includes('hi ') || lowerLine.includes('hello ') || lowerLine.includes('dear ')) {
            guessedType = 'field';
            guessedValue = 'name';
            resolved = true;
          } else if (lowerLine.includes('location') || lowerLine.includes('address') || lowerLine.includes('📍')) {
            guessedType = 'static';
            guessedValue = 'location';
            resolved = true;
          } else if (lowerLine.includes('price') || lowerLine.includes('budget') || lowerLine.includes('💰') || lowerLine.includes('₹') || lowerLine.includes('$')) {
            guessedType = 'static';
            guessedValue = 'price';
            resolved = true;
          } else if (lowerLine.includes('area') || lowerLine.includes('size') || lowerLine.includes('built') || lowerLine.includes('sq') || lowerLine.includes('📐')) {
            guessedType = 'static';
            guessedValue = 'area';
            resolved = true;
          } else if (lowerLine.includes('highlight') || lowerLine.includes('feature') || lowerLine.includes('amenit')) {
            guessedType = 'static';
            guessedValue = 'highlights';
            resolved = true;
          } else if (lowerLine.includes('regards') || lowerLine.includes('thanks') || lowerLine.includes('agent') || lowerLine.includes('sincerely')) {
            guessedType = 'static';
            guessedValue = 'agent';
            resolved = true;
          }
        }

        if (!resolved) {
          const placeholderLineIdx = lines.findIndex((line) => line.includes(placeholder));
          if (placeholderLineIdx > 0) {
            const prevLine = lines[placeholderLineIdx - 1].toLowerCase();
            if (prevLine.includes('highlight') || prevLine.includes('feature') || prevLine.includes('amenit')) {
              guessedType = 'static';
              guessedValue = 'highlights';
              resolved = true;
            } else if (prevLine.includes('regards') || prevLine.includes('thanks') || prevLine.includes('sincerely')) {
              guessedType = 'static';
              guessedValue = 'agent';
              resolved = true;
            }
          }
        }

        if (!resolved) {
          if (idx === 0) {
            guessedType = 'field';
            guessedValue = 'name';
          } else if (idx === 1) {
            guessedType = 'static';
            guessedValue = 'title';
          } else if (idx === 2) {
            guessedType = 'static';
            guessedValue = 'location';
          } else if (idx === 3) {
            guessedType = 'static';
            guessedValue = 'price';
          } else if (idx === 4) {
            guessedType = 'static';
            guessedValue = 'area';
          } else {
            guessedType = 'static';
            guessedValue = 'custom';
            customVals[key] = '';
          }
        }

        mappings[key] = { type: guessedType, value: guessedValue };
        if (guessedType === 'static' && guessedValue === 'custom') {
          customVals[key] = '';
        }
      });
      setVariableMappings(mappings);
      setCustomVariableValues(customVals);
    }
  }, [selectedTemplate, placeholders, property]);

  // Execute broadcast sharing request
  async function handleSendBroadcast() {
    if (!selectedTemplate || selectedContactIds.length === 0 || !property) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) => selectedContactIds.includes(c.id));
      const fullLoc = [
        property.location.trim(),
        (property.sublocality || '').trim(),
        (property.city || '').trim(),
        (property.state || '').trim(),
      ]
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
              if (mapping.value === 'title') val = property.title || '';
              else if (mapping.value === 'price') val = formattedPrice || '';
              else if (mapping.value === 'location') {
                const locVal = property.sublocality || fullLoc || '';
                val = property.google_map_link
                  ? `${locVal}\n🗺️ Google Maps Link: ${property.google_map_link}`
                  : locVal;
              }
              else if (mapping.value === 'area') {
                const isLand = property.type.includes('Land') || property.type.includes('Plot');
                const areaVal = isLand ? property.land_area : property.area_sqft;
                const unitVal = isLand ? property.land_area_unit : property.area_unit;
                val = areaVal ? `${areaVal} ${unitVal}` : '';
              } else if (mapping.value === 'highlights') {
                const parsedHighlights = (property.nearby_highlights || []).filter(Boolean);
                if (parsedHighlights.length > 0) {
                  val = parsedHighlights.map((h) => `• ${h}`).join(' | ');
                } else {
                  const parsedFeatures = (property.features || []).filter(Boolean);
                  val = parsedFeatures.map((f) => `• ${f}`).join(' | ');
                }
              } else if (mapping.value === 'agent') {
                val = profile?.full_name || '';
              } else if (mapping.value === 'custom') {
                val = customVariableValues[key] || '';
              }
            }
          }
          if (!val || !val.trim()) {
            val = '-';
          }
          params.push(val);
        });

        // If the template has an image header, dynamically supply the selected broadcast header image (falling back to first listing image)
        const propertyImage = selectedBroadcastImage || property.images?.map((img) => img.trim()).find((img) => img.length > 0);
        const hasImageHeader = selectedTemplate.header_type === 'image';

        // Auto-resolve dynamic URL buttons if the template uses dynamic buttons
        const buttonParams: Record<number, string> = {};
        if (selectedTemplate.buttons?.length) {
          selectedTemplate.buttons.forEach((btn, idx) => {
            if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
              const code = property?.property_code || property?.id || '';
              if (btn.url.includes('?property_id=')) {
                buttonParams[idx] = code;
              } else {
                buttonParams[idx] = `?property_id=${code}`;
              }
            }
          });
        }

        const messageParams: {
          headerMediaUrl?: string;
          headerText?: string;
          buttonParams?: Record<number, string>;
        } = {};
        if (hasImageHeader && propertyImage) {
          messageParams.headerMediaUrl = propertyImage;
        }

        const hasTextHeaderVar = selectedTemplate.header_type === 'text' &&
          selectedTemplate.header_content &&
          /\{\{\d+\}\}/.test(selectedTemplate.header_content);

        if (hasTextHeaderVar) {
          let headerTextVal = property.project?.trim() || property.title.trim();
          if (headerTextVal.length > 60) {
            headerTextVal = headerTextVal.substring(0, 57) + '...';
          }
          messageParams.headerText = headerTextVal;
        }

        if (Object.keys(buttonParams).length > 0) {
          messageParams.buttonParams = buttonParams;
        }

        return {
          phone: contact.phone,
          params,
          ...(Object.keys(messageParams).length > 0 ? { messageParams } : {}),
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
          (r: { phone: string; status?: 'sent' | 'failed' | null; error?: string | null }) =>
            r.phone === c.phone ||
            r.phone.includes(c.phone) ||
            c.phone.includes(r.phone)
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone,
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      setBroadcastResults(resultsMap);
      setBroadcastStep('results');
      toast.success(`Dispatched WhatsApp messages successfully.`);
      if (onSaved) onSaved();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to send broadcast');
      setBroadcastStep('configure');
    } finally {
      setSendingBroadcast(false);
    }
  }

  // Execute catalog product sharing request
  async function handleSendCatalogBroadcast() {
    if (!catalogId || selectedContactIds.length === 0 || !property) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) => selectedContactIds.includes(c.id));
      const recipientsPayload = selectedContacts.map((contact) => ({
        phone: contact.phone,
      }));

      const bodyText = `🏠 *${property.title}*\n💰 Price: ${formattedPrice}\n📍 Location: ${property.sublocality || property.location}`;

      const response = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: recipientsPayload,
          broadcast_type: 'product',
          product_catalog_id: catalogId,
          product_retailer_id: property.property_code || property.id,
          content_text: bodyText,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Catalog sending failed');
      }

      const resData = await response.json();

      const resultsMap = selectedContacts.map((c) => {
        const matchResult = resData.results?.find(
          (r: { phone: string; status?: 'sent' | 'failed' | null; error?: string | null }) =>
            r.phone === c.phone ||
            r.phone.includes(c.phone) ||
            c.phone.includes(r.phone)
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone,
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      setBroadcastResults(resultsMap);
      setBroadcastStep('results');
      toast.success(`Dispatched WhatsApp catalog product messages successfully.`);
      if (onSaved) onSaved();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to send catalog product messages');
      setBroadcastStep('matches');
    } finally {
      setSendingBroadcast(false);
    }
  }

  // Execute interactive greeting sharing request
  async function handleSendGreetingBroadcast() {
    if (selectedContactIds.length === 0 || !property) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) => selectedContactIds.includes(c.id));
      const recipientsPayload = selectedContacts.map((contact) => ({
        phone: contact.phone,
      }));

      const response = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: recipientsPayload,
          broadcast_type: 'greeting',
          property_id: property.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Greeting broadcast failed');
      }

      const resData = await response.json();

      const resultsMap = selectedContacts.map((c) => {
        const matchResult = resData.results?.find(
          (r: { phone: string; status?: 'sent' | 'failed' | null; error?: string | null }) =>
            r.phone === c.phone ||
            r.phone.includes(c.phone) ||
            c.phone.includes(r.phone)
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone,
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      setBroadcastResults(resultsMap);
      setBroadcastStep('results');
      toast.success(`Dispatched interactive greeting messages successfully.`);
      if (onSaved) onSaved();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to send greeting messages');
      setBroadcastStep('matches');
    } finally {
      setSendingBroadcast(false);
    }
  }

  if (!property) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b border-slate-800 pb-3 mb-2">
          <DialogTitle className="text-white flex items-center gap-2 text-lg font-black tracking-tight">
            <Share2 className="size-5 text-primary" />
            Share Property Details
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            {broadcastStep === 'link'
              ? `Share public showcasing details of "${property.title}" directly.`
              : shareMode === 'greeting'
                ? `Send interactive greeting buttons for "${property.title}" to your contacts.`
                : shareMode === 'catalog'
                  ? `Send interactive catalog product messages for "${property.title}" to your contacts.`
                  : `Send WhatsApp details of "${property.title}" using verified message templates.`
            }
          </DialogDescription>
        </DialogHeader>

        {/* STEP 0: Public Showcase Link (default first step) */}
        {broadcastStep === 'link' && (
          <div className="space-y-4 flex flex-col flex-1 min-h-0">
            <div className="bg-slate-950/20 border border-slate-850 p-4 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  🔗 Share Property Details
                </h3>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    const showcaseUrl = `${window.location.origin}/?property_id=${property.id}`;
                    window.open(showcaseUrl, '_blank');
                  }}
                  className="h-7 border-slate-800 hover:bg-slate-850 text-xs px-2.5 flex items-center gap-1"
                >
                  <ExternalLink className="size-3" />
                  Preview Page
                </Button>
              </div>
              
              <p className="text-xs text-slate-400">
                Share this property with a personalized message. The link includes full details, photos, and maps.
              </p>

              {/* Message Style Selector */}
              <div className="space-y-2">
                <Label className="text-slate-300 text-[11px] font-semibold">Message Style</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 'professional', label: 'Professional', icon: '💼' },
                    { value: 'casual', label: 'Casual', icon: '👋' },
                    { value: 'friendly', label: 'Friendly', icon: '😊' },
                    { value: 'custom', label: 'Custom', icon: '✏️' },
                  ].map((style) => (
                    <button
                      key={style.value}
                      type="button"
                      onClick={() => setMessageStyle(style.value as typeof messageStyle)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[10px] font-medium transition-all ${
                        messageStyle === style.value
                          ? 'bg-primary/10 border-primary/50 text-primary'
                          : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-sm">{style.icon}</span>
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Preview / Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300 text-[11px] font-semibold">
                    {messageStyle === 'custom' ? 'Your Message' : 'Message Preview'}
                  </Label>
                  <div className="flex items-center gap-2">
                    {messageStyle === 'custom' && customMessage && (
                      <button
                        type="button"
                        onClick={() => setCustomMessage('')}
                        className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"
                      >
                        <X className="size-3" />
                        Clear
                      </button>
                    )}
                    <span className="text-[10px] text-slate-500">
                      {messageStyle === 'custom' ? 'Edit your message' : 'Auto-generated with property details'}
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <textarea
                    readOnly={messageStyle !== 'custom'}
                    value={messageStyle === 'custom' ? customMessage : generateShareMessage()}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder="Type your custom message here..."
                    rows={6}
                    className={`w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 ${
                      messageStyle === 'custom' ? 'cursor-text pr-8' : 'cursor-default'
                    }`}
                  />
                  {messageStyle === 'custom' && customMessage && (
                    <button
                      type="button"
                      onClick={() => setCustomMessage('')}
                      className="absolute right-2 top-2 p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Public Showcase Link */}
              <div className="space-y-2">
                <Label className="text-slate-300 text-[11px] font-semibold">Property Link</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={showcaseUrl}
                    className="bg-slate-800/50 border-slate-700 text-xs h-9 text-slate-300 select-all font-mono"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={async () => {
                    const message = messageStyle === 'custom' ? customMessage : generateShareMessage();
                    await navigator.clipboard.writeText(message);
                    setCopiedMessage(true);
                    toast.success('Message + Link copied! Paste it in WhatsApp or any app.');
                    setTimeout(() => setCopiedMessage(false), 2000);
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  {copiedMessage ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiedMessage ? 'Copied!' : 'Copy Message + Link'}
                </Button>
                <Button
                  onClick={async () => {
                    if (typeof navigator !== 'undefined' && navigator.share) {
                      try {
                        const message = messageStyle === 'custom' ? customMessage : generateShareMessage();
                        // Don't include url separately - it's already in the message
                        await navigator.share({
                          title: property.title || 'Property Details',
                          text: message,
                        });
                        toast.success('Shared successfully!');
                      } catch (err) {
                        if ((err as Error).name !== 'AbortError') {
                          toast.error('Failed to share');
                        }
                      }
                    } else {
                      // Fallback: copy to clipboard
                      const message = messageStyle === 'custom' ? customMessage : generateShareMessage();
                      await navigator.clipboard.writeText(message);
                      toast.success('Copied! Your browser does not support native sharing.');
                    }
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  <Share2 className="size-3.5" />
                  Share
                </Button>
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(showcaseUrl);
                    setCopiedLink(true);
                    toast.success('Link copied to clipboard!');
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  {copiedLink ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiedLink ? 'Copied!' : 'Copy Link Only'}
                </Button>
                <Button
                  onClick={() => {
                    window.open(showcaseUrl, '_blank');
                  }}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  <ExternalLink className="size-3.5" />
                  View Page
                </Button>
              </div>

              {!property.is_published && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-[11px] text-amber-400 flex items-start gap-2">
                  <span className="text-xs">⚠️</span>
                  <div>
                    <span className="font-bold block">Listing is Private / Unpublished</span>
                    To allow public visitors to view this showcase page, make sure the property is set to <strong>Published</strong> on the inventory page.
                  </div>
                </div>
              )}
            </div>

            {/* ── Co-Broker / Agent Share ── */}
            <div className="bg-slate-900/50 border border-blue-500/20 p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                🤝 Share with Complete Details
              </h3>
              <p className="text-xs text-slate-400">
                Share full property details with other agents so they can present it to their clients independently.
                Share a clean property detail page with full specs, photos, and location map — no inquiry forms or buttons.
              </p>

              {/* Agent message preview */}
              <textarea
                readOnly
                value={generateAgentMessage()}
                rows={5}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-xs text-slate-200 resize-none cursor-default"
              />

              {/* Agent link */}
              <div className="flex gap-2">
                <input
                  readOnly
                  value={agentShowcaseUrl}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800/50 px-3 h-9 text-xs text-slate-300 font-mono select-all"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={async () => {
                    const msg = generateAgentMessage();
                    await navigator.clipboard.writeText(msg);
                    setCopiedAgent(true);
                    toast.success('Agent message + link copied!');
                    setTimeout(() => setCopiedAgent(false), 2000);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  {copiedAgent ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiedAgent ? 'Copied!' : 'Copy Message + Link'}
                </Button>
                <Button
                  onClick={async () => {
                    const shareData: ShareData = {
                      title: property.title || 'Property Details',
                      text: generateAgentMessage(),
                    };

                    // Try to attach the property thumbnail image if available
                    const imageUrl = property.images?.find((img) => img.trim().length > 0);
                    if (imageUrl && typeof navigator !== 'undefined' && 'canShare' in navigator) {
                      try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        const sanitizedTitle = (property.title || 'property')
                          .replace(/[^a-zA-Z0-9\s_-]/g, '')
                          .trim()
                          .replace(/\s+/g, '_')
                          .slice(0, 50);
                        const file = new File([blob], `${sanitizedTitle || 'property'}.jpg`, { type: blob.type || 'image/jpeg' });
                        if (navigator.canShare({ files: [file] })) {
                          shareData.files = [file];
                        }
                      } catch {
                        // Image fetch failed — continue with text-only share
                      }
                    }

                    if (typeof navigator !== 'undefined' && navigator.share) {
                      try {
                        await navigator.share(shareData);
                      } catch (err) {
                        if ((err as Error).name !== 'AbortError') {
                          // If sharing with files failed, fall back to text-only share
                          if (shareData.files) {
                            try {
                              await navigator.share({
                                title: shareData.title,
                                text: shareData.text,
                              });
                            } catch (fallbackErr) {
                              if ((fallbackErr as Error).name !== 'AbortError') {
                                toast.error('Failed to share');
                              }
                            }
                          } else {
                            toast.error('Failed to share');
                          }
                        }
                      }
                    } else {
                      await navigator.clipboard.writeText(generateAgentMessage());
                      toast.success('Copied to clipboard!');
                    }
                  }}
                  className="bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  <Share2 className="size-3.5" />
                  Share
                </Button>
                <Button
                  onClick={() => window.open(agentShowcaseUrl, '_blank')}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                >
                  <ExternalLink className="size-3.5" />
                  Preview
                </Button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                👋 Send Interactive Greeting First
              </h3>
              <p className="text-xs text-slate-400">
                Sends a welcome greeting with quick reply buttons first. If the contact clicks <strong className="text-primary font-semibold">&quot;Sure, please send&quot;</strong>, the CRM will automatically share the full property details.
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setShareMode('greeting');
                    setBroadcastStep('matches');
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 flex items-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="size-3.5" />
                  Select Contacts & Send Greeting
                </Button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                💬 Share via WhatsApp Templates
              </h3>
              <p className="text-xs text-slate-400">
                Want to send structured, approved WhatsApp messages to matching leads and contacts? Proceed to our WhatsApp template sharing flow.
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setShareMode('template');
                    setBroadcastStep('matches');
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="size-3.5" />
                  Select Contacts & Share on WhatsApp
                </Button>
              </div>
            </div>

            {catalogId && (
              <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    🛍️ Share as WhatsApp Product Card
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]">
                      {metaCatalogSyncedAt && !metaCatalogError ? (
                        indexingTimeLeft > 0 ? (
                          <span className="text-amber-400 font-medium">● Indexing in Progress</span>
                        ) : (
                          <span className="text-emerald-400 font-medium">● Synced to Catalog</span>
                        )
                      ) : metaCatalogError ? (
                        <span className="text-red-400 font-medium" title={metaCatalogError}>● Sync Failed</span>
                      ) : (
                        <span className="text-amber-400 font-medium">● Not Synced</span>
                      )}
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={async () => {
                        if (syncingCatalog) return;
                        setSyncingCatalog(true);
                        try {
                          const res = await fetch(`/api/properties/${property.id}/sync-catalog`, {
                            method: 'POST',
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            throw new Error(data.error || 'Failed to sync to catalog');
                          }
                          toast.success('Successfully synced property details to Meta Catalog.');
                          setMetaCatalogSyncedAt(data.synced_at || new Date().toISOString());
                          setMetaCatalogError(null);
                          if (onSaved) onSaved();
                        } catch (err: unknown) {
                          const msg = (err instanceof Error ? err.message : 'Sync failed');
                          toast.error(msg);
                          setMetaCatalogError(msg);
                          setMetaCatalogSyncedAt(null);
                        } finally {
                          setSyncingCatalog(false);
                        }
                      }}
                      disabled={syncingCatalog}
                      className="h-7 border-slate-800 hover:bg-slate-850 text-xs px-2.5"
                    >
                      {syncingCatalog ? (
                        <>
                          <Loader2 className="size-3 animate-spin mr-1" />
                          Syncing
                        </>
                      ) : (
                        'Sync Now'
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  Send this property as an interactive catalog product card directly inside WhatsApp chat. This provides a direct shopping experience with inline image, details, and price.
                </p>

                {indexingTimeLeft > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 text-[11px] text-amber-400 flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-amber-400 shrink-0" />
                    <div>
                      Meta Catalog is indexing the product. Ready to share in <strong className="font-mono">{indexingTimeLeft}s</strong>.
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      setShareMode('catalog');
                      setBroadcastStep('matches');
                    }}
                    disabled={!metaCatalogSyncedAt || !!metaCatalogError || indexingTimeLeft > 0}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Smartphone className="size-3.5" />
                    {indexingTimeLeft > 0 ? `Indexing (${indexingTimeLeft}s)` : 'Select Contacts & Send Product Card'}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-800 pt-3.5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-slate-800 hover:bg-slate-850 text-xs text-slate-300 h-9"
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1: Audience & Matches */}
        {broadcastStep === 'matches' && (
          <div className="space-y-4 flex flex-col flex-1 min-h-0 animate-fade-in">
            {/* Search Input */}
            <div className="relative">
              <Input
                placeholder="Search contacts by name or phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border-slate-800 text-xs h-9 placeholder:text-slate-500 pl-9 pr-8 text-slate-200"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Action Bar / Matching Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/20 border border-slate-850 p-3.5 rounded-xl">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <span>
                    {searchQuery.trim() ? (
                      `Found ${displayedContacts.length} search result${displayedContacts.length === 1 ? '' : 's'}`
                    ) : displayedContacts.length === 0 ? (
                      '0 matching contacts found'
                    ) : (
                      `Found ${displayedContacts.length} matching contact${displayedContacts.length === 1 ? '' : 's'}`
                    )}
                  </span>
                  {loadingContacts && (
                    <span className="text-slate-500 font-normal flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      updating...
                    </span>
                  )}
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-450 cursor-pointer select-none bg-slate-900 border border-slate-800 px-2 py-0.5 rounded hover:text-white transition-all">
                  <input
                    type="checkbox"
                    checked={showAgentsInMatches}
                    onChange={(e) => {
                      setShowAgentsInMatches(e.target.checked);
                      if (!e.target.checked) {
                        // Deselect any selected agents to keep select state consistent
                        const agentIds = matchedContacts
                          .filter(({ contact: c }) => c.classification === 'Agent')
                          .map(({ contact: c }) => c.id);
                        setSelectedContactIds((prev) => prev.filter((id) => !agentIds.includes(id)));
                      }
                    }}
                    className="rounded border-slate-700 bg-slate-850 text-primary focus:ring-0 focus:ring-offset-0 h-3 w-3 cursor-pointer"
                  />
                  Show Agents
                </label>
              </div>

              <div className="flex items-center gap-3">
                {displayedContacts.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAllContacts}
                    className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer"
                  >
                    {displayedContacts.every((m) => selectedContactIds.includes(m.contact.id)) ? (
                      <>
                        <CheckSquare className="size-3.5" /> Deselect All
                      </>
                    ) : (
                      <>
                        <Square className="size-3.5" /> Select All ({displayedContacts.length})
                      </>
                    )}
                  </button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setShowAddFresh(!showAddFresh)}
                  className="h-7 border-slate-800 hover:bg-slate-850 text-slate-300 text-xs px-2.5 rounded flex items-center gap-1"
                >
                  {showAddFresh ? <X className="size-3" /> : <UserPlus className="size-3 text-primary" />}
                  {showAddFresh ? 'Cancel' : 'Add Fresh Contact'}
                </Button>
              </div>
            </div>

            {/* Collapsible Add Fresh Contact Form */}
            {showAddFresh && (
              <form
                onSubmit={handleAddFreshContact}
                className="bg-slate-950/30 border border-slate-800/80 p-4 rounded-xl space-y-3 animation-fade-in"
              >
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1">
                  <UserPlus className="size-3.5 text-primary" /> Add New Contact Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fresh-name" className="text-slate-400 text-[11px] font-semibold">
                      Full Name
                    </Label>
                    <Input
                      id="fresh-name"
                      placeholder="e.g. John Doe"
                      value={freshName}
                      onChange={(e) => setFreshName(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-650 h-8.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fresh-phone" className="text-slate-400 text-[11px] font-semibold">
                      Phone Number *
                    </Label>
                    <Input
                      id="fresh-phone"
                      placeholder="e.g. 9876543210"
                      value={freshPhone}
                      onChange={(e) => setFreshPhone(e.target.value)}
                      required
                      className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-650 h-8.5 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fresh-classification" className="text-slate-400 text-[11px] font-semibold">
                      Classification
                    </Label>
                    <select
                      id="fresh-classification"
                      value={freshClassification}
                      onChange={(e) => setFreshClassification(e.target.value as 'Buyer' | 'Agent')}
                      className="flex h-8.5 w-full rounded-md border border-slate-800 bg-slate-900 px-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
                    >
                      <option value="Buyer">Buyer (Lead)</option>
                      <option value="Agent">Agent (Collaborator)</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    type="submit"
                    disabled={addingFresh}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold text-xs h-8 px-4"
                  >
                    {addingFresh ? (
                      <>
                        <Loader2 className="size-3 animate-spin mr-1.5" /> Saving...
                      </>
                    ) : (
                      <>
                        <Plus className="size-3 mr-1" /> Save & Select Contact
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}

            {/* Matching Contacts List */}
            <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
              {loadingContacts && contacts.length === 0 && !searchQuery.trim() ? (
                <div className="flex justify-center items-center py-16 text-slate-500 text-sm">
                  <Loader2 className="size-6 animate-spin text-primary mr-2" />
                  Scanning database & applying matching logic...
                </div>
              ) : displayedContacts.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
                  <Users className="size-8 mx-auto text-slate-600 mb-2" />
                  {searchQuery.trim() ? (
                    <>
                      <p className="text-sm text-slate-400 font-semibold">
                        No contacts match &ldquo;{searchQuery.trim()}&rdquo;
                      </p>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        Try a different name or phone number{!showAgentsInMatches ? ', enable "Show Agents" above,' : ''} or add a fresh contact inline to share.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-slate-400 font-semibold">No matching profiles found</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        This inventory listing doesn&apos;t align with any client&apos;s budget or location preferences. Search by name or phone to find a specific contact, or add a fresh contact inline to share.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                displayedContacts.map(({ contact: c, score, details }) => {
                  const isSelected = selectedContactIds.includes(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleContactSelection(c.id)}
                      className={`flex items-start gap-3.5 p-3 rounded-xl border cursor-pointer transition-all ${isSelected
                          ? 'bg-primary/5 border-primary/45 ring-1 ring-primary/10'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-750'
                        }`}
                    >
                      <button
                        type="button"
                        className={`shrink-0 mt-0.5 ${isSelected ? 'text-primary' : 'text-slate-650'}`}
                      >
                        {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <h4 className="text-xs font-bold text-white truncate">{c.name || 'Unnamed'}</h4>
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.2 text-[9px] font-bold shrink-0 ${c.classification === 'Buyer'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                                }`}
                            >
                              {c.classification}
                            </span>
                          </div>
                          <Badge
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0 ${score >= 70
                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                : score >= 30
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                          >
                            {score}% Match
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">{c.phone}</p>

                        {score > 0 && <MatchDetailChips details={details} />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Actions */}
            <div className="border-t border-slate-800 pt-3.5 flex justify-between items-center mt-auto gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBroadcastStep('link')}
                className="border-slate-800 hover:bg-slate-850 text-xs text-slate-300 h-9 flex items-center gap-1 shrink-0"
              >
                <ArrowLeft className="size-3.5" /> Back
              </Button>

              <div className="flex items-center gap-2">
                {shareMode === 'greeting' ? (
                  <Button
                    type="button"
                    disabled={selectedContactIds.length === 0 || sendingBroadcast}
                    onClick={handleSendGreetingBroadcast}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 flex items-center gap-1.5"
                  >
                    {sendingBroadcast ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin mr-1" /> Sending...
                      </>
                    ) : (
                      <>
                        <Send className="size-3.5" />
                        Send Greeting Message ({selectedContactIds.length})
                      </>
                    )}
                  </Button>
                ) : shareMode === 'catalog' ? (
                  <Button
                    type="button"
                    disabled={selectedContactIds.length === 0 || sendingBroadcast || indexingTimeLeft > 0}
                    onClick={handleSendCatalogBroadcast}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 flex items-center gap-1.5"
                  >
                    {sendingBroadcast ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin mr-1" /> Sending...
                      </>
                    ) : (
                      <>
                        <Send className="size-3.5" />
                        {indexingTimeLeft > 0
                          ? `Indexing (${indexingTimeLeft}s)`
                          : `Send Product Card (${selectedContactIds.length})`}
                      </>
                    )}
                  </Button>
                ) : (
                  <>
                    {selectedTemplate && (
                      <span className="hidden md:inline text-[11px] text-slate-400 italic max-w-[200px] truncate mr-1.5" title={`Template: ${selectedTemplate.name}`}>
                        Template: {selectedTemplate.name}
                      </span>
                    )}

                    <Button
                      type="button"
                      disabled={selectedContactIds.length === 0 || !selectedTemplate}
                      variant="outline"
                      onClick={() => setBroadcastStep('configure')}
                      className="border-slate-805 hover:bg-slate-800 text-slate-300 text-xs h-9 flex items-center gap-1"
                    >
                      Configure & Review
                    </Button>

                    <Button
                      type="button"
                      disabled={selectedContactIds.length === 0 || !selectedTemplate || sendingBroadcast}
                      onClick={handleSendBroadcast}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 flex items-center gap-1.5"
                    >
                      {sendingBroadcast ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin mr-1" /> Sending...
                        </>
                      ) : (
                        <>
                          <Send className="size-3.5" />
                          Send Directly ({selectedContactIds.length})
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Configure Broadcast Message */}
        {broadcastStep === 'configure' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5 mb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBroadcastStep('matches')}
                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <div className="text-sm font-semibold text-white">Configure Broadcast Parameters</div>
            </div>

            {/* Template select */}
            <div className="space-y-1.5">
              <Label htmlFor="broadcast-template" className="text-slate-300 text-xs">
                WhatsApp Message Template
              </Label>
              {loadingTemplates ? (
                <div className="flex items-center text-xs text-slate-500 gap-1.5 py-1">
                  <Loader2 className="size-3.5 animate-spin text-primary" /> Loading template structures...
                </div>
              ) : (
                <select
                  id="broadcast-template"
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => {
                    const t = templates.find((tpl) => tpl.id === e.target.value);
                    setSelectedTemplate(t || null);
                  }}
                  className="flex h-9.5 w-full rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary font-medium"
                >
                  <option value="">Select template type...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language || 'en_US'})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Header image selector */}
            {selectedTemplate?.header_type === 'image' && (
              <div className="space-y-1.5 border border-slate-800 p-3 rounded-xl bg-slate-950/20">
                <Label className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider block mb-1">
                  Select Broadcast Header Image
                </Label>
                <div className="flex gap-2 items-center overflow-x-auto py-1 max-w-full">
                  {property.images
                    ?.filter((img) => img.trim().length > 0)
                    .map((imgUrl, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedBroadcastImage(imgUrl)}
                        className={`relative size-14 rounded-lg overflow-hidden border-2 cursor-pointer shrink-0 transition-all ${selectedBroadcastImage === imgUrl
                            ? 'border-primary ring-2 ring-primary/20 scale-95'
                            : 'border-slate-800 hover:border-slate-700'
                          }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          key={imgUrl}
                          src={imgUrl}
                          alt={`Option ${idx + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        {idx === 0 && (
                          <span className="absolute bottom-0 inset-x-0 bg-slate-900/80 text-[7px] text-amber-400 font-bold text-center py-0.2">
                            Default
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {selectedTemplate && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-slate-800 p-4 rounded-xl bg-slate-950/15">
                {/* Variable Mappings */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Dynamic Variable Parameters
                  </h5>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {placeholders.map((placeholder) => {
                      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                      const mapping = variableMappings[key] || { type: 'static', value: 'custom' };
                      return (
                        <div
                          key={key}
                          className="space-y-1.5 border border-slate-800/40 p-2.5 rounded-lg bg-slate-900/40"
                        >
                          <Label className="text-[10px] text-slate-300 font-bold flex items-center justify-between">
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
                                <option value="static-area">Property Area / Size</option>
                                <option value="static-highlights">Highlights / Amenities</option>
                                <option value="static-agent">Agent Name</option>
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
                              placeholder="Enter text..."
                              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-650 h-8 text-xs mt-1"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Smartphone Preview Box */}
                <div className="space-y-2 flex flex-col h-full">
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Smartphone className="size-3.5 text-primary" /> Live Template Preview
                  </h5>

                  <div className="flex-1 bg-slate-950 border border-slate-850 p-4 rounded-xl text-xs flex flex-col font-sans relative min-h-[220px] justify-between">
                    <div className="whitespace-pre-wrap text-slate-350 leading-relaxed">
                      {(() => {
                        let body = selectedTemplate.body_text.replace(/\\n/g, '\n');
                        placeholders.forEach((placeholder) => {
                          const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                          const mapping = variableMappings[key];
                          let val = placeholder;
                          if (mapping) {
                            if (mapping.type === 'field') {
                              if (mapping.value === 'name') val = `[Recipient Name]`;
                              else if (mapping.value === 'phone') val = `[Recipient Phone]`;
                              else if (mapping.value === 'email') val = `[Recipient Email]`;
                              else if (mapping.value === 'company') val = `[Recipient Company]`;
                            } else {
                              if (mapping.value === 'title') val = property.title || `[Title]`;
                              else if (mapping.value === 'price') val = formattedPrice || `[Price]`;
                              else if (mapping.value === 'location') {
                                const locVal = property.sublocality || property.location || `[Location]`;
                                val = property.google_map_link
                                  ? `${locVal}\n🗺️ Google Maps Link: ${property.google_map_link}`
                                  : locVal;
                              }
                              else if (mapping.value === 'area') {
                                const isLand = property.type.includes('Land') || property.type.includes('Plot');
                                const areaVal = isLand ? property.land_area : property.area_sqft;
                                const unitVal = isLand ? property.land_area_unit : property.area_unit;
                                val = areaVal ? `${areaVal} ${unitVal}` : `[Area]`;
                              } else if (mapping.value === 'highlights') {
                                const parsedHighlights = (property.nearby_highlights || []).filter(Boolean);
                                if (parsedHighlights.length > 0) {
                                  val = parsedHighlights.map((h) => `• ${h}`).join(' | ');
                                } else {
                                  const parsedFeatures = (property.features || []).filter(Boolean);
                                  val = parsedFeatures.length > 0 ? parsedFeatures.map((f) => `• ${f}`).join(' | ') : `[Highlights]`;
                                }
                              } else if (mapping.value === 'agent') {
                                val = profile?.full_name || `[Agent Name]`;
                              } else if (mapping.value === 'custom') {
                                val = customVariableValues[key] || `[Custom]`;
                              }
                            }
                          }
                          body = body.replace(placeholder, val);
                        });
                        return body;
                      })()}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-4 border-t border-slate-800/80 pt-2 flex items-center justify-between">
                      <span>Live view placeholders.</span>
                      <span className="font-semibold">{selectedTemplate.language || 'en_US'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Configure controls */}
            <div className="border-t border-slate-800 pt-3.5 flex justify-between items-center mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBroadcastStep('matches')}
                className="border-slate-800 hover:bg-slate-850 text-xs h-9"
              >
                Back to List
              </Button>
              <Button
                type="button"
                disabled={sendingBroadcast || !selectedTemplate}
                onClick={handleSendBroadcast}
                className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold text-xs h-9 flex items-center gap-1.5"
              >
                {sendingBroadcast ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1" /> Sending...
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" />
                    Share Property ({selectedContactIds.length})
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Sending State */}
        {broadcastStep === 'sending' && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Loader2 className="size-10 animate-spin text-primary" />
            <div className="text-center">
              <h4 className="text-sm font-semibold text-white">Sending WhatsApp Broadcast</h4>
              <p className="text-xs text-slate-500 mt-1">
                Dispatching template packets to {selectedContactIds.length} recipients. Do not exit the modal.
              </p>
            </div>
          </div>
        )}

        {/* STEP 4: Results Log View */}
        {broadcastStep === 'results' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-2">
              <h4 className="text-sm font-semibold text-white">Broadcast Transmission Log</h4>
              <Badge className="bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 text-xs font-semibold">
                Completed
              </Badge>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {broadcastResults.map((res, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 rounded-lg bg-slate-900 border border-slate-800/80"
                >
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
                        {res.error && <span className="text-[9px] text-red-450 mt-0.5">{res.error}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-850 pt-3.5 flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setBroadcastStep('matches');
                  setSelectedContactIds([]);
                  onOpenChange(false);
                }}
                className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold text-xs h-9 px-5"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
