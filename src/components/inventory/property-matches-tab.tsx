'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { storagePublicUrl } from '@/lib/storage/url';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, MessageTemplate, Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { PropertyRadarLoader } from '@/components/ui/property-radar-loader';
import {
  Loader2,
  Users,
  Send,
  CheckSquare,
  CheckCheck,
  Square,
  ArrowLeft,
  Smartphone,
  Search,
  X,
  Check,
  Clock,
  Eye,
} from 'lucide-react';
import {
  inMatchAudience,
  type MatchAudience,
  type MatchingResult,
} from '@/lib/matching';
import {
  fetchPropertyShareLog,
  recordPropertyShares,
} from '@/lib/inventory/share-log';
import {
  pickShareDialogTemplate,
  shareUnsentReason,
} from '@/lib/whatsapp/property-share-template';
import type { SharePropertyPreview } from '@/lib/whatsapp/share-property-preview';
import { postPropertyShare } from '@/lib/whatsapp/share-property-request';
import {
  buildPropertyShareMessage,
  showcaseOriginForHost,
} from '@/lib/share-message-builder';
import { MatchDetailChips } from '@/components/inventory/match-detail-chips';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { formatCurrency } from '@/lib/currency-utils';

interface PropertyMatchesTabProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
  onSaved: () => void;
  setActiveTab: (tab: string) => void;
  contacts: Contact[];
  loadingContacts: boolean;
  matchedContacts: MatchingResult[];
  displayedMatches: MatchingResult[];
  matchAudience: MatchAudience;
  setMatchAudience: (audience: MatchAudience) => void;
  currency: string;
  showcaseSubdomain: string | null;
  title: string;
  price: string;
  address: string;
  sublocality: string;
  city: string;
  stateVal: string;
  isLand: boolean;
  landArea: string;
  landAreaUnit: string;
  areaSqft: string;
  areaUnit: string;
  googleMapLink: string;
  nearbyHighlights: string[];
  features: string[];
  images: string[];
}

