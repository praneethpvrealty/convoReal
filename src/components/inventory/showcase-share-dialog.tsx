'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Share2,
  Copy,
  Check,
  ExternalLink,
  Search,
  Smartphone,
  X,
  User,
  Handshake,
  Send,
  Loader2,
  Sparkles,
  ListChecks,
  Layers,
  Filter,
} from 'lucide-react';
import type { MessageTemplate, Property, ShowcaseSettings } from '@/types';
import type {
  ShareCategory,
  ShareScope,
} from '@/lib/inventory/showcase-share-link';
import {
  buildInventorySummary,
  categoryForType,
} from '@/lib/inventory-summary-builder';
import { filterPropertiesBySearch } from '@/lib/inventory/search-filter';
import { buildShowcaseShareLink } from '@/lib/inventory/showcase-share-link';
import { formatShareAmount } from '@/lib/share-message-builder';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import {
  buildInventoryUpdateTemplatePayload,
  INVENTORY_UPDATE_TEMPLATE_NAME,
} from '@/lib/whatsapp/inventory-update-template';

interface PickerContact {
  id: string;
  name: string | null;
  phone: string | null;
  name_tag?: string | null;
}

interface PersonalizedShareSummary {
  summary: string;
  template_params: [string, string, string];
  match_count: number;
}

interface ShareSummaryResponse {
  data: {
    summary: string;
    count: number;
    template_params: [string, string, string];
    personalized: Record<string, PersonalizedShareSummary>;
  };
}

interface ShowcaseShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  showcaseSettings: ShowcaseSettings | null;
  activeSearch?: string;
}

const MAX_PICKED = 25;

function getBaseHost() {
  if (typeof window === 'undefined') return '';
  const host = window.location.host;
  const parts = host.split('.');

  if (
    parts.length <= 2 ||
    host.includes('localhost') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    return host;
  }

  return parts.slice(1).join('.');
}

function stepLabel(index: number, title: string) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-primary/20 text-primary flex size-5 items-center justify-center rounded-full text-[10px] font-black">
        {index}
      </span>
      <span className="text-slate-350 text-xs font-bold tracking-wider uppercase">
        {title}
      </span>
    </div>
  );
}

