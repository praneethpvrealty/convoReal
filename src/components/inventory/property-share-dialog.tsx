'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { toast } from 'sonner';
import type { Property, Contact, MessageTemplate } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
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
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
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
  UserCheck,
  Lock,
  MapPin,
  FileText,
  Ban,
  FolderInput,
} from 'lucide-react';
import { getMatchingContacts, inMatchAudience, type MatchAudience, type MatchDetails } from '@/lib/matching';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { recordPropertyShares } from '@/lib/inventory/share-log';
import { isLocationGuarded, localityLabel } from '@/lib/inventory/location-guard';
import {
  DEFAULT_SHARE_GRANT_TTL_KEY,
  SHARE_GRANT_TTL_CHOICES,
  type ShareGrantTtlKey,
} from '@/lib/inventory/share-grants';
import { MatchDetailChips } from '@/components/inventory/match-detail-chips';
import { ListingAudiencePicker } from '@/components/inventory/listing-audience-picker';
import { audienceListingLabel, type AudienceListing } from '@/lib/inventory/listing-audience';
import { MatchTargetRow } from '@/components/matching/match-target-row';
import {
  fetchInquiredProperties,
  inquiredPropertyLabel,
  type InquiredProperty,
} from '@/lib/contacts/inquired-properties';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { pickShareDialogTemplate } from '@/lib/whatsapp/property-share-template';
import {
  buildPropertyShareMessage,
  buildShareTargets,
  greetingName,
  showcaseOriginForHost,
  type ShareDetailLevel,
  type ShareTone,
} from '@/lib/share-message-builder';
import { MessageCircle, Mail, RotateCcw, User, Handshake, Megaphone, Image as ImageIcon } from 'lucide-react';
import { hasPhone } from '@/lib/contacts/reachability';

/** A live grant as the list endpoint returns it, with the recipient
 *  joined when the grant was minted for a named contact. */
interface ActiveGrant {
  id: string;
  token: string;
  reveal_location: boolean;
  reveal_documents: boolean;
  reveal_private_images: boolean;
  expires_at: string;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface PropertyShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
  onSaved?: () => void;
  preSelectedContactId?: string;
  /** When provided (Meta Ads enabled), shows a "Promote as WhatsApp Ad"
   *  action that opens the Click-to-WhatsApp Meta ad wizard. */
  onPromote?: (property: Property) => void;
}

// On desktop, navigator.share opens the OS share sheet, which has no
// WhatsApp target — only mobile share sheets route into WhatsApp with
// the photo attached. Includes iPadOS, which masquerades as macOS.
function isMobileSharePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