export function PropertyMatchesTab({
  open,
  onOpenChange,
  property,
  onSaved,
  setActiveTab,
  contacts,
  loadingContacts,
  matchedContacts,
  displayedMatches,
  matchAudience,
  setMatchAudience,
  currency,
  showcaseSubdomain,
  title,
  price,
  address,
  sublocality,
  city,
  stateVal,
  isLand,
  landArea,
  landAreaUnit,
  areaSqft,
  areaUnit,
  googleMapLink,
  nearbyHighlights,
  features,
  images,
}: PropertyMatchesTabProps) {
  const supabase = createClient();
  const { user, accountId, profile } = useAuth();
  const isEdit = !!property;

  const [sharedAtByContact, setSharedAtByContact] = useState<
    Record<string, string>
  >({});
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [matchSearch, setMatchSearch] = useState('');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<MessageTemplate | null>(null);

  // Broadcast steps: 'matches' | 'configure' | 'sending' | 'results'
  const [broadcastStep, setBroadcastStep] = useState<
    'matches' | 'configure' | 'sending' | 'results'
  >('matches');
  const [variableMappings, setVariableMappings] = useState<
    Record<string, { type: 'field' | 'static'; value: string }>
  >({});
  const [customVariableValues, setCustomVariableValues] = useState<
    Record<string, string>
  >({});
  const [broadcastResults, setBroadcastResults] = useState<
    Array<{
      name: string;
      phone: string;
      status: 'sent' | 'failed';
      error?: string;
    }>
  >([]);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [selectedBroadcastImage, setSelectedBroadcastImage] =
    useState<string>('');
  const [customTemplateMode, setCustomTemplateMode] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .in('status', ['APPROVED', 'Approved'])
        .order('name');
      if (error) throw error;
      const rows = (data || []) as MessageTemplate[];
      setTemplates(rows);
      const hasPhoto = Boolean(
        property?.images?.some((img) => img && img.trim().length > 0)
      );
      setSelectedTemplate(
        pickShareDialogTemplate(rows, { hasImage: hasPhoto })
      );
      setCustomTemplateMode(false);
    } catch (err) {
      console.error('Failed to load templates for broadcast:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [supabase, property?.images]);

  // The share ledger for this listing, so the Matching Contacts list can
  // mark recipients the communication has already gone out to.
  const fetchShareLog = useCallback(async () => {
    if (!property?.id || !accountId) {
      setSharedAtByContact({});
      return;
    }
    setSharedAtByContact(await fetchPropertyShareLog(accountId, property.id));
  }, [accountId, property?.id]);

  useEffect(() => {
    if (open) {
      fetchTemplates();
      fetchShareLog();
      // Reset broadcast wizard
      setBroadcastStep('matches');
      setCustomTemplateMode(false);
      setSelectedContactIds([]);
      setSelectedTemplate(null);
      setVariableMappings({});
      setCustomVariableValues({});
      setBroadcastResults([]);
    }
  }, [open, fetchTemplates, fetchShareLog, property, accountId]);

  const formattedPrice = useMemo(() => {
    const amount = Number(price);
    if (isNaN(amount) || amount <= 0) return '';
    return formatCurrency(amount, currency);
  }, [price, currency]);

  const filteredDisplayedMatches = useMemo(() => {
    const query = matchSearch.trim().toLocaleLowerCase();
    if (!query) return displayedMatches;
    return displayedMatches.filter(({ contact }) =>
      [
        contact.name,
        contact.phone,
        contact.classification,
        contact.name_tag,
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    );
  }, [displayedMatches, matchSearch]);

  const buyerMatchCount = matchedContacts.filter(
    ({ contact }) => contact.classification !== 'Agent'
  ).length;
  const agentMatchCount = matchedContacts.length - buyerMatchCount;

  // Switching audience drops selections outside it, so "Select All"
  // then send never carries hidden picks from the previous tab.
  const handleAudienceChange = (audience: MatchAudience) => {
    setMatchAudience(audience);
    if (audience === 'all') return;
    setSelectedContactIds((prev) =>
      prev.filter((id) => {
        const c = contacts.find((x) => x.id === id);
        return !c || inMatchAudience(c.classification, audience);
      })
    );
  };

  const sharedMatchCount = useMemo(
    () =>
      displayedMatches.filter(({ contact: c }) => sharedAtByContact[c.id])
        .length,
    [displayedMatches, sharedAtByContact]
  );

  const placeholders = useMemo(() => {
    if (!selectedTemplate) return [];
    const matches = selectedTemplate.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [selectedTemplate]);

  useEffect(() => {
    if (selectedTemplate && placeholders.length > 0) {
      const mappings: Record<
        string,
        { type: 'field' | 'static'; value: string }
      > = {};
      const customVals: Record<string, string> = {};
      const lines = selectedTemplate.body_text.split(/\\n|\r?\n/);

      placeholders.forEach((placeholder, idx) => {
        const key = placeholder.replace(/^\{\{|\}\}$/g, '');

        let guessedType: 'field' | 'static' = 'static';
        let guessedValue = 'custom';
        let resolved = false;

        // Scan the line containing the placeholder for text context clues
        const matchingLine = lines.find((line) => line.includes(placeholder));
        if (matchingLine) {
          const lowerLine = matchingLine.toLowerCase();
          if (
            lowerLine.includes('hi ') ||
            lowerLine.includes('hello ') ||
            lowerLine.includes('dear ')
          ) {
            guessedType = 'field';
            guessedValue = 'name';
            resolved = true;
          } else if (
            lowerLine.includes('map') ||
            lowerLine.includes('google') ||
            lowerLine.includes('gps') ||
            lowerLine.includes('navigation') ||
            lowerLine.includes('direction')
          ) {
            guessedType = 'static';
            guessedValue = 'map';
            resolved = true;
          } else if (
            lowerLine.includes('location') ||
            lowerLine.includes('address') ||
            lowerLine.includes('📍')
          ) {
            guessedType = 'static';
            guessedValue = 'location';
            resolved = true;
          } else if (
            lowerLine.includes('price') ||
            lowerLine.includes('budget') ||
            lowerLine.includes('💰') ||
            lowerLine.includes('₹') ||
            lowerLine.includes('$')
          ) {
            guessedType = 'static';
            guessedValue = 'price';
            resolved = true;
          } else if (
            lowerLine.includes('area') ||
            lowerLine.includes('size') ||
            lowerLine.includes('built') ||
            lowerLine.includes('sq') ||
            lowerLine.includes('📐')
          ) {
            guessedType = 'static';
            guessedValue = 'area';
            resolved = true;
          } else if (
            lowerLine.includes('highlight') ||
            lowerLine.includes('feature') ||
            lowerLine.includes('amenit')
          ) {
            guessedType = 'static';
            guessedValue = 'highlights';
            resolved = true;
          } else if (
            lowerLine.includes('regards') ||
            lowerLine.includes('thanks') ||
            lowerLine.includes('agent') ||
            lowerLine.includes('sincerely')
          ) {
            guessedType = 'static';
            guessedValue = 'agent';
            resolved = true;
          }
        }

        // If the placeholder is on a line by itself, check the line before
        if (!resolved) {
          const placeholderLineIdx = lines.findIndex((line) =>
            line.includes(placeholder)
          );
          if (placeholderLineIdx > 0) {
            const prevLine = lines[placeholderLineIdx - 1].toLowerCase();
            if (
              prevLine.includes('highlight') ||
              prevLine.includes('feature') ||
              prevLine.includes('amenit')
            ) {
              guessedType = 'static';
              guessedValue = 'highlights';
              resolved = true;
            } else if (
              prevLine.includes('regards') ||
              prevLine.includes('thanks') ||
              prevLine.includes('sincerely')
            ) {
              guessedType = 'static';
              guessedValue = 'agent';
              resolved = true;
            }
          }
        }

        // Position-based fallbacks if no heuristic matches
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
  }, [selectedTemplate, placeholders]);

  const engineShare = Boolean(property && !customTemplateMode);

  const firstSelectedContactId =
    contacts.find((c) => selectedContactIds.includes(c.id))?.id ?? null;
  const enginePreviewQuery = useQuery({
    queryKey: [
      'share-property-preview',
      property?.id ?? null,
      firstSelectedContactId,
    ],
    queryFn: async () => {
      const query = new URLSearchParams({ property_id: property!.id });
      if (firstSelectedContactId)
        query.set('contact_id', firstSelectedContactId);
      const res = await fetch(
        `/api/whatsapp/share-property/preview?${query.toString()}`
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          payload?.error || 'Could not load the listing template'
        );
      return payload.data as SharePropertyPreview;
    },
    enabled: Boolean(open && property && broadcastStep === 'configure'),
    staleTime: 60_000,
  });
  const enginePreview = enginePreviewQuery.data ?? null;

  const headerImageOptions = useMemo(() => {
    const source = engineShare ? (property?.images ?? []) : images;
    return source
      .map((img) => (img ?? '').trim())
      .filter((img) => img.length > 0);
  }, [engineShare, property?.images, images]);

  const showHeaderImagePicker = engineShare
    ? headerImageOptions.length > 0
    : selectedTemplate?.header_type === 'image';

  useEffect(() => {
    setSelectedBroadcastImage(
      showHeaderImagePicker ? headerImageOptions[0] || '' : ''
    );
  }, [showHeaderImagePicker, headerImageOptions]);

  const unsavedShareEdits = useMemo(() => {
    if (!property) return false;
    const savedPrice =
      property.price !== null && property.price !== undefined
        ? String(property.price)
        : '';
    const savedImages = (property.images ?? [])
      .map((img) => (img ?? '').trim())
      .filter(Boolean);
    const formImages = images.map((img) => img.trim()).filter(Boolean);
    return (
      title.trim() !== (property.title ?? '').trim() ||
      price.trim() !== savedPrice ||
      sublocality.trim() !== (property.sublocality ?? '').trim() ||
      city.trim() !== (property.city ?? '').trim() ||
      formImages.join('|') !== savedImages.join('|')
    );
  }, [property, title, price, sublocality, city, images]);

  async function handleSendEngineShare() {
    if (!property || selectedContactIds.length === 0) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');
    const selectedContacts = contacts.filter((c) =>
      selectedContactIds.includes(c.id)
    );
    const origin =
      typeof window !== 'undefined'
        ? showcaseOriginForHost(
            window.location.host,
            window.location.protocol,
            showcaseSubdomain
          )
        : '';
    const results: typeof broadcastResults = [];
    let delivered = 0;
    for (const contact of selectedContacts) {
      const audience = contact.classification === 'Agent' ? 'agent' : 'client';
      const url =
        audience === 'agent'
          ? `${origin}/?property_id=${property.id}&mode=view`
          : `${origin}/?property_id=${property.id}`;
      const message = buildPropertyShareMessage({
        property,
        url,
        audience,
        detail: 'standard',
        tone: 'professional',
        currency,
        agentName: profile?.full_name || undefined,
        agentPhone: profile?.phone || undefined,
      });
      const entry = {
        name: contact.name || 'Unknown',
        phone: contact.phone ?? '',
      };
      try {
        const { ok, data, error } = await postPropertyShare({
          contact_id: contact.id,
          property_id: property.id,
          message,
          ...(selectedBroadcastImage
            ? { header_image: selectedBroadcastImage }
            : {}),
        });
        if (!ok) throw new Error(error || 'Send failed');
        if (data?.sent) {
          delivered += 1;
          results.push({ ...entry, status: 'sent' });
        } else {
          results.push({
            ...entry,
            status: 'failed',
            error: shareUnsentReason(data?.template_status),
          });
        }
      } catch (err) {
        results.push({
          ...entry,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Send failed',
        });
      }
    }
    if (delivered > 0) void fetchShareLog();
    setBroadcastResults(results);
    setBroadcastStep('results');
    setSendingBroadcast(false);
  }

  async function handleSendBroadcast() {
    if (!selectedTemplate || selectedContactIds.length === 0) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) =>
        selectedContactIds.includes(c.id)
      );
      const fullLoc = [
        address.trim(),
        sublocality.trim(),
        city.trim(),
        stateVal.trim(),
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
              else if (mapping.value === 'phone') val = contact.phone ?? '';
              else if (mapping.value === 'email') val = contact.email || '';
              else if (mapping.value === 'company') val = contact.company || '';
            } else {
              if (mapping.value === 'title') val = title || '';
              else if (mapping.value === 'price') val = formattedPrice || '';
              else if (mapping.value === 'location')
                val = sublocality || fullLoc || '';
              else if (mapping.value === 'area') {
                const areaVal = isLand ? landArea : areaSqft;
                const unitVal = isLand ? landAreaUnit : areaUnit;
                val = areaVal ? `${areaVal} ${unitVal}` : '';
              } else if (mapping.value === 'map') {
                val = googleMapLink || '';
              } else if (mapping.value === 'highlights') {
                const parsedHighlights = nearbyHighlights.filter(Boolean);
                if (parsedHighlights.length > 0) {
                  val = parsedHighlights.map((h) => `• ${h}`).join(' | ');
                } else {
                  const parsedFeatures = features.filter(Boolean);
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
        const propertyImage =
          selectedBroadcastImage ||
          images.map((img) => img.trim()).find((img) => img.length > 0);
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
          buttonParams?: Record<number, string>;
        } = {};
        if (hasImageHeader && propertyImage) {
          messageParams.headerMediaUrl = storagePublicUrl(propertyImage);
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

      const delivered: Contact[] = [];
      const resultsMap = selectedContacts.map((c) => {
        const matchResult = resData.results?.find(
          (r: {
            phone: string;
            status?: 'sent' | 'failed' | null;
            error?: string | null;
          }) =>
            c.phone !== null &&
            (r.phone === c.phone ||
              r.phone.includes(c.phone) ||
              c.phone.includes(r.phone))
        );
        const status = matchResult?.status || 'failed';
        if (status === 'sent') delivered.push(c);
        return {
          name: c.name || 'Unknown',
          phone: c.phone ?? '',
          status,
          error:
            matchResult?.error ||
            (status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      // Ledger the confirmed sends so this listing's Matching Contacts
      // list marks them as already communicated with, here and on
      // mobile. Fire-and-forget: it must not delay the results screen.
      if (accountId && property?.id && delivered.length > 0) {
        void recordPropertyShares({
          accountId,
          propertyId: property.id,
          userId: user?.id,
          recipients: delivered.map((c) => ({
            contactId: c.id,
            classification: c.classification,
          })),
        }).then(() => fetchShareLog());
      }

      setBroadcastResults(resultsMap);
      setBroadcastStep('results');
      toast.success(
        `Broadcast finished: ${resData.sent} sent, ${resData.failed} failed.`
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to send broadcast');
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
    const displayedIds = filteredDisplayedMatches.map((m) => m.contact.id);
    const allSelected = displayedIds.every((id) =>
      selectedContactIds.includes(id)
    );
    if (allSelected) {
      setSelectedContactIds((prev) =>
        prev.filter((id) => !displayedIds.includes(id))
      );
    } else {
      setSelectedContactIds((prev) => {
        const union = new Set([...prev, ...displayedIds]);
        return Array.from(union);
      });
    }
  }

  return (
    <>
      {/* MATCHING CONTACTS TAB */}
      <TabsContent
        value="matches"
        className="m-0 flex min-h-0 flex-1 flex-col px-6 py-4 focus:outline-none"
      >
        {!isEdit ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/35 py-12 text-center">
            <Users className="mx-auto mb-2 size-8 text-slate-600" />
            <p className="text-sm font-semibold text-slate-400">
              Please save this property listing first to view matching contacts.
            </p>
          </div>
        ) : (
          <>
            {/* STEP 1: Matches list */}
            {broadcastStep === 'matches' && (
              <div className="flex min-h-0 flex-1 flex-col space-y-4">
                {/* Only the true first load (no contacts fetched yet) blocks the
                          view — a background refetch must never hide an
                          already-rendered list behind a spinner again. */}
                <div className="border-primary/25 bg-primary/5 space-y-3 rounded-xl border p-3.5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                        <Users className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {loadingContacts && contacts.length === 0
                            ? 'Finding the best contacts…'
                            : `${displayedMatches.length} ${matchAudience === 'agents' ? 'agent' : matchAudience === 'buyers' ? 'buyer' : 'contact'}${displayedMatches.length === 1 ? '' : 's'} ranked`}
                        </div>
                        <div className="text-xs font-medium text-slate-400">
                          {loadingContacts && contacts.length === 0
                            ? 'Searching matching profiles...'
                            : displayedMatches.length === 0
                              ? '0 matching contacts found'
                              : `${sharedMatchCount} already shared · Select contacts to share together`}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSelectAllContacts}
                      disabled={filteredDisplayedMatches.length === 0}
                      className="text-primary hover:text-primary/80 flex cursor-pointer items-center gap-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {filteredDisplayedMatches.length > 0 &&
                      filteredDisplayedMatches.every((m) =>
                        selectedContactIds.includes(m.contact.id)
                      ) ? (
                        <>
                          <CheckSquare className="size-3.5" /> Deselect shown
                        </>
                      ) : (
                        <>
                          <Square className="size-3.5" /> Select shown (
                          {filteredDisplayedMatches.length})
                        </>
                      )}
                    </button>
                  </div>

                  {contacts.length > 0 && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="inline-flex items-center self-start rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                        {(
                          [
                            {
                              key: 'buyers',
                              label: `Buyers ${buyerMatchCount}`,
                            },
                            {
                              key: 'agents',
                              label: `Agents ${agentMatchCount}`,
                            },
                            {
                              key: 'all',
                              label: `All ${matchedContacts.length}`,
                            },
                          ] as const
                        ).map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleAudienceChange(key)}
                            className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-all ${
                              matchAudience === key
                                ? 'bg-primary/15 text-primary font-bold'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {(displayedMatches.length > 5 || matchSearch) && (
                        <div className="relative flex-1">
                          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
                          <Input
                            value={matchSearch}
                            onChange={(event) =>
                              setMatchSearch(event.target.value)
                            }
                            placeholder="Search name or phone"
                            aria-label="Search matching contacts"
                            className="h-8 rounded-lg border-slate-700 bg-slate-900 pr-8 pl-8 text-xs"
                          />
                          {matchSearch && (
                            <button
                              type="button"
                              onClick={() => setMatchSearch('')}
                              aria-label="Clear contact search"
                              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500 hover:text-white"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="min-h-[30vh] flex-1 space-y-3 overflow-y-auto pr-1">
                  {loadingContacts && contacts.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-slate-500">
                      <Loader2 className="text-primary mr-2 size-6 animate-spin" />
                      Scanning database...
                    </div>
                  ) : filteredDisplayedMatches.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-12 text-center">
                      <Search className="mx-auto mb-2 size-8 text-slate-600" />
                      <p className="text-sm font-medium text-slate-400">
                        {matchSearch
                          ? 'No contacts match this search'
                          : 'No matching contacts found'}
                      </p>
                      <p className="text-slate-550 mt-1 text-xs">
                        {matchSearch
                          ? 'Try a different name or phone number.'
                          : 'Adjust preferences or add budget tags to contacts.'}
                      </p>
                    </div>
                  ) : (
                    filteredDisplayedMatches.map(
                      ({ contact: c, score, details }) => {
                        const isSelected = selectedContactIds.includes(c.id);
                        // Already shared: the row recedes and says
                        // so, so an agent working down the list sees
                        // who still needs the message. Selecting it
                        // again stays possible — this is a reminder,
                        // not a lockout.
                        const sharedAt = sharedAtByContact[c.id];
                        const displayName =
                          c.name || c.phone || 'Unnamed contact';
                        const initials = displayName
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')
                          .toLocaleUpperCase();
                        return (
                          <div
                            key={c.id}
                            onClick={() => toggleContactSelection(c.id)}
                            className={`cursor-pointer rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-primary/5 border-primary/45 ring-primary/10 ring-1'
                                : sharedAt
                                  ? 'border-slate-850 hover:border-slate-750 bg-slate-900/40 opacity-60 hover:opacity-100'
                                  : 'hover:border-slate-750 border-slate-800 bg-slate-900'
                            }`}
                          >
                            <div className="flex items-start gap-3 p-3.5">
                              <button
                                type="button"
                                aria-label={`${isSelected ? 'Deselect' : 'Select'} ${displayName}`}
                                className={`group flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-extrabold transition-colors ${
                                  isSelected
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-primary/10 text-primary border-primary/25 hover:border-emerald-500 hover:bg-emerald-500 hover:text-white'
                                }`}
                              >
                                {isSelected ? (
                                  <Check className="size-4" />
                                ) : (
                                  <>
                                    <span className="group-hover:hidden">
                                      {initials}
                                    </span>
                                    <Check className="hidden size-4 group-hover:block" />
                                  </>
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <h4 className="truncate text-sm font-bold text-white">
                                      {displayName}
                                    </h4>
                                    <NameTagBadge tag={c.name_tag} />
                                    <span
                                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                        c.classification === 'Buyer'
                                          ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                                          : 'border border-sky-500/20 bg-sky-500/10 text-sky-400'
                                      }`}
                                    >
                                      {c.classification}
                                    </span>
                                  </div>
                                  <Badge
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                      score >= 70
                                        ? 'border border-green-500/20 bg-green-500/10 text-green-400'
                                        : score >= 30
                                          ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                                          : 'bg-slate-850 text-slate-400'
                                    }`}
                                  >
                                    {score}% match
                                  </Badge>
                                </div>
                                <p className="text-slate-450 mt-0.5 font-mono text-xs">
                                  {c.phone}
                                </p>

                                {sharedAt && (
                                  <div className="mt-1.5 inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-emerald-400 uppercase">
                                    <CheckCheck className="size-3" />
                                    Shared ·{' '}
                                    {new Date(sharedAt).toLocaleDateString(
                                      undefined,
                                      {
                                        day: 'numeric',
                                        month: 'short',
                                      }
                                    )}
                                  </div>
                                )}

                                <MatchDetailChips details={details} />
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3.5 py-2">
                              <a
                                href={`/contacts?contactId=${encodeURIComponent(c.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
                              >
                                <Eye className="size-3.5" />
                                View contact
                              </a>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedContactIds([c.id]);
                                  setBroadcastStep('configure');
                                }}
                                className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                              >
                                {sharedAt ? (
                                  <Clock className="size-3.5" />
                                ) : (
                                  <Send className="size-3.5" />
                                )}
                                {sharedAt ? 'Share again' : 'Share property'}
                              </button>
                            </div>
                          </div>
                        );
                      }
                    )
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-slate-800 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="hover:bg-slate-850 border-slate-800"
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    disabled={selectedContactIds.length === 0 || !isEdit}
                    onClick={() => setBroadcastStep('configure')}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-1.5 font-semibold"
                  >
                    <Send className="size-3.5" />
                    Share the Property Details ({selectedContactIds.length})
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Configure Template Parameter Mappings */}
            {broadcastStep === 'configure' && (
              <div className="space-y-4">
                <div className="mb-2 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBroadcastStep('matches')}
                    className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <div className="text-sm font-semibold text-white">
                    Share the property details
                  </div>
                </div>

                {loadingTemplates ? (
                  <div className="flex items-center gap-1.5 py-1 text-xs text-slate-500">
                    <Loader2 className="text-primary size-3.5 animate-spin" />{' '}
                    Loading templates...
                  </div>
                ) : engineShare ? (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {enginePreview?.template?.label ?? 'Listing details'}
                        </div>
                        {enginePreviewQuery.isPending ? (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                            <Loader2 className="size-3 animate-spin" /> Checking
                            the listing template...
                          </p>
                        ) : enginePreviewQuery.isError ? (
                          <p className="mt-1 text-xs text-amber-400">
                            {enginePreviewQuery.error instanceof Error
                              ? enginePreviewQuery.error.message
                              : 'Could not load the listing template'}
                          </p>
                        ) : enginePreview && !enginePreview.template ? (
                          <p className="mt-1 text-xs text-amber-400">
                            Contacts who messaged you in the last 24 hours get
                            the full message with the photo.{' '}
                            {enginePreview.unsent_reason}, so everyone else will
                            be listed as not sent.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-400">
                            Contacts who messaged you in the last 24 hours get
                            the full message with the photo. Everyone else can
                            only receive an approved WhatsApp template, so this
                            one goes out with their name, the listing, the price
                            and the map filled in.
                          </p>
                        )}
                      </div>
                      {templates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setCustomTemplateMode(true)}
                          className="text-primary shrink-0 text-xs font-semibold hover:underline"
                        >
                          Use a different template
                        </button>
                      )}
                    </div>
                    {unsavedShareEdits && (
                      <p className="text-xs text-amber-400">
                        Shares go out with the saved listing. Save your edits
                        first to include them.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="broadcast-template"
                        className="text-slate-300"
                      >
                        WhatsApp Template
                      </Label>
                      <button
                        type="button"
                        onClick={() => setCustomTemplateMode(false)}
                        className="text-primary text-xs font-semibold hover:underline"
                      >
                        Back to the listing template
                      </button>
                    </div>
                    {
                      <select
                        id="broadcast-template"
                        value={selectedTemplate?.id || ''}
                        onChange={(e) => {
                          const t = templates.find(
                            (tpl) => tpl.id === e.target.value
                          );
                          setSelectedTemplate(t || null);
                        }}
                        className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:ring-2 focus:outline-none"
                      >
                        <option value="">Select Template...</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.language || 'en_US'})
                          </option>
                        ))}
                      </select>
                    }
                  </div>
                )}

                {/* Image Header Selector */}
                {showHeaderImagePicker && (
                  <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/20 p-3">
                    <Label className="text-slate-350 mb-1 block text-xs font-semibold">
                      Select Broadcast Header Image
                    </Label>
                    <div className="flex max-w-full items-center gap-2 overflow-x-auto py-1">
                      {headerImageOptions.map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSelectedBroadcastImage(imgUrl)}
                          className={`relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition-all ${
                            selectedBroadcastImage === imgUrl
                              ? 'border-primary ring-primary/20 scale-95 ring-2'
                              : 'border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            key={imgUrl}
                            src={storagePublicUrl(imgUrl)}
                            alt={`Option ${idx + 1}`}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          {idx === 0 && (
                            <span className="absolute inset-x-0 bottom-0 bg-slate-900/80 py-0.5 text-center text-[8px] font-bold text-amber-400">
                              Default
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {engineShare &&
                  enginePreview?.template &&
                  enginePreview.preview && (
                    <div className="space-y-2">
                      <h5 className="flex items-center gap-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
                        <Smartphone className="size-3.5" /> Message Preview
                      </h5>
                      <div className="border-slate-850 rounded-xl border bg-slate-950 p-4 font-sans text-xs">
                        <div className="leading-relaxed whitespace-pre-wrap text-slate-300">
                          {enginePreview.preview}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-500">
                          <span>
                            Each recipient is greeted by their own first name.
                          </span>
                          <span className="font-semibold">
                            {enginePreview.template.language}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                {!engineShare && selectedTemplate && (
                  <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-800 bg-slate-950/15 p-4 md:grid-cols-2">
                    {/* Parameter mappings */}
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                        Message Placeholders
                      </h5>
                      {placeholders.map((placeholder) => {
                        const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                        const mapping = variableMappings[key] || {
                          type: 'static',
                          value: 'custom',
                        };
                        return (
                          <div
                            key={key}
                            className="space-y-1.5 rounded-lg border border-slate-800/40 bg-slate-900/40 p-2.5"
                          >
                            <Label className="text-slate-350 flex items-center justify-between text-xs font-semibold">
                              <span>Variable {placeholder}</span>
                            </Label>
                            <div className="flex gap-2">
                              <select
                                value={
                                  mapping.type === 'field'
                                    ? mapping.value
                                    : `static-${mapping.value}`
                                }
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setVariableMappings((prev) => {
                                    const copy = { ...prev };
                                    if (val.startsWith('static-')) {
                                      copy[key] = {
                                        type: 'static',
                                        value: val.replace('static-', ''),
                                      };
                                    } else {
                                      copy[key] = {
                                        type: 'field',
                                        value: val,
                                      };
                                    }
                                    return copy;
                                  });
                                }}
                                className="h-8 flex-1 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-white"
                              >
                                <optgroup label="Contact Fields">
                                  <option value="name">Contact Name</option>
                                  <option value="phone">Contact Phone</option>
                                  <option value="email">Contact Email</option>
                                  <option value="company">
                                    Contact Company
                                  </option>
                                </optgroup>
                                <optgroup label="Property Fields">
                                  <option value="static-title">
                                    Property Title
                                  </option>
                                  <option value="static-price">
                                    Price (Formatted)
                                  </option>
                                  <option value="static-location">
                                    Location / Area
                                  </option>
                                  <option value="static-area">
                                    Property Area / Size
                                  </option>
                                  <option value="static-map">
                                    Google Map Link
                                  </option>
                                  <option value="static-highlights">
                                    Nearby Highlights / Amenities
                                  </option>
                                  <option value="static-agent">
                                    Agent Name
                                  </option>
                                </optgroup>
                                <optgroup label="Custom Static Value">
                                  <option value="static-custom">
                                    Custom Text...
                                  </option>
                                </optgroup>
                              </select>
                            </div>
                            {mapping.type === 'static' &&
                              mapping.value === 'custom' && (
                                <Input
                                  value={customVariableValues[key] || ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setCustomVariableValues((prev) => ({
                                      ...prev,
                                      [key]: v,
                                    }));
                                  }}
                                  placeholder="Type custom text..."
                                  className="mt-1.5 h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                                />
                              )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Live Message Preview */}
                    <div className="flex h-full flex-col space-y-2">
                      <h5 className="flex items-center gap-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
                        <Smartphone className="size-3.5" /> Message Preview
                      </h5>

                      <div className="border-slate-850 relative flex min-h-[160px] flex-1 flex-col justify-between rounded-xl border bg-slate-950 p-4 font-sans text-xs">
                        <div className="leading-relaxed whitespace-pre-wrap text-slate-300">
                          {(() => {
                            let body = selectedTemplate.body_text.replace(
                              /\\n/g,
                              '\n'
                            );
                            placeholders.forEach((placeholder) => {
                              const key = placeholder.replace(
                                /^\{\{|\}\}$/g,
                                ''
                              );
                              const mapping = variableMappings[key];
                              let val = placeholder;
                              if (mapping) {
                                if (mapping.type === 'field') {
                                  if (mapping.value === 'name')
                                    val = `[Contact Name]`;
                                  else if (mapping.value === 'phone')
                                    val = `[Contact Phone]`;
                                  else if (mapping.value === 'email')
                                    val = `[Contact Email]`;
                                  else if (mapping.value === 'company')
                                    val = `[Contact Company]`;
                                } else {
                                  const fullLoc = [
                                    address.trim(),
                                    sublocality.trim(),
                                    city.trim(),
                                    stateVal.trim(),
                                  ]
                                    .filter(Boolean)
                                    .join(', ');
                                  if (mapping.value === 'title')
                                    val = title || `[Property Title]`;
                                  else if (mapping.value === 'price')
                                    val = formattedPrice || `[Formatted Price]`;
                                  else if (mapping.value === 'location')
                                    val =
                                      sublocality || fullLoc || `[Location]`;
                                  else if (mapping.value === 'area') {
                                    const areaVal = isLand
                                      ? landArea
                                      : areaSqft;
                                    const unitVal = isLand
                                      ? landAreaUnit
                                      : areaUnit;
                                    val = areaVal
                                      ? `${areaVal} ${unitVal}`
                                      : `[Property Area]`;
                                  } else if (mapping.value === 'map') {
                                    val = googleMapLink || `[Google Map Link]`;
                                  } else if (mapping.value === 'highlights') {
                                    const parsedHighlights =
                                      nearbyHighlights.filter(Boolean);
                                    if (parsedHighlights.length > 0) {
                                      val = parsedHighlights
                                        .map((h) => `• ${h}`)
                                        .join(' | ');
                                    } else {
                                      const parsedFeatures =
                                        features.filter(Boolean);
                                      val =
                                        parsedFeatures.length > 0
                                          ? parsedFeatures
                                              .map((f) => `• ${f}`)
                                              .join(' | ')
                                          : `[Highlights / Features]`;
                                    }
                                  } else if (mapping.value === 'agent') {
                                    val = profile?.full_name || `[Agent Name]`;
                                  } else if (mapping.value === 'custom') {
                                    val =
                                      customVariableValues[key] ||
                                      `[Custom Text]`;
                                  }
                                }
                              }
                              body = body.replace(placeholder, val);
                            });
                            return body;
                          })()}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px] text-slate-500">
                          <span>
                            Recipient will see dynamic contact details.
                          </span>
                          <span className="font-semibold">
                            {selectedTemplate.language || 'en_US'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setBroadcastStep('matches')}
                    className="hover:bg-slate-850 border-slate-800"
                  >
                    Back to List
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      sendingBroadcast ||
                      (engineShare
                        ? !enginePreview || unsavedShareEdits
                        : !selectedTemplate)
                    }
                    onClick={
                      engineShare ? handleSendEngineShare : handleSendBroadcast
                    }
                    className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 font-semibold"
                  >
                    {sendingBroadcast ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Sending...
                      </>
                    ) : (
                      <>
                        <Send className="size-3.5" />
                        Share the Property Details ({selectedContactIds.length})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Sending Status */}
            {broadcastStep === 'sending' && (
              <div className="flex flex-col items-center justify-center space-y-4 py-16">
                <PropertyRadarLoader
                  size={80}
                  label="Sending WhatsApp broadcast"
                />
                <div className="text-center">
                  <h4 className="text-sm font-semibold text-white">
                    Sending WhatsApp Broadcast
                  </h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Dispatching messages to {selectedContactIds.length}{' '}
                    recipients. Please do not close this modal.
                  </p>
                </div>
              </div>
            )}

            {/* STEP 4: Sending Results */}
            {broadcastStep === 'results' && (
              <div className="space-y-4">
                <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-3">
                  <h4 className="text-sm font-semibold text-white">
                    Broadcast Complete
                  </h4>
                  <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-xs font-semibold text-emerald-400">
                    Dispatched Results
                  </Badge>
                </div>

                <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                  {broadcastResults.map((res, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900 p-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">
                          {res.name}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          {res.phone}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {res.status === 'sent' ? (
                          <Badge className="border border-green-500/20 bg-green-500/10 text-[10px] font-bold text-green-400">
                            Success
                          </Badge>
                        ) : (
                          <div className="flex flex-col items-end">
                            <Badge className="border border-red-500/20 bg-red-500/10 text-[10px] font-bold text-red-400">
                              Failed
                            </Badge>
                            {res.error && (
                              <span className="mt-0.5 text-[9px] text-red-400/80">
                                {res.error}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-slate-850 flex justify-end border-t pt-4">
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
    </>
  );
}