export function ShowcaseShareDialog({
  open,
  onOpenChange,
  accountId,
  showcaseSettings,
  activeSearch,
}: ShowcaseShareDialogProps) {
  const trimmedSearch = activeSearch?.trim() || '';

  // Step 1 — WHO. Clients get the teaser showcase (masked address,
  // inquiry funnel); co-brokers get the complete clean view.
  const [audience, setAudience] = useState<'client' | 'agent'>('client');

  // Step 2 — WHAT. One scope at a time, so the link, the message and the
  // Engine snapshot can never describe different sets of listings.
  const [scope, setScope] = useState<ShareScope>(
    trimmedSearch ? 'search' : 'all'
  );
  const [shareCategory, setShareCategory] = useState<ShareCategory>('All');
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');

  // Step 3 — HOW.
  const [messageMode, setMessageMode] = useState<'pitch' | 'list'>('pitch');
  const [copied, setCopied] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setScope(trimmedSearch ? 'search' : 'all');
  }, [open, trimmedSearch]);

  const defaultClientMessage = `Hi {name}! 👋

I've curated an exclusive property showcase just for you. Browse through handpicked listings and find the one that feels right.

Explore the full showcase here:
{portalUrl}

If any property catches your eye, I'd be happy to help with details, schedule a site visit, or negotiate the best deal on your behalf. Let's find your perfect property together!

Best regards`;

  const defaultBrokerMessage = `Hi {name}! 🤝

Sharing our current inventory — the link opens the complete catalog with full specs, photos, and map locations, so you can evaluate and present to your clients directly:

{portalUrl}

Open to co-broking on all of these. Ping me for commission terms, documents, or site visits.

Best regards`;

  // One editable draft per audience so switching tabs doesn't clobber edits.
  const [clientMessage, setClientMessage] = useState(defaultClientMessage);
  const [brokerMessage, setBrokerMessage] = useState(defaultBrokerMessage);
  const pitchMessage = audience === 'agent' ? brokerMessage : clientMessage;
  const setPitchMessage =
    audience === 'agent' ? setBrokerMessage : setClientMessage;

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoadingContacts(true);
      const db = createClient();
      void db
        .from('contacts')
        .select('id, name, phone, name_tag')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .order('name')
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            console.error('[showcase-share] contacts load failed:', error);
            toast.error('Failed to load contacts');
          } else {
            setContacts((data ?? []) as PickerContact[]);
          }
          setLoadingContacts(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  // Published + Available listings: the same set the public showcase
  // shows, and the pool both the picker and the digest draw from.
  const [properties, setProperties] = useState<Property[] | null>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const db = createClient();
      void db
        .from('properties')
        .select(
          'id, title, type, listing_type, price, rent_per_month, rental_income, roi, area_sqft, area_unit, land_area, land_area_unit, bedrooms, location, sublocality, city, project, property_code, listing_source'
        )
        .eq('account_id', accountId)
        .eq('is_published', true)
        .eq('status', 'Available')
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            console.error('[showcase-share] listings load failed:', error);
            setProperties([]);
          } else {
            setProperties((data ?? []) as unknown as Property[]);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const pickerResults = useMemo(() => {
    if (!properties) return [];
    return filterPropertiesBySearch(properties, pickerSearch);
  }, [properties, pickerSearch]);

  /** Exactly what the receiver will see, for every scope. */
  const scopeProperties = useMemo(() => {
    if (!properties) return null;
    if (scope === 'search')
      return filterPropertiesBySearch(properties, trimmedSearch);
    if (scope === 'pick') {
      const byId = new Map(properties.map((p) => [p.id, p]));
      return picked
        .map((id) => byId.get(id))
        .filter((p): p is Property => Boolean(p));
    }
    return properties;
  }, [properties, scope, trimmedSearch, picked]);

  const generatedLink = useMemo(() => {
    if (typeof window === 'undefined') return '';

    const subdomain = showcaseSettings?.subdomain;
    const targetDomain = subdomain
      ? `${subdomain}.${getBaseHost()}`
      : window.location.host;

    return buildShowcaseShareLink({
      baseUrl: `${window.location.protocol}//${targetDomain}`,
      accountId,
      includeRef: !subdomain,
      scope,
      category: shareCategory,
      search: trimmedSearch,
      ids: (scopeProperties ?? []).map((p) => p.property_code || p.id),
      audience,
    });
  }, [
    accountId,
    showcaseSettings,
    scope,
    trimmedSearch,
    scopeProperties,
    shareCategory,
    audience,
  ]);

  const autoSummary = useMemo(() => {
    if (!scopeProperties) return '';
    return buildInventorySummary(scopeProperties, {
      portalUrl: generatedLink,
      category: scope === 'all' ? shareCategory : 'All',
    });
  }, [scopeProperties, generatedLink, scope, shareCategory]);

  // Manual edits survive until an input changes the auto text: the draft
  // remembers which auto text it was based on, and a mismatch silently
  // discards it — no reset effect required.
  const [summaryDraft, setSummaryDraft] = useState<{
    base: string;
    text: string;
  } | null>(null);
  const summaryMessage =
    summaryDraft?.base === autoSummary ? summaryDraft.text : autoSummary;
  const hasCustomSummary = summaryDraft?.base === autoSummary;

  const scopeCount =
    scope === 'all' && shareCategory !== 'All'
      ? (scopeProperties ?? []).filter(
          (property) => categoryForType(property.type) === shareCategory
        ).length
      : (scopeProperties?.length ?? 0);
  const scopeSummaryLabel =
    scope === 'search'
      ? `${scopeCount} matching “${trimmedSearch}”`
      : scope === 'pick'
        ? `${scopeCount} hand-picked`
        : shareCategory === 'All'
          ? `${scopeCount} published listings`
          : `${scopeCount} ${shareCategory} listings`;

  // ── Engine template ─────────────────────────────────────────────
  // The inventory_update template lets the digest go out from the
  // account's own WhatsApp Business number — replies land in the
  // ConvoReal Inbox instead of the agent's personal WhatsApp.
  const [engineTemplate, setEngineTemplate] = useState<MessageTemplate | null>(
    null
  );
  const [engineTemplateChecked, setEngineTemplateChecked] = useState(false);
  const [submittingEngineTemplate, setSubmittingEngineTemplate] =
    useState(false);
  const [sendingEngine, setSendingEngine] = useState(false);
  const [engineSentContactIds, setEngineSentContactIds] = useState<Set<string>>(
    new Set()
  );

  const fetchEngineTemplate = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', INVENTORY_UPDATE_TEMPLATE_NAME)
      .order('last_submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    setEngineTemplate((data as MessageTemplate | null) || null);
    setEngineTemplateChecked(true);
  }, [accountId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void fetchEngineTemplate();
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchEngineTemplate]);

  const engineTemplateApproved = engineTemplate?.status === 'APPROVED';

  const handleSubmitEngineTemplate = async () => {
    setSubmittingEngineTemplate(true);
    try {
      const payload = buildInventoryUpdateTemplatePayload(
        window.location.origin
      );
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      toast.success(
        'Template submitted to Meta — sending unlocks once it is approved (usually within minutes to a few hours).'
      );
      await fetchEngineTemplate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Template submission failed'
      );
      console.error('[showcase-share] template submit failed:', err);
    } finally {
      setSubmittingEngineTemplate(false);
    }
  };

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
    );
  }, [contacts, contactSearch]);

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedContactIds.includes(c.id)),
    [contacts, selectedContactIds]
  );
  const sendableContacts = selectedContacts.filter((c) => c.phone);

  function toggleContact(id: string) {
    setSelectedContactIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  function togglePicked(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_PICKED) {
        toast.error(
          `Choose no more than ${MAX_PICKED} properties for one link`
        );
        return current;
      }
      return [...current, id];
    });
  }

  /** Same portal link, tagged with the contact so Pulse events carry
   *  their identity (`v=` is read by the showcase tracker, never used
   *  to filter the catalog). */
  const personalizedLink = (contactId: string) => {
    if (!generatedLink) return '';
    const url = new URL(generatedLink);
    url.searchParams.set('v', contactId);
    return url.toString();
  };

  const fetchShareSummaries = async (contactIds: string[]) => {
    const query = new URLSearchParams({
      scope,
      category: shareCategory,
      search: trimmedSearch,
      ids: (scopeProperties ?? [])
        .map((property) => property.property_code || property.id)
        .join(','),
      portal_url: generatedLink,
    });
    if (contactIds.length > 0) query.set('contact_ids', contactIds.join(','));
    const response = await fetch(`/api/inventory/share-summary?${query}`);
    const body = (await response.json()) as ShareSummaryResponse & {
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || 'Could not rank listings');
    return body.data;
  };

  const buildMessage = (
    link: string,
    name?: string | null,
    summaryOverride?: string
  ) => {
    const firstName = name?.trim().split(/\s+/)[0] || 'there';
    if (messageMode === 'list') {
      return (summaryOverride ?? summaryMessage)
        .replace(generatedLink, link)
        .replace('Hi there!', `Hi ${firstName}!`);
    }
    return pitchMessage
      .replaceAll('{portalUrl}', link)
      .replaceAll('{name}', firstName);
  };

  const previewMessage =
    messageMode === 'list' ? summaryMessage : buildMessage(generatedLink);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success('Showcase link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
      console.error(err);
    }
  };

  const handleCopyMessage = async () => {
    try {
      const contact =
        selectedContacts.length === 1 ? selectedContacts[0] : null;
      let personalized: PersonalizedShareSummary | undefined;
      if (contact && messageMode === 'list' && !hasCustomSummary) {
        try {
          personalized = (await fetchShareSummaries([contact.id])).personalized[
            contact.id
          ];
        } catch (error) {
          console.error('[showcase-share] personalized list failed:', error);
        }
      }
      await navigator.clipboard.writeText(
        contact
          ? buildMessage(
              personalizedLink(contact.id),
              contact.name,
              personalized?.summary
            )
          : previewMessage
      );
      setCopiedMessage(true);
      toast.success(
        contact
          ? `Message for ${contact.name || contact.phone} copied!`
          : 'Message copied to clipboard!'
      );
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch (err) {
      toast.error('Failed to copy message');
      console.error(err);
    }
  };

  const handleShareMessage = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Property Showcase',
          text: previewMessage,
        });
      } else {
        await navigator.clipboard.writeText(previewMessage);
        toast.success('Message copied to clipboard!');
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Failed to share');
        console.error(err);
      }
    }
  };

  const handleWhatsApp = async () => {
    // No recipient → WhatsApp opens its own chat picker, so the message
    // can go to a group or broadcast list.
    if (sendableContacts.length === 0) {
      window.open(
        `https://api.whatsapp.com/send?text=${encodeURIComponent(previewMessage)}`,
        '_blank'
      );
      return;
    }
    // Personal WhatsApp can only open one chat at a time.
    for (const contact of sendableContacts.slice(0, 1)) {
      let personalized: PersonalizedShareSummary | undefined;
      if (messageMode === 'list' && !hasCustomSummary) {
        try {
          personalized = (await fetchShareSummaries([contact.id])).personalized[
            contact.id
          ];
        } catch (error) {
          console.error('[showcase-share] personalized list failed:', error);
        }
      }
      const message = buildMessage(
        personalizedLink(contact.id),
        contact.name,
        personalized?.summary
      );
      const phone = (contact.phone || '').replace(/\D/g, '');
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
        '_blank'
      );
    }
    if (sendableContacts.length > 1) {
      toast.info(
        'WhatsApp opens one chat at a time — use Engine to send to everyone selected at once.'
      );
    }
  };

  const handleEngineSend = async () => {
    if (!engineTemplate || !accountId || sendableContacts.length === 0) return;
    setSendingEngine(true);
    let sent = 0;
    const failures: string[] = [];
    try {
      const summaries = await fetchShareSummaries(
        sendableContacts.map((contact) => contact.id)
      );
      for (const contact of sendableContacts) {
        const firstName = contact.name?.trim().split(/\s+/)[0] || 'there';
        const [residential, commercial, farmAndLand] =
          summaries.personalized[contact.id]?.template_params ??
          summaries.template_params;
        // Dynamic URL-button suffix → tracked, personalised portal open.
        const buttonParams: Record<number, string> = {};
        (engineTemplate.buttons ?? []).forEach((btn, idx) => {
          if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
            const link = new URL(personalizedLink(contact.id));
            buttonParams[idx] = `${link.search}`;
          }
        });
        try {
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: [
                {
                  phone: contact.phone,
                  params: [firstName, residential, commercial, farmAndLand],
                  ...(Object.keys(buttonParams).length > 0
                    ? { messageParams: { buttonParams } }
                    : {}),
                },
              ],
              template_name: engineTemplate.name,
              template_language: engineTemplate.language || 'en_US',
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Send failed');
          const result = data.results?.[0];
          if (result?.status === 'failed')
            throw new Error(result.error || 'Delivery failure');
          sent += 1;
          setEngineSentContactIds((prev) => new Set(prev).add(contact.id));
        } catch (err) {
          failures.push(contact.name || contact.phone || 'contact');
          console.error('[showcase-share] Engine send failed:', err);
        }
      }
    } catch (error) {
      console.error('[showcase-share] ranking request failed:', error);
      toast.error('Could not prepare the inventory update. Please try again.');
    } finally {
      setSendingEngine(false);
    }

    if (sent > 0) {
      toast.success(
        `Inventory update sent to ${sent} ${sent === 1 ? 'contact' : 'contacts'} from your business number — replies land in your Inbox.`
      );
    }
    if (failures.length > 0) {
      toast.error(`Could not send to ${failures.join(', ')}`);
    }
  };

  const scopeOptions: {
    key: ShareScope;
    label: string;
    desc: string;
    icon: typeof Layers;
  }[] = [
    {
      key: 'all',
      label: 'Whole showcase',
      desc: 'Everything published',
      icon: Layers,
    },
    {
      key: 'search',
      label: 'Search results',
      desc: trimmedSearch ? `“${trimmedSearch}”` : 'Search inventory first',
      icon: Filter,
    },
    {
      key: 'pick',
      label: 'Hand-picked',
      desc: 'Choose listings',
      icon: ListChecks,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-900 text-slate-200 sm:max-w-xl">
        <DialogHeader className="mb-2 border-b border-slate-800 pb-3">
          <DialogTitle className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
            <Share2 className="text-primary size-5" />
            Share Showcase Portal
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Pick who it is for, what they should see, and how it goes out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* ── Step 1 — WHO ─────────────────────────────────────── */}
          <div className="space-y-2">
            {stepLabel(1, 'Who is it for')}
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  {
                    key: 'client',
                    label: 'To Clients',
                    desc: 'Teaser — masked address, inquiry funnel',
                    icon: User,
                  },
                  {
                    key: 'agent',
                    label: 'To Co-Brokers',
                    desc: 'Complete info — specs, photos & map',
                    icon: Handshake,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setAudience(tab.key)}
                  className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg px-2 py-2 transition-all ${
                    audience === tab.key
                      ? 'border-primary/40 bg-primary/15 text-primary border'
                      : 'border border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <tab.icon className="size-4" />
                  <span className="text-xs font-bold">{tab.label}</span>
                  <span className="hidden text-[9px] text-slate-500 sm:block">
                    {tab.desc}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] font-medium text-slate-500">
              {audience === 'agent'
                ? 'Co-broker links open the complete catalog — full specs, photos, and map locations, without inquiry forms.'
                : 'Client links open the teaser showcase — exact addresses stay masked until they inquire, so every serious viewer becomes a captured lead.'}
            </p>
          </div>

          {/* ── Step 2 — WHAT ────────────────────────────────────── */}
          <div className="space-y-2">
            {stepLabel(2, 'What they see')}
            <div className="grid grid-cols-3 gap-2">
              {scopeOptions.map((option) => {
                const disabled = option.key === 'search' && !trimmedSearch;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScope(option.key)}
                    className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                      scope === option.key
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <option.icon className="size-4" />
                    <span className="text-[11px] font-bold">
                      {option.label}
                    </span>
                    <span className="line-clamp-1 text-[9px] text-slate-500">
                      {option.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {scope === 'all' && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  ['All', 'Residential', 'Commercial', 'Agricultural'] as const
                ).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setShareCategory(cat)}
                    className={`cursor-pointer rounded-lg border px-2.5 py-2 text-center text-xs font-semibold transition-all select-none ${
                      shareCategory === cat
                        ? 'border-primary bg-primary text-primary-foreground shadow-primary/20 font-bold shadow-md'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    {cat === 'All' ? 'All Properties' : cat}
                  </button>
                ))}
              </div>
            )}

            {scope === 'pick' && (
              <div className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/40 p-3">
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search your published listings..."
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="focus:ring-primary h-9 w-full rounded-lg border border-slate-800 bg-slate-900 pr-7 pl-8 text-xs text-white placeholder:text-slate-500 focus:ring-1 focus:outline-none"
                  />
                  {pickerSearch && (
                    <button
                      type="button"
                      onClick={() => setPickerSearch('')}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                {properties === null ? (
                  <div className="h-24 animate-pulse rounded-lg bg-slate-900" />
                ) : pickerResults.length === 0 ? (
                  <p className="py-4 text-center text-xs font-medium text-slate-500">
                    No published listings match this search.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                    {pickerResults.slice(0, 100).map((property) => {
                      const checked = picked.includes(property.id);
                      return (
                        <button
                          key={property.id}
                          type="button"
                          onClick={() => togglePicked(property.id)}
                          className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                            checked
                              ? 'border-primary bg-primary/10'
                              : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-slate-600'
                            }`}
                          >
                            {checked && <Check className="size-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-white">
                              {property.title}
                            </span>
                            <span className="block truncate text-[10px] text-slate-500">
                              {[
                                property.sublocality ||
                                  property.city ||
                                  property.location,
                                formatShareAmount(property.price),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] font-medium text-slate-500">
              This link will open{' '}
              <span className="text-primary font-bold">
                {scopeSummaryLabel}
              </span>
              {scope === 'pick' && picked.length === 0
                ? ' — pick at least one listing.'
                : '.'}
            </p>
          </div>

          {/* ── Step 3 — HOW ─────────────────────────────────────── */}
          <div className="space-y-3">
            {stepLabel(3, 'How it goes out')}

            <div className="flex gap-2">
              <Input
                readOnly
                value={generatedLink}
                className="h-9 border-slate-800 bg-slate-900 font-mono text-xs text-slate-200 select-all"
              />
              <Button
                onClick={() => void handleCopyLink()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 shrink-0 items-center gap-1 px-3 text-xs font-semibold"
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(generatedLink, '_blank')}
                className="text-slate-350 flex h-9 shrink-0 items-center gap-1 border-slate-800 px-3 text-xs hover:bg-slate-800"
              >
                <ExternalLink className="size-3.5" />
                View
              </Button>
            </div>

            <div className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/40 p-4">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
                {(
                  [
                    { key: 'pitch', label: 'Short pitch' },
                    { key: 'list', label: 'Full list' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setMessageMode(mode.key)}
                    className={`cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-bold transition-all ${
                      messageMode === mode.key
                        ? 'bg-primary/15 text-primary'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {messageMode === 'pitch' ? (
                <>
                  <Textarea
                    value={pitchMessage}
                    onChange={(e) => setPitchMessage(e.target.value)}
                    className="min-h-[120px] resize-none border-slate-800 bg-slate-900 text-xs text-slate-200"
                  />
                  <p className="text-[10px] text-slate-500">
                    Use{' '}
                    <code className="text-primary rounded bg-slate-950 px-1 py-0.5">
                      {'{portalUrl}'}
                    </code>{' '}
                    for the showcase link and{' '}
                    <code className="text-primary rounded bg-slate-950 px-1 py-0.5">
                      {'{name}'}
                    </code>{' '}
                    for the contact&apos;s first name.
                  </p>
                </>
              ) : scopeProperties === null ? (
                <div className="h-24 animate-pulse rounded-lg bg-slate-900" />
              ) : summaryMessage ? (
                <Textarea
                  value={summaryMessage}
                  onChange={(e) =>
                    setSummaryDraft({ base: autoSummary, text: e.target.value })
                  }
                  className="max-h-[280px] min-h-[160px] resize-none overflow-y-auto border-slate-800 bg-slate-900 font-mono text-xs text-slate-200"
                />
              ) : (
                <p className="py-3 text-center text-xs font-medium text-slate-500">
                  Nothing to list in this selection yet.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => void handleCopyMessage()}
                  className="flex flex-1 items-center justify-center gap-2 bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  {copiedMessage ? (
                    <>
                      <Check className="size-3.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy Message
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => void handleShareMessage()}
                  variant="outline"
                  className="flex items-center justify-center gap-2 border-emerald-600 px-4 py-2.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-600/20"
                >
                  <Share2 className="size-3.5" />
                  Share
                </Button>
              </div>
            </div>

            {/* Recipients — tracked, multi-select */}
            <div className="border-slate-850 space-y-3 rounded-xl border bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-350 text-xs font-bold tracking-wider uppercase">
                  Send to contacts
                </span>
                {selectedContactIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedContactIds([])}
                    className="text-[10px] font-bold text-slate-400 hover:text-white"
                  >
                    Clear {selectedContactIds.length}
                  </button>
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-500">
                Each contact gets their own link, so every open, photo swipe,
                and map click shows up{' '}
                <strong className="text-slate-400">by name</strong> in Showcase
                Pulse.
              </p>

              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search contacts by name or phone..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="focus:ring-primary h-9 w-full rounded-lg border border-slate-800 bg-slate-900 pr-7 pl-8 text-xs text-white placeholder:text-slate-500 focus:ring-1 focus:outline-none"
                />
                {contactSearch && (
                  <button
                    type="button"
                    onClick={() => setContactSearch('')}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {loadingContacts ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-10 animate-pulse rounded-lg bg-slate-900"
                    />
                  ))}
                </div>
              ) : filteredContacts.length === 0 ? (
                <p className="py-4 text-center text-xs font-medium text-slate-500">
                  {contacts.length === 0
                    ? 'No active contacts yet'
                    : 'No matching contacts found'}
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                  {filteredContacts.slice(0, 50).map((contact) => {
                    const checked = selectedContactIds.includes(contact.id);
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => toggleContact(contact.id)}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                          checked
                            ? 'border-primary bg-primary/10'
                            : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                        }`}
                      >
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-slate-600'
                          }`}
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 truncate text-xs font-bold text-white">
                            <span className="truncate">
                              {contact.name ||
                                contact.phone ||
                                'Unnamed contact'}
                            </span>
                            <NameTagBadge tag={contact.name_tag} />
                          </span>
                          <span className="block truncate text-[10px] font-medium text-slate-500">
                            {contact.phone
                              ? `📞 ${contact.phone}`
                              : 'No phone number'}
                          </span>
                        </span>
                        {engineSentContactIds.has(contact.id) && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <Check className="size-3" />
                            Sent
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {filteredContacts.length > 50 && (
                    <p className="pt-1 text-center text-[10px] font-medium text-slate-500">
                      Showing first 50 — refine the search to find others
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {engineTemplateApproved && (
                  <Button
                    onClick={() => void handleEngineSend()}
                    disabled={sendableContacts.length === 0 || sendingEngine}
                    title="Send the inventory update template from your WhatsApp Business number — replies land in your Inbox"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 py-2.5 text-xs font-bold"
                  >
                    {sendingEngine ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Send via Engine
                    {sendableContacts.length > 0
                      ? ` (${sendableContacts.length})`
                      : ''}
                  </Button>
                )}
                <Button
                  onClick={() => void handleWhatsApp()}
                  variant={engineTemplateApproved ? 'outline' : 'default'}
                  className={
                    engineTemplateApproved
                      ? 'flex items-center justify-center gap-2 border-emerald-600 px-4 py-2.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-600/20'
                      : 'flex flex-1 items-center justify-center gap-2 bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500'
                  }
                >
                  <Smartphone className="size-3.5" />
                  WhatsApp
                </Button>
              </div>

              {engineTemplateChecked && !engineTemplateApproved && (
                <div className="border-primary/25 bg-primary/5 space-y-2 rounded-lg border p-3">
                  <p className="text-primary flex items-center gap-1.5 text-[11px] font-bold">
                    <Sparkles className="size-3.5" />
                    Send from your WhatsApp Business number
                  </p>
                  {engineTemplate?.status === 'PENDING' ? (
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      Template submitted — waiting for Meta approval (usually
                      minutes to a few hours). Engine sending unlocks
                      automatically once approved.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {engineTemplate?.status === 'REJECTED'
                          ? `Meta rejected the template${engineTemplate.rejection_reason ? `: ${engineTemplate.rejection_reason}` : ''}.`
                          : 'One-time setup: submit the ready-made inventory_update template for Meta approval. After that, updates go out from your business number — replies land in your Inbox instead of your personal WhatsApp.'}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => void handleSubmitEngineTemplate()}
                        disabled={submittingEngineTemplate}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-1.5 text-[11px] font-bold"
                      >
                        {submittingEngineTemplate ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Submitting…
                          </>
                        ) : (
                          <>
                            <Send className="size-3.5" />
                            {engineTemplate?.status === 'REJECTED'
                              ? 'Resubmit template'
                              : 'Create & submit template'}
                          </>
                        )}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-800 pt-3.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="hover:bg-slate-850 h-9 border-slate-800 text-xs text-slate-300"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