export function PropertyShareDialog({
  open,
  onOpenChange,
  property,
  onSaved,
  preSelectedContactId,
  onPromote,
}: PropertyShareDialogProps) {
  const supabase = createClient();
  const { user, accountId, profile } = useAuth();
  // Minting and revoking are agent+ server-side (requireRole('agent')) —
  // mirror that here so a read-only member is not offered a control that
  // can only 403.
  const canManageGrants = useCan('send-messages');

  // Dialog flow steps: 'link' | 'matches' | 'configure' | 'sending' | 'results'
  const [broadcastStep, setBroadcastStep] = useState<'link' | 'matches' | 'configure' | 'sending' | 'results'>('link');
  const [copiedLink, setCopiedLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Contact list and selections
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [inquiriesByContact, setInquiriesByContact] = useState<
    Map<string, InquiredProperty[]>
  >(new Map());
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  // Who the matched list offers: buyers by default, agents only for a
  // co-broker blast, or both together.
  const [matchAudience, setMatchAudience] = useState<MatchAudience>('buyers');

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
  const [showcaseSubdomain, setShowcaseSubdomain] = useState<string | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState<'template' | 'catalog' | 'greeting'>('template');
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [metaCatalogSyncedAt, setMetaCatalogSyncedAt] = useState<string | null>(null);
  const [metaCatalogError, setMetaCatalogError] = useState<string | null>(null);
  const [indexingTimeLeft, setIndexingTimeLeft] = useState<number>(0);
  const [messageStyle, setMessageStyle] = useState<ShareTone>('professional');
  const [copiedMessage, setCopiedMessage] = useState(false);
  // Who the share is for: tabs on the first step. 'client' and 'agent'
  // compose an external message; 'engine' hosts the in-Engine send flows
  // (greeting / templates / catalog card).
  const [audienceTab, setAudienceTab] = useState<'client' | 'agent' | 'engine'>('client');
  const [detailLevel, setDetailLevel] = useState<ShareDetailLevel>('standard');
  // User edits to the composed message; null = follow the auto-generated
  // text. Reset whenever any composer input changes.
  const [messageDraft, setMessageDraft] = useState<string | null>(null);

  // ── Unmask this share (migration 198) ───────────────────────────
  // Off by default: the masked link is what turns a viewer into a
  // captured lead. Turning either switch on mints a share grant whose
  // token rides the link as ?g= — expiring, revocable, and scoped to
  // this one listing. Sending to a named contact re-mints it bound to
  // them, so it can be revoked for one recipient without touching the
  // others.
  const [revealLocation, setRevealLocation] = useState(false);
  const [revealDocuments, setRevealDocuments] = useState(false);
  const [revealPrivateImages, setRevealPrivateImages] = useState(false);
  const [grantTtl, setGrantTtl] = useState<ShareGrantTtlKey>(
    DEFAULT_SHARE_GRANT_TTL_KEY,
  );
  const [linkGrant, setLinkGrant] = useState<{ id: string; token: string } | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const linkGrantRef = useRef<{ id: string; token: string } | null>(null);
  const contactGrantsRef = useRef<Record<string, string>>({});

  // Every live grant on this listing, so an agent can see what is
  // currently unmasked — including links minted in an earlier session —
  // and pull any of them back. Bumping the version refetches.
  const [activeGrants, setActiveGrants] = useState<ActiveGrant[] | null>(null);
  const [grantsVersion, setGrantsVersion] = useState(0);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const bumpGrants = useCallback(() => setGrantsVersion((v) => v + 1), []);

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

  const propertyId = property?.id ?? null;

  const propertyDocumentCount = useMemo(
    () => (property?.documents ?? []).filter((d) => d?.trim()).length,
    [property?.documents],
  );

  const propertyPrivateImageCount = useMemo(
    () => (property?.private_images ?? []).filter((p) => p?.trim()).length,
    [property?.private_images],
  );

  const mintGrant = useCallback(
    async (contactId: string | null) => {
      if (!propertyId) return null;
      const res = await fetch(`/api/properties/${propertyId}/share-grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          reveal_location: revealLocation,
          reveal_documents: revealDocuments,
          reveal_private_images: revealPrivateImages,
          expires_in: grantTtl,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to unmask this share');
      return json.data as { id: string; token: string };
    },
    [propertyId, revealLocation, revealDocuments, revealPrivateImages, grantTtl],
  );

  const revokeGrant = useCallback(
    async (grantId: string) => {
      if (!propertyId) return;
      try {
        await fetch(
          `/api/properties/${propertyId}/share-grants?grant_id=${grantId}`,
          { method: 'DELETE' },
        );
        bumpGrants();
      } catch (err) {
        console.error('[property-share] Grant revoke failed:', err);
      }
    },
    [propertyId, bumpGrants],
  );

  useEffect(() => {
    if (!open || !propertyId) return;
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/properties/${propertyId}/share-grants`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed to load links');
        setActiveGrants(json.data as ActiveGrant[]);
      } catch (err) {
        if (cancelled) return;
        console.error('[property-share] Grant list load failed:', err);
        setActiveGrants([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, propertyId, grantsVersion]);

  const handleRevokeGrant = async (grant: ActiveGrant) => {
    if (!propertyId) return;
    setRevokingGrantId(grant.id);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/share-grants?grant_id=${grant.id}`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to revoke');

      // Revoking the key this dialog is currently handing out has to
      // reset the switches too, or the composed message would keep
      // carrying a token that no longer opens anything.
      if (linkGrantRef.current?.id === grant.id) {
        linkGrantRef.current = null;
        setLinkGrant(null);
        setRevealLocation(false);
        setRevealDocuments(false);
        setRevealPrivateImages(false);
      }
      contactGrantsRef.current = Object.fromEntries(
        Object.entries(contactGrantsRef.current).filter(
          ([, token]) => token !== grant.token,
        ),
      );
      toast.success('Link revoked — it now opens masked.');
      bumpGrants();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
      console.error('[property-share] Revoke failed:', err);
    } finally {
      setRevokingGrantId(null);
    }
  };

  // Any change to what is revealed invalidates the previous key: the old
  // grant is revoked so a link already copied cannot outlive the toggle
  // that produced it.
  useEffect(() => {
    if (!open || !propertyId) return;
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      const previous = linkGrantRef.current;
      linkGrantRef.current = null;
      contactGrantsRef.current = {};
      setLinkGrant(null);
      if (previous) void revokeGrant(previous.id);
      if (!revealLocation && !revealDocuments && !revealPrivateImages) return;

      setGrantBusy(true);
      try {
        const grant = await mintGrant(null);
        if (cancelled || !grant) return;
        linkGrantRef.current = grant;
        setLinkGrant(grant);
        bumpGrants();
      } catch (err) {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Failed to unmask this share');
        setRevealLocation(false);
        setRevealDocuments(false);
        setRevealPrivateImages(false);
      } finally {
        if (!cancelled) setGrantBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    propertyId,
    revealLocation,
    revealDocuments,
    revealPrivateImages,
    mintGrant,
    revokeGrant,
    bumpGrants,
  ]);

  // Closing the dialog resets the switches; the grant itself stays live
  // for the link already sent.
  useEffect(() => {
    if (open) return;
    linkGrantRef.current = null;
    contactGrantsRef.current = {};
    Promise.resolve().then(() => {
      setLinkGrant(null);
      setRevealLocation(false);
      setRevealDocuments(false);
      setRevealPrivateImages(false);
      setGrantTtl(DEFAULT_SHARE_GRANT_TTL_KEY);
    });
  }, [open]);

  const grantToken = linkGrant?.token ?? null;

  /** A grant bound to this recipient, minted on first send to them. */
  const ensureContactGrant = useCallback(
    async (contactId: string): Promise<string | null> => {
      if (!revealLocation && !revealDocuments && !revealPrivateImages) {
        return null;
      }
      const existing = contactGrantsRef.current[contactId];
      if (existing) return existing;
      try {
        const grant = await mintGrant(contactId);
        if (!grant) return null;
        contactGrantsRef.current = {
          ...contactGrantsRef.current,
          [contactId]: grant.token,
        };
        bumpGrants();
        return grant.token;
      } catch (err) {
        console.error('[property-share] Contact grant mint failed:', err);
        // Fall back to the share-wide grant rather than sending a link
        // that silently drops the reveal the agent asked for.
        return grantToken;
      }
    },
    [
      revealLocation,
      revealDocuments,
      revealPrivateImages,
      mintGrant,
      grantToken,
      bumpGrants,
    ],
  );

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

  // Composed outbound message for the active tab, rebuilt from the
  // audience + tone + detail-level pickers (share-message-builder).
  const autoMessage = useMemo(() => {
    if (!property) return '';
    const origin =
      typeof window !== 'undefined'
        ? showcaseOriginForHost(window.location.host, window.location.protocol, showcaseSubdomain)
        : '';
    const grantSuffix = grantToken ? `&g=${grantToken}` : '';
    const url =
      audienceTab === 'agent'
        ? `${origin}/?property_id=${property.id}&mode=view${grantSuffix}`
        : `${origin}/?property_id=${property.id}${grantSuffix}`;
    return buildPropertyShareMessage({
      property,
      url,
      audience: audienceTab === 'agent' ? 'agent' : 'client',
      detail: detailLevel,
      tone: messageStyle,
      currency,
      agentName: profile?.full_name || undefined,
      agentPhone: profile?.phone || undefined,
    });
  }, [property, audienceTab, detailLevel, messageStyle, currency, profile, showcaseSubdomain, grantToken]);

  // Any composer input change discards manual edits back to auto text.
  useEffect(() => {
    setMessageDraft(null);
  }, [audienceTab, detailLevel, messageStyle, property?.id, grantToken]);

  const currentMessage = messageDraft ?? autoMessage;

  // Default (cover) photo as a File, for attaching to native shares and
  // clipboard copies. Uses the listing's first photo; when the listing has
  // none (common for land/plots), falls back to a branded flyer rendered
  // from the listing so the share still carries an image instead of going
  // out text-only. Null only when both the photo and the flyer fail.
  const fetchCoverImageFile = useCallback(async (): Promise<File | null> => {
    const sanitizedTitle = (property?.title || 'property')
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 50) || 'property';

    const imageUrl = storagePublicUrl(property?.images?.find((img) => img.trim().length > 0));
    if (imageUrl) {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        return new File([blob], `${sanitizedTitle}.jpg`, { type: blob.type || 'image/jpeg' });
      } catch {
        // fall through to the generated flyer cover
      }
    }

    if (property?.id) {
      try {
        const res = await fetch(`/api/properties/${property.id}/flyer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            size: 1080,
            brand_name: profile?.full_name || '',
            brand_contact: profile?.phone || '',
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const dataUrl: unknown = json?.data?.image;
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
            const blob = await (await fetch(dataUrl)).blob();
            return new File([blob], `${sanitizedTitle}.png`, { type: 'image/png' });
          }
        }
      } catch {
        // fall back to text-only
      }
    }
    return null;
  }, [property, profile]);

  const [sharingWhatsApp, setSharingWhatsApp] = useState(false);
  const [copyingPhoto, setCopyingPhoto] = useState(false);

  // Get showcase URL for copying
  const showcaseUrl = useMemo(() => {
    if (!property) return '';
    const grantSuffix = grantToken ? `&g=${grantToken}` : '';
    return typeof window !== 'undefined'
      ? `${showcaseOriginForHost(window.location.host, window.location.protocol, showcaseSubdomain)}/?property_id=${property.id}${grantSuffix}`
      : `/?property_id=${property.id}${grantSuffix}`;
  }, [property, showcaseSubdomain, grantToken]);

  // Agent showcase URL — clean listing detail page (no inquiry form, no buttons)
  const agentShowcaseUrl = useMemo(() => {
    if (!property) return '';
    const grantSuffix = grantToken ? `&g=${grantToken}` : '';
    return typeof window !== 'undefined'
      ? `${showcaseOriginForHost(window.location.host, window.location.protocol, showcaseSubdomain)}/?property_id=${property.id}&mode=view${grantSuffix}`
      : `/?property_id=${property.id}&mode=view${grantSuffix}`;
  }, [property, showcaseSubdomain, grantToken]);

  // ── Send personally (tracked) ────────────────────────────────
  // Same property link tagged with ?v=<contactId>, so the recipient's
  // showcase activity shows up by name in Pulse instead of as an
  // Anonymous Guest (`v=` only attributes events, never filters).
  const [personalSearch, setPersonalSearch] = useState('');
  const [copiedPersonalId, setCopiedPersonalId] = useState<string | null>(null);
  const [inventorySharingContactId, setInventorySharingContactId] = useState<string | null>(null);

  const personalContacts = useMemo(() => {
    const q = personalSearch.toLowerCase().trim();
    const reachable = contacts.filter(
      (contact) =>
        hasPhone(contact) &&
        (audienceTab !== 'agent' || contact.classification === 'Agent')
    );
    if (!q) return reachable;
    return reachable.filter(
      (c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q),
    );
  }, [contacts, personalSearch, audienceTab]);

  const personalizedUrl = useCallback(
    (contactId: string, contactGrantToken: string | null) => {
      if (!property) return '';
      const baseUrl = audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl;
      if (!baseUrl) return '';
      const url = new URL(
        baseUrl,
        typeof window !== 'undefined' ? window.location.origin : 'https://localhost',
      );
      url.searchParams.set('v', contactId);
      // Overwrites the share-wide grant the base URL carries, so this
      // recipient holds a key revocable on its own.
      if (contactGrantToken) url.searchParams.set('g', contactGrantToken);
      return url.toString();
    },
    [property, audienceTab, agentShowcaseUrl, showcaseUrl],
  );

  const buildPersonalMessage = useCallback(
    (contact: Contact, contactGrantToken: string | null) => {
      const baseUrl = audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl;
      const trackedUrl = personalizedUrl(contact.id, contactGrantToken);
      // Swap the plain link in the composed message for the tagged one;
      // if the user edited the link out, append the tagged link instead.
      let msg = currentMessage.includes(baseUrl)
        ? currentMessage.replaceAll(baseUrl, trackedUrl)
        : `${currentMessage}\n\n📸 Photos & full details:\n${trackedUrl}`;
      const greetName = greetingName(contact.name);
      if (greetName) msg = msg.replace(/^(Hi|Hey|Hello)([,!])/, `$1 ${greetName}$2`);
      return msg;
    },
    [audienceTab, agentShowcaseUrl, showcaseUrl, personalizedUrl, currentMessage],
  );

  const handleWhatsAppPersonal = (contact: Contact) => {
    const needsGrant = revealLocation || revealDocuments || revealPrivateImages;
    // Minting is a round trip, and a window opened after an await is
    // what popup blockers exist to stop. Claim the tab on the click,
    // then point it at WhatsApp once the recipient's key exists.
    const pending = needsGrant ? window.open('', '_blank') : null;
    if (pending) pending.opener = null;

    void (async () => {
      const token = needsGrant ? await ensureContactGrant(contact.id) : null;
      const message = buildPersonalMessage(contact, token);
      const phone = (contact.phone ?? '').replace(/\D/g, '');
      const href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if (pending) pending.location.href = href;
      else window.open(href, '_blank', 'noopener');
      captureSharesToJourney([contact.id], true);
    })();
  };

  const handleCopyPersonal = async (contact: Contact) => {
    try {
      const token =
        revealLocation || revealDocuments || revealPrivateImages
          ? await ensureContactGrant(contact.id)
          : null;
      await navigator.clipboard.writeText(buildPersonalMessage(contact, token));
      setCopiedPersonalId(contact.id);
      toast.success(`Personal message for ${contact.name || contact.phone} copied!`);
      setTimeout(() => setCopiedPersonalId(null), 2000);
    } catch (err) {
      toast.error('Failed to copy message');
      console.error(err);
    }
  };

  const handleInventoryShare = async (contact: Contact) => {
    if (!property) return;
    setInventorySharingContactId(contact.id);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/share-to-agent-account`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contact.id }),
        }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to share inventory');
      toast.success(
        `${contact.name || contact.phone} will see this under Listings to review`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to share inventory');
    } finally {
      setInventorySharingContactId(null);
    }
  };

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

      let contactsList = await attachInquiredListingTypes(
        supabase,
        accountId,
        (data || []) as unknown as Contact[]
      );

      // If a contact was pre-selected but not in the active list (e.g., pending_review),
      // fetch it separately and add it to the list
      if (preSelectedContactId && !contactsList.some((c) => c.id === preSelectedContactId)) {
        const { data: preSelectedContact } = await supabase
          .from('contacts')
          .select('*, contact_notes(note_text)')
          .eq('id', preSelectedContactId)
          .maybeSingle();
        
        if (preSelectedContact) {
          contactsList = [preSelectedContact, ...contactsList];
        }
      }

      setContacts(contactsList);
      setInquiriesByContact(
        await fetchInquiredProperties(
          supabase,
          accountId,
          contactsList.map((c) => c.id)
        )
      );

      // Refresh AI-extracted matching preferences for contacts whose
      // requirements/notes changed since the last extraction (the server
      // hash-skips unchanged ones), then re-pull so matches use fresh data.
      const stale = contactsList
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
            if (refreshed) {
              const hydrated = await attachInquiredListingTypes(
                supabase,
                accountId,
                refreshed as unknown as Contact[]
              );
              // Re-add pre-selected contact if it was filtered out
              if (preSelectedContactId && !hydrated.some((c) => c.id === preSelectedContactId)) {
                const preSelected = contactsList.find((c) => c.id === preSelectedContactId);
                if (preSelected) {
                  setContacts([preSelected, ...hydrated]);
                } else {
                  setContacts(hydrated);
                }
              } else {
                setContacts(hydrated);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load contacts for sharing:', err);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, [supabase, accountId, preSelectedContactId]);

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

      // Auto-selection: the engine's own templates, then looser name
      // matches, Utility preferred at every tier — a Marketing template
      // is silently dropped for a recipient at their per-user cap
      // (error 131049). Photo-first when the listing has one.
      if (tData.length > 0) {
        const hasPhoto = Boolean(
          property?.images?.some((img) => img && img.trim().length > 0)
        );
        setSelectedTemplate(pickShareDialogTemplate(tData, { hasImage: hasPhoto }));
      }
    } catch (err) {
      console.error('Failed to load templates for share:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [supabase, property?.images]);

  // Reset dialog states only when open changes from false to true
  useEffect(() => {
    if (open) {
      setBroadcastStep(preSelectedContactId ? 'matches' : 'link');
      setSearchQuery('');
      setCopiedLink(false);
      setSelectedContactIds(preSelectedContactId ? [preSelectedContactId] : []);
      setMatchAudience('buyers');
      setAppliedAudience(null);
      setSelectedTemplate(null);
      setVariableMappings({});
      setCustomVariableValues({});
      setBroadcastResults([]);
      setShowAddFresh(false);
      setFreshName('');
      setFreshPhone('');
      setFreshClassification('Buyer');
      setPersonalSearch('');
      setCopiedPersonalId(null);
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

        // Load currency + subdomain settings from showcase_settings
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
    } else if (!open) {
      // Clear cache when closed
      lastFetchedRef.current = { accountId: null, propertyId: null };
    }
  }, [open, accountId, property, fetchContacts, fetchTemplates, supabase]);

  // Get matching contacts from list
  const matchedContacts = useMemo(() => {
    if (!property || contacts.length === 0) return [];
    // Standard matched target pool
    // Every route out of this dialog is a WhatsApp send, so an
    // email-only contact cannot be a target.
    const targetContacts = contacts.filter(
      (c) => hasPhone(c) && (c.classification === 'Buyer' || c.classification === 'Agent'),
    );
    return getMatchingContacts(property, targetContacts);
  }, [contacts, property]);

  // Combine search query and matching contacts logic
  // Exclude contacts who were already messaged in the last 14 days from
  // the matched suggestions (not from explicit search or pre-selected).
  const displayedContacts = useMemo(() => {
    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let result: Array<{ contact: Contact; score: number; details: MatchDetails; matchedFields: { budget: boolean; area: boolean; interest: boolean } }> = [];

    if (!searchQuery.trim()) {
      result = matchedContacts.filter(({ contact: c }) =>
        inMatchAudience(c.classification, matchAudience)
      );

      // Ensure pre-selected contacts always appear — even if they're not
      // in matchedContacts (due to classification or no-match score).
      for (const id of selectedContactIds) {
        if (!result.some((r) => r.contact.id === id)) {
          const c = contacts.find((x) => x.id === id);
          if (c) {
            const unknownDetails: MatchDetails = { type: 'unknown', location: 'unknown', budget: 'unknown', bhk: 'unknown', roi: 'unknown' };
            result.unshift({ contact: c, score: 0, details: unknownDetails, matchedFields: { budget: false, area: false, interest: false } });
          }
        }
      }

      // Exclude contacts who were already contacted in the last 14 days,
      // except for contacts that are pre-selected or explicitly searched.
      result = result.filter(({ contact: c }) => {
        if (selectedContactIds.includes(c.id)) return true;
        if (c.last_contacted_at && new Date(c.last_contacted_at).getTime() > recentCutoff) return false;
        return true;
      });
    } else {
      const q = searchQuery.toLowerCase().trim();
      const filtered = contacts.filter((c) => {
        if (!hasPhone(c)) return false;
        if (!inMatchAudience(c.classification, matchAudience)) return false;
        return (
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(q))
        );
      });

      result = filtered.map((c) => {
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
    }

    // Sort: Checked/selected contacts always on top.
    // Within the selected and unselected groups, preserve original sort order (match score descending).
    return [...result].sort((a, b) => {
      const aSelected = selectedContactIds.includes(a.contact.id);
      const bSelected = selectedContactIds.includes(b.contact.id);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return 0;
    });
  }, [searchQuery, contacts, matchedContacts, matchAudience, selectedContactIds]);

  // Switching audience drops selections outside it (except the
  // pre-selected contact), so "Select All" then send never carries
  // hidden picks from the previous tab.
  function handleAudienceChange(audience: MatchAudience) {
    setMatchAudience(audience);
    if (audience === 'all') return;
    setSelectedContactIds((prev) =>
      prev.filter((id) => {
        if (id === preSelectedContactId) return true;
        const c = contacts.find((x) => x.id === id);
        return !c || inMatchAudience(c.classification, audience);
      })
    );
  }

  // Union rather than replace: an audience is added to whoever the
  // agent already picked, and picking two listings' audiences in a row
  // never double-selects anyone.
  //
  // The banner outlives the toast that used to be the only feedback. A
  // bulk selection that scrolls away is the one thing that could put a
  // listing in front of the wrong 22 people, so what was added stays on
  // screen — count, source listing, and a way to undo exactly it.
  const [appliedAudience, setAppliedAudience] = useState<{
    listing: AudienceListing;
    ids: string[];
    unreachable: number;
  } | null>(null);

  const addContactsToSelection = useCallback(
    (ids: string[], applied: { listing: AudienceListing; unreachable: number }) => {
      setSelectedContactIds((prev) => [...new Set([...prev, ...ids])]);
      setAppliedAudience({ ...applied, ids });
    },
    []
  );

  const undoAppliedAudience = useCallback(() => {
    setAppliedAudience((applied) => {
      if (applied) {
        const removed = new Set(applied.ids);
        setSelectedContactIds((prev) => prev.filter((id) => !removed.has(id)));
      }
      return null;
    });
  }, []);

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

  // Auto-capture a confirmed WhatsApp share onto the Journey mind
  // map. Fire-and-forget: capture failures must never break or delay
  // the send flow the agent is watching. Rows arrive hidden — they
  // queue in /journey's "Captured" tray instead of crowding the
  // canvas — and re-shares are no-ops (idempotent upsert).
  function captureSharesToJourney(sentContactIds: string[], journeyVisible = false) {
    if (!accountId || !property || sentContactIds.length === 0) return;
    // recordPropertyShares captures the journey item too — see its
    // header for why that is not left to each caller.
    recordPropertyShares({
      accountId,
      journeyVisible,
      propertyId: property.id,
      userId: user?.id,
      recipients: sentContactIds.map((contactId) => ({
        contactId,
        classification: contacts.find((c) => c.id === contactId)?.classification,
      })),
    })
      .then((r) => {
        if (r.error) console.error('Property share log failed:', r.error);
      })
      .catch((err) => console.error('Property share log failed:', err));
  }

  // Execute broadcast sharing request
  async function handleSendBroadcast() {
    if (!selectedTemplate || selectedContactIds.length === 0 || !property) return;
    setSendingBroadcast(true);
    setBroadcastStep('sending');

    try {
      const selectedContacts = contacts.filter((c) => selectedContactIds.includes(c.id));
      const guarded = isLocationGuarded(property);
      const fullLoc = [
        guarded ? '' : property.location.trim(),
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
              else if (mapping.value === 'phone') val = contact.phone ?? '';
              else if (mapping.value === 'email') val = contact.email || '';
              else if (mapping.value === 'company') val = contact.company || '';
            } else {
              if (mapping.value === 'title') val = property.title || '';
              else if (mapping.value === 'price') val = formattedPrice || '';
              else if (mapping.value === 'location') {
                const locVal = property.sublocality || fullLoc || '';
                val =
                  property.google_map_link && !guarded
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
              // v=<contactId> attributes the recipient's showcase opens
              // by name in Pulse (never filters the catalog).
              if (btn.url.includes('?property_id=')) {
                buttonParams[idx] = `${code}&v=${contact.id}`;
              } else {
                buttonParams[idx] = `?property_id=${code}&v=${contact.id}`;
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
          messageParams.headerMediaUrl = storagePublicUrl(propertyImage);
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
            c.phone !== null &&
            (r.phone === c.phone ||
              r.phone.includes(c.phone) ||
              c.phone.includes(r.phone))
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone ?? '',
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      captureSharesToJourney(
        selectedContacts
          .filter((_, i) => resultsMap[i].status === 'sent')
          .map((c) => c.id),
      );

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

      const bodyText = `🏠 *${property.title}*\n💰 Price: ${formattedPrice}\n📍 Location: ${property.sublocality || (isLocationGuarded(property) ? localityLabel(property) : property.location)}`;

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
            c.phone !== null &&
            (r.phone === c.phone ||
              r.phone.includes(c.phone) ||
              c.phone.includes(r.phone))
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone ?? '',
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      captureSharesToJourney(
        selectedContacts
          .filter((_, i) => resultsMap[i].status === 'sent')
          .map((c) => c.id),
      );

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
            c.phone !== null &&
            (r.phone === c.phone ||
              r.phone.includes(c.phone) ||
              c.phone.includes(r.phone))
        );
        return {
          name: c.name || 'Unknown',
          phone: c.phone ?? '',
          status: (matchResult?.status || 'failed') as 'sent' | 'failed',
          error: matchResult?.error || (matchResult?.status === 'failed' ? 'Delivery failure' : undefined),
        };
      });

      captureSharesToJourney(
        selectedContacts
          .filter((_, i) => resultsMap[i].status === 'sent')
          .map((c) => c.id),
      );

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

        {/* STEP 0: compose & share externally, or hand off to Engine flows */}
        {broadcastStep === 'link' && (
          <div className="space-y-4 flex flex-col flex-1 min-h-0">
            {/* Audience tabs — the first decision is WHO this goes to */}
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {([
                { key: 'client', label: 'To Client', desc: 'Showcase page with inquiry form', icon: User },
                { key: 'agent', label: 'To Co-Broker', desc: 'Clean page, no inquiry forms', icon: Handshake },
                { key: 'engine', label: 'Send from Engine', desc: 'Templates · greeting · catalog', icon: Megaphone },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setAudienceTab(tab.key)}
                  className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 transition-all ${
                    audienceTab === tab.key
                      ? 'bg-primary/15 text-primary border border-primary/40'
                      : 'text-slate-400 hover:text-white border border-transparent'
                  }`}
                >
                  <tab.icon className="size-4" />
                  <span className="text-xs font-bold">{tab.label}</span>
                  <span className="text-[9px] text-slate-500 hidden sm:block">{tab.desc}</span>
                </button>
              ))}
            </div>

            {audienceTab !== 'engine' && (
              <div className="bg-slate-950/20 border border-slate-850 p-4 rounded-xl space-y-4">
                <p className="text-xs text-slate-400">
                  {audienceTab === 'agent'
                    ? 'Message for fellow agents — the link opens a clean detail page (full specs, photos, map — no inquiry forms), so they can present it to their clients independently.'
                    : 'Message for a buyer/client — the link opens your public showcase page with photos, map, and an inquiry form.'}
                </p>

                {/* Tone (client only) */}
                {audienceTab === 'client' && (
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-[11px] font-semibold">Tone</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'professional', label: 'Professional', icon: '💼' },
                        { value: 'casual', label: 'Casual', icon: '👋' },
                        { value: 'friendly', label: 'Friendly', icon: '😊' },
                      ].map((style) => (
                        <button
                          key={style.value}
                          type="button"
                          onClick={() => setMessageStyle(style.value as ShareTone)}
                          className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-[10px] font-medium transition-all ${
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
                )}

                {/* Detail level */}
                <div className="space-y-2">
                  <Label className="text-slate-300 text-[11px] font-semibold">How much detail?</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'quick', label: 'Quick', hint: 'Title + price + link' },
                      { value: 'standard', label: 'Standard', hint: 'Headline specs + link' },
                      { value: 'complete', label: 'Complete', hint: 'Everything in the message' },
                    ] as const).map((lvl) => (
                      <button
                        key={lvl.value}
                        type="button"
                        onClick={() => setDetailLevel(lvl.value)}
                        className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border transition-all ${
                          detailLevel === lvl.value
                            ? 'bg-primary/10 border-primary/50 text-primary'
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        <span className="text-[11px] font-bold">{lvl.label}</span>
                        <span className="text-[9px] text-slate-500">{lvl.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Editable message */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 text-[11px] font-semibold">Message — tap to edit</Label>
                    {messageDraft !== null ? (
                      <button
                        type="button"
                        onClick={() => setMessageDraft(null)}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        <RotateCcw className="size-3" />
                        Reset edits
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500">Auto-generated from the listing</span>
                    )}
                  </div>
                  <textarea
                    value={currentMessage}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    rows={detailLevel === 'complete' ? 12 : 7}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 resize-y focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                  />
                </div>

                {/* Unmask this share */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-center gap-1.5">
                    <Lock className="size-3.5 text-amber-500" />
                    <Label className="text-slate-300 text-[11px] font-semibold">
                      Unmask this share
                    </Label>
                    {grantBusy && <Loader2 className="size-3 animate-spin text-slate-500" />}
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Off by default — the masked link is what turns a viewer into a
                    captured lead. Switch any on and this link opens unmasked, with
                    no request to approve. It expires on its own and you can revoke
                    it at any time.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      {
                        key: 'location' as const,
                        icon: MapPin,
                        label: 'Exact location & map pin',
                        on: revealLocation,
                        toggle: () => setRevealLocation((v) => !v),
                        disabledHint: null,
                      },
                      {
                        key: 'documents' as const,
                        icon: FileText,
                        label:
                          propertyDocumentCount > 0
                            ? `Documents (${propertyDocumentCount})`
                            : 'Documents',
                        on: revealDocuments,
                        toggle: () => setRevealDocuments((v) => !v),
                        disabledHint:
                          propertyDocumentCount === 0 ? 'None uploaded' : null,
                      },
                      {
                        key: 'privateImages' as const,
                        icon: ImageIcon,
                        label:
                          propertyPrivateImageCount > 0
                            ? `Guarded photos (${propertyPrivateImageCount})`
                            : 'Guarded photos',
                        on: revealPrivateImages,
                        toggle: () => setRevealPrivateImages((v) => !v),
                        disabledHint:
                          propertyPrivateImageCount === 0 ? 'None marked' : null,
                      },
                    ]).map((sw) => (
                      <button
                        key={sw.key}
                        type="button"
                        disabled={
                          Boolean(sw.disabledHint) || grantBusy || !canManageGrants
                        }
                        onClick={sw.toggle}
                        className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                          sw.on
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {sw.on ? (
                          <CheckSquare className="size-4 shrink-0" />
                        ) : (
                          <Square className="size-4 shrink-0" />
                        )}
                        <sw.icon className="size-3.5 shrink-0" />
                        <span className="text-[11px] font-semibold truncate">
                          {sw.disabledHint ? `${sw.label} — ${sw.disabledHint}` : sw.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  {/* Expiry — chosen before the key is minted; changing it
                      revokes the old key and issues a fresh one. */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                      Expires after
                    </span>
                    <div className="flex gap-1">
                      {SHARE_GRANT_TTL_CHOICES.map((choice) => (
                        <button
                          key={choice.key}
                          type="button"
                          disabled={grantBusy || !canManageGrants}
                          onClick={() => setGrantTtl(choice.key)}
                          className={`rounded-md border px-2 py-1 text-[10px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                            grantTtl === choice.key
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
                          }`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {grantToken && (
                    <p className="text-[10px] font-medium text-emerald-400">
                      This link is unmasked. Sending it to a contact below gives them
                      their own key, revocable on its own.
                    </p>
                  )}

                  {/* Live keys on this listing — including any minted in an
                      earlier session, so nothing stays unmasked unnoticed. */}
                  {activeGrants && activeGrants.length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-800 pt-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Active unmasked links ({activeGrants.length})
                      </p>
                      {activeGrants.map((g) => {
                        const reveals = [
                          g.reveal_location && 'location',
                          g.reveal_documents && 'documents',
                          g.reveal_private_images && 'photos',
                        ].filter(Boolean) as string[];
                        const isCurrent = linkGrant?.id === g.id;
                        return (
                          <div
                            key={g.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <p className="flex items-center gap-1.5 truncate text-[11px] font-bold text-white">
                                <span className="truncate">
                                  {g.contact
                                    ? g.contact.name || g.contact.phone
                                    : 'Generic link'}
                                </span>
                                {isCurrent && (
                                  <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold text-emerald-400">
                                    THIS SHARE
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-[9px] font-medium text-slate-500">
                                {reveals.join(' · ')} · expires{' '}
                                {formatDistanceToNowStrict(new Date(g.expires_at), {
                                  addSuffix: true,
                                })}
                                {g.view_count > 0
                                  ? ` · ${g.view_count} open${g.view_count > 1 ? 's' : ''}`
                                  : ' · not opened yet'}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={revokingGrantId !== null || !canManageGrants}
                              onClick={() => void handleRevokeGrant(g)}
                              className="h-7 shrink-0 border-rose-900/60 px-2 text-[10px] font-bold text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
                            >
                              {revokingGrantId === g.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Ban className="size-3" />
                              )}
                              Revoke
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Link + copy */}
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl}
                    className="bg-slate-800/50 border-slate-700 text-xs h-9 text-slate-300 select-all font-mono flex-1"
                  />
                  <Button
                    onClick={async () => {
                      await navigator.clipboard.writeText(audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl);
                      setCopiedLink(true);
                      toast.success('Link copied!');
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    variant="outline"
                    className="border-slate-700 hover:bg-slate-800 text-slate-300 text-xs h-9 px-3 shrink-0 flex items-center gap-1.5"
                  >
                    {copiedLink ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    Link
                  </Button>
                  <Button
                    onClick={() => window.open(audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl, '_blank')}
                    variant="outline"
                    className="border-slate-700 hover:bg-slate-800 text-slate-300 text-xs h-9 px-3 shrink-0 flex items-center gap-1.5"
                  >
                    <ExternalLink className="size-3.5" />
                    Preview
                  </Button>
                </div>

                {/* Direct share targets */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-slate-300 text-[11px] font-semibold">Send via</Label>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <ImageIcon className="size-3" />
                      Cover photo attaches on mobile; on desktop the link preview shows it — or use Copy Photo.
                    </span>
                  </div>
                  {(() => {
                    const activeUrl = audienceTab === 'agent' ? agentShowcaseUrl : showcaseUrl;
                    const targets = buildShareTargets(currentMessage, activeUrl, property.title || 'Property Details');
                    return (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={sharingWhatsApp}
                          onClick={async () => {
                            // On mobile, send photo + caption through the native
                            // sheet so the cover image lands inside the WhatsApp
                            // message. On desktop go straight to wa.me — the OS
                            // share sheet has no WhatsApp target, and the link
                            // preview (OG image) still shows the photo.
                            setSharingWhatsApp(true);
                            // Journey capture for the native path: there's no
                            // delivery receipt here, so only attribute the share
                            // when the dialog was opened FOR a specific client
                            // (contact panel → Share Listing). A generic share
                            // could go to anyone — guessing would pollute maps.
                            const captureNativeShare = () => {
                              if (audienceTab === 'client' && preSelectedContactId) {
                                captureSharesToJourney([preSelectedContactId]);
                              }
                            };
                            try {
                              const file = isMobileSharePlatform() ? await fetchCoverImageFile() : null;
                              if (
                                file &&
                                typeof navigator !== 'undefined' &&
                                'canShare' in navigator &&
                                navigator.canShare({ files: [file] })
                              ) {
                                try {
                                  await navigator.share({
                                    files: [file],
                                    text: currentMessage,
                                    title: property.title || 'Property Details',
                                  });
                                  captureNativeShare();
                                  return;
                                } catch (err) {
                                  // Abort = user closed the share sheet without
                                  // sending — nothing to capture.
                                  if ((err as Error).name === 'AbortError') return;
                                }
                              }
                              window.open(targets.whatsapp, '_blank', 'noopener');
                              captureNativeShare();
                            } finally {
                              setSharingWhatsApp(false);
                            }
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          {sharingWhatsApp ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                          WhatsApp
                        </Button>
                        <Button
                          onClick={() => window.open(targets.telegram, '_blank', 'noopener')}
                          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          <Send className="size-3.5" />
                          Telegram
                        </Button>
                        <Button
                          onClick={() => { window.location.href = targets.email; }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          <Mail className="size-3.5" />
                          Email
                        </Button>
                        <Button
                          onClick={() => { window.location.href = targets.sms; }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          <Smartphone className="size-3.5" />
                          SMS
                        </Button>
                        <Button
                          onClick={async () => {
                            await navigator.clipboard.writeText(currentMessage);
                            setCopiedMessage(true);
                            toast.success('Message + link copied! Paste it in any app.');
                            setTimeout(() => setCopiedMessage(false), 2000);
                          }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          {copiedMessage ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copiedMessage ? 'Copied!' : 'Copy Message'}
                        </Button>
                        <Button
                          disabled={copyingPhoto}
                          onClick={async () => {
                            // Clipboard images must be PNG in Chromium — convert
                            // the (usually JPEG) cover photo via canvas first.
                            // Photoless listings fall back to a branded flyer.
                            setCopyingPhoto(true);
                            try {
                              const file = await fetchCoverImageFile();
                              if (!file) {
                                toast.error('Could not prepare a photo for this listing.');
                                return;
                              }
                              const bitmap = await createImageBitmap(file);
                              const canvas = document.createElement('canvas');
                              canvas.width = bitmap.width;
                              canvas.height = bitmap.height;
                              canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
                              const pngBlob = await new Promise<Blob>((resolve, reject) =>
                                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('convert failed'))), 'image/png')
                              );
                              await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                              toast.success('Photo copied — paste it into the chat with Ctrl/Cmd+V.');
                            } catch {
                              toast.error('Could not copy the photo — your browser may not support image clipboard.');
                            } finally {
                              setCopyingPhoto(false);
                            }
                          }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          {copyingPhoto ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                          Copy Photo
                        </Button>
                        <Button
                          onClick={async () => {
                            const shareData: ShareData = {
                              title: property.title || 'Property Details',
                              text: currentMessage,
                            };
                            // Attach the cover photo when the platform supports file sharing.
                            const file = await fetchCoverImageFile();
                            if (
                              file &&
                              typeof navigator !== 'undefined' &&
                              'canShare' in navigator &&
                              navigator.canShare({ files: [file] })
                            ) {
                              shareData.files = [file];
                            }
                            if (typeof navigator !== 'undefined' && navigator.share) {
                              try {
                                await navigator.share(shareData);
                              } catch (err) {
                                if ((err as Error).name !== 'AbortError') {
                                  if (shareData.files) {
                                    try {
                                      await navigator.share({ title: shareData.title, text: shareData.text });
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
                              await navigator.clipboard.writeText(currentMessage);
                              toast.success('Copied! Your browser does not support native sharing.');
                            }
                          }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                        >
                          <Share2 className="size-3.5" />
                          More apps…
                        </Button>
                        {onPromote && (
                          <Button
                            onClick={() => {
                              onOpenChange(false);
                              if (property) onPromote(property);
                            }}
                            title="Run a Click-to-WhatsApp Meta ad for this listing — clicks open a WhatsApp chat with you"
                            className="bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-700 hover:to-violet-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
                          >
                            <Megaphone className="size-3.5" />
                            Promote as WhatsApp Ad
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {!property.is_published && audienceTab === 'client' && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-[11px] text-amber-400 flex items-start gap-2">
                    <span className="text-xs">⚠️</span>
                    <div>
                      <span className="font-bold block">Listing is Private / Unpublished</span>
                      To allow public visitors to view this showcase page, make sure the property is set to <strong>Published</strong> on the inventory page.
                    </div>
                  </div>
                )}

                {/* Send personally — per-contact tracked links */}
                <div className="space-y-2.5 pt-3 border-t border-slate-800">
                  <Label className="text-slate-300 text-[11px] font-semibold flex items-center gap-1.5">
                    <UserCheck className="size-3.5 text-primary" />
                    Send personally (tracked)
                  </Label>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {audienceTab === 'agent' ? (
                      <>Registered ConvoReal agents can receive the listing directly in their review queue. Approval adds it to their inventory with your source attribution intact.</>
                    ) : (
                      <>Each contact gets this same message with their own link, so every open, photo
                      swipe, and map click shows up <strong className="text-slate-400">by name</strong> in
                      Showcase Pulse — no more Anonymous Guests.</>
                    )}
                  </p>

                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search contacts by name or phone..."
                      value={personalSearch}
                      onChange={(e) => setPersonalSearch(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-7 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {personalSearch && (
                      <button
                        type="button"
                        onClick={() => setPersonalSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>

                  {loadingContacts && contacts.length === 0 ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-10 rounded-lg bg-slate-900 animate-pulse" />
                      ))}
                    </div>
                  ) : personalContacts.length === 0 ? (
                    <p className="py-3 text-center text-xs font-medium text-slate-500">
                      {contacts.length === 0 ? 'No active contacts yet' : 'No matching contacts found'}
                    </p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin scrollbar-thumb-slate-800">
                      {personalContacts.slice(0, 50).map((contact) => (
                        <div
                          key={contact.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                              <span className="truncate">{contact.name || contact.phone}</span>
                              <NameTagBadge tag={contact.name_tag} />
                            </span>
                            {contact.name && (
                              <span className="text-[10px] text-slate-500 font-medium truncate block">
                                📞 {contact.phone}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {audienceTab === 'agent' && contact.classification === 'Agent' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={inventorySharingContactId !== null}
                                onClick={() => void handleInventoryShare(contact)}
                                title="Add to this agent's ConvoReal review queue"
                                className="h-7 px-2.5 text-[11px] border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary flex items-center gap-1"
                              >
                                {inventorySharingContactId === contact.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <FolderInput className="size-3" />
                                )}
                                Inventory
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => handleWhatsAppPersonal(contact)}
                              className="h-7 px-2.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"
                            >
                              <Smartphone className="size-3" />
                              WhatsApp
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleCopyPersonal(contact)}
                              title="Copy the personalised message + tracked link"
                              className="h-7 px-2 text-[11px] border-slate-800 hover:bg-slate-800 text-slate-350 flex items-center gap-1"
                            >
                              {copiedPersonalId === contact.id ? (
                                <Check className="size-3 text-emerald-400" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                      {personalContacts.length > 50 && (
                        <p className="pt-1 text-center text-[10px] font-medium text-slate-500">
                          Showing first 50 — refine the search to find others
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {audienceTab === 'engine' && (
              <>
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                👋 Send Interactive Greeting First
              </h3>
              <p className="text-xs text-slate-400">
                Sends a welcome greeting with quick reply buttons first. If the contact clicks <strong className="text-primary font-semibold">&quot;Sure, please send&quot;</strong>, the Engine will automatically share the full property details.
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
              </>
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

            {/* One click: everyone who engaged with another listing.
              Matching answers who fits this property; this answers who
              already asked about a comparable one. */}
            <ListingAudiencePicker
              accountId={accountId}
              loadedContacts={contacts}
              onSelect={addContactsToSelection}
            />

            {appliedAudience && (
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5">
                <UserCheck className="size-4 shrink-0 text-primary mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">
                    {appliedAudience.ids.length} contact{appliedAudience.ids.length === 1 ? '' : 's'} from{' '}
                    {audienceListingLabel(appliedAudience.listing)} selected
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Everyone who enquired about or viewed that listing is ticked below.
                    {appliedAudience.unreachable > 0 &&
                      ` ${appliedAudience.unreachable} skipped — no WhatsApp number.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={undoAppliedAudience}
                  className="shrink-0 cursor-pointer text-[11px] font-bold text-primary hover:text-primary/80"
                >
                  Undo
                </button>
              </div>
            )}

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
                <div className="inline-flex items-center bg-slate-900 border border-slate-800 rounded p-0.5">
                  {(
                    [
                      { key: 'buyers', label: 'Buyers' },
                      { key: 'agents', label: 'Agents' },
                      { key: 'all', label: 'All' },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleAudienceChange(key)}
                      className={`px-2 py-0.5 rounded text-xs cursor-pointer transition-all ${
                        matchAudience === key
                          ? 'bg-primary/15 text-primary font-bold'
                          : 'text-slate-450 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
                        Try a different name or phone number{matchAudience !== 'all' ? ', switch the audience to "All" above,' : ''} or add a fresh contact inline to share.
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
                displayedContacts.map(({ contact: c, score, details }) => (
                  <MatchTargetRow
                    key={c.id}
                    name={c.name || 'Unnamed'}
                    detail={c.phone}
                    inquiries={(inquiriesByContact.get(c.id) ?? []).map(
                      inquiredPropertyLabel
                    )}
                    scoreLabel={`${score}% Match`}
                    tone={score >= 70 ? 'strong' : score >= 30 ? 'fair' : 'weak'}
                    badges={
                      <>
                        <NameTagBadge tag={c.name_tag} />
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.2 text-[9px] font-bold shrink-0 ${c.classification === 'Buyer'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                            }`}
                        >
                          {c.classification}
                        </span>
                      </>
                    }
                    chips={score > 0 ? <MatchDetailChips details={details} /> : null}
                    selected={selectedContactIds.includes(c.id)}
                    onToggle={() => toggleContactSelection(c.id)}
                  />
                ))
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
                      className="border-slate-800 hover:bg-slate-800 text-slate-300 text-xs h-9 flex items-center gap-1"
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
                      {t.category && t.category !== 'Utility' ? ` — ${t.category}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedTemplate &&
                selectedTemplate.category &&
                selectedTemplate.category !== 'Utility' && (
                  <p className="text-[11px] text-amber-400">
                    {selectedTemplate.category} templates are capped per
                    recipient — WhatsApp drops the send with error 131049 for
                    anyone at their limit. A Utility template reaches everyone.
                  </p>
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
                          src={storagePublicUrl(imgUrl)}
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
                                const guarded = isLocationGuarded(property);
                                const locVal =
                                  property.sublocality ||
                                  (guarded ? localityLabel(property) : property.location) ||
                                  `[Location]`;
                                val =
                                  property.google_map_link && !guarded
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
