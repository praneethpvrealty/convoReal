'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Share2, Copy, Check, ExternalLink, MessageCircle, Search, Smartphone, UserCheck, X } from 'lucide-react';
import type { ShowcaseSettings } from '@/types';

interface PickerContact {
  id: string;
  name: string | null;
  phone: string;
}

interface ShowcaseShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  showcaseSettings: ShowcaseSettings | null;
  activeSearch?: string;
}

function getBaseHost() {
  if (typeof window === 'undefined') return '';
  const host = window.location.host;
  const parts = host.split('.');
  
  // If it's localhost or IP address or simple domain
  if (parts.length <= 2 || host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return host;
  }
  
  // Strip first part if there are 3 parts (e.g. app.convoreal.com -> convoreal.com)
  return parts.slice(1).join('.');
}

export function ShowcaseShareDialog({
  open,
  onOpenChange,
  accountId,
  showcaseSettings,
  activeSearch,
}: ShowcaseShareDialogProps) {
  const [shareCategory, setShareCategory] = useState<'All' | 'Residential' | 'Commercial' | 'Agricultural'>('All');
  const [copied, setCopied] = useState(false);
  const [copiedWithMessage, setCopiedWithMessage] = useState(false);
  const [includeSearch, setIncludeSearch] = useState(true);

  // "Send personally" picker — each contact gets a link tagged with
  // ?v=<contactId> so their showcase activity shows up by name in Pulse.
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [copiedContactId, setCopiedContactId] = useState<string | null>(null);

  const defaultPassionateMessage = `Hi {name}! 👋

I've curated an exclusive property showcase just for you. Browse through handpicked listings and find the one that feels right.

Explore the full showcase here:
{portalUrl}

If any property catches your eye, I'd be happy to help with details, schedule a site visit, or negotiate the best deal on your behalf. Let's find your perfect property together!

Best regards`;


  const [passionateMessage, setPassionateMessage] = useState(defaultPassionateMessage);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    // Microtask defer keeps the synchronous loading-flag setter out of
    // the effect body (react-hooks/set-state-in-effect) — same pattern
    // as the Today page loaders.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoadingContacts(true);
      const db = createClient();
      void db
        .from('contacts')
        .select('id, name, phone')
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

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(
      (c) => (c.name || '').toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [contacts, contactSearch]);

  const generatedLink = useMemo(() => {
    if (typeof window === 'undefined') return '';

    let targetDomain = window.location.host;
    let isSubdomainUsed = false;

    if (showcaseSettings?.subdomain) {
      const baseDomain = getBaseHost();
      targetDomain = `${showcaseSettings.subdomain}.${baseDomain}`;
      isSubdomainUsed = true;
    }

    const protocol = window.location.protocol;
    const urlObj = new URL(`${protocol}//${targetDomain}`);

    // If no subdomain is configured, we must append the ref parameter so page.tsx can resolve the account showcase page
    if (!isSubdomainUsed && accountId) {
      urlObj.searchParams.set('ref', accountId);
    }

    // Add category filter if selected (and not 'All')
    if (shareCategory !== 'All') {
      urlObj.searchParams.set('category', shareCategory);
    }

    if (includeSearch && activeSearch?.trim()) {
      urlObj.searchParams.set('search', activeSearch.trim());
    }

    return urlObj.toString();
  }, [accountId, shareCategory, showcaseSettings, includeSearch, activeSearch]);

  /** Same portal link, tagged with the contact so Pulse events carry
   *  their identity (`v=` is read by the showcase tracker, never used
   *  to filter the catalog). */
  const personalizedLink = (contactId: string) => {
    if (!generatedLink) return '';
    const url = new URL(generatedLink);
    url.searchParams.set('v', contactId);
    return url.toString();
  };

  const buildMessage = (link: string, name?: string | null) =>
    passionateMessage
      .replaceAll('{portalUrl}', link)
      .replaceAll('{name}', name?.trim().split(/\s+/)[0] || 'there');

  const handleCopyPersonalLink = async (contact: PickerContact) => {
    try {
      await navigator.clipboard.writeText(
        buildMessage(personalizedLink(contact.id), contact.name),
      );
      setCopiedContactId(contact.id);
      toast.success(`Personal message for ${contact.name || contact.phone} copied!`);
      setTimeout(() => setCopiedContactId(null), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
      console.error(err);
    }
  };

  const handleWhatsAppPersonal = (contact: PickerContact) => {
    const message = buildMessage(personalizedLink(contact.id), contact.name);
    const phone = contact.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

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

  const handleViewShowcase = () => {
    window.open(generatedLink, '_blank');
  };

  const handleCopyWithMessage = async () => {
    try {
      const messageWithLink = buildMessage(generatedLink);
      await navigator.clipboard.writeText(messageWithLink);
      setCopiedWithMessage(true);
      toast.success('Message with showcase link copied to clipboard!');
      setTimeout(() => setCopiedWithMessage(false), 2000);
    } catch (err) {
      toast.error('Failed to copy message');
      console.error(err);
    }
  };

  const handleShareMessage = async () => {
    try {
      const messageWithLink = buildMessage(generatedLink);
      if (navigator.share) {
        await navigator.share({
          title: 'Property Showcase',
          text: messageWithLink,
        });
      } else {
        await navigator.clipboard.writeText(messageWithLink);
        toast.success('Message copied to clipboard!');
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Failed to share');
        console.error(err);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-800 pb-3 mb-2">
          <DialogTitle className="text-white flex items-center gap-2 text-lg font-black tracking-tight">
            <Share2 className="size-5 text-primary" />
            Share Showcase Portal
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Generate and copy the public URL to share your listings with clients.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Category Filter Options */}
          <div className="space-y-2">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider">
              Filter by Category
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['All', 'Residential', 'Commercial', 'Agricultural'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setShareCategory(cat)}
                  className={`text-xs px-2.5 py-2 rounded-lg border transition-all cursor-pointer font-semibold text-center select-none ${
                    shareCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary font-bold shadow-md shadow-primary/20'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {cat === 'All' ? 'All Properties' : cat}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 font-medium">
              Selecting a category will automatically apply the filter when the customer opens the link.
            </p>
          </div>

          {/* Active Search Filter Checkbox */}
          {activeSearch?.trim() && (
            <div className="flex items-center gap-2.5 p-3 bg-slate-950/20 border border-slate-900 rounded-xl relative z-10">
              <input
                type="checkbox"
                id="include-search"
                checked={includeSearch}
                onChange={(e) => setIncludeSearch(e.target.checked)}
                className="size-4 border-slate-800 rounded text-primary focus:ring-primary/20 bg-slate-950 cursor-pointer"
              />
              <label htmlFor="include-search" className="text-xs font-bold text-slate-350 cursor-pointer select-none">
                Include active search query: <span className="text-primary italic font-black">&quot;{activeSearch}&quot;</span>
              </label>
            </div>
          )}

          {/* Generated Link Input */}
          <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider block">
              🔗 Showcase Portal URL
            </Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={generatedLink}
                className="bg-slate-900 border-slate-800 text-xs h-9 text-slate-200 select-all font-mono"
              />
              <Button
                onClick={handleCopyLink}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 px-3 shrink-0 flex items-center gap-1"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="outline"
                onClick={handleViewShowcase}
                className="border-slate-800 hover:bg-slate-800 text-slate-350 text-xs h-9 px-3 shrink-0 flex items-center gap-1"
              >
                <ExternalLink className="size-3.5" />
                View
              </Button>
            </div>
          </div>

          {/* Passionate Share Message */}
          <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider block flex items-center gap-2">
              <MessageCircle className="size-3.5 text-emerald-400" />
              Share with the message
            </Label>
            <Textarea
              value={passionateMessage}
              onChange={(e) => setPassionateMessage(e.target.value)}
              placeholder="Write a passionate message to share with your customers..."
              className="bg-slate-900 border-slate-800 text-xs text-slate-200 min-h-[120px] resize-none"
            />
            <p className="text-[10px] text-slate-500">
              Use <code className="bg-slate-950 px-1 py-0.5 rounded text-primary">{'{portalUrl}'}</code> for the showcase link and <code className="bg-slate-950 px-1 py-0.5 rounded text-primary">{'{name}'}</code> for the contact&apos;s first name. Both are replaced when copied or sent.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleCopyWithMessage}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 flex items-center justify-center gap-2"
              >
                {copiedWithMessage ? (
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
                onClick={handleShareMessage}
                variant="outline"
                className="border-emerald-600 hover:bg-emerald-600/20 text-emerald-400 font-semibold text-xs py-2.5 px-4 flex items-center justify-center gap-2"
              >
                <Share2 className="size-3.5" />
                Share
              </Button>
            </div>
          </div>

          {/* Send personally — per-contact tracked links */}
          <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider block flex items-center gap-2">
              <UserCheck className="size-3.5 text-primary" />
              Send personally (tracked)
            </Label>
            <p className="text-[11px] text-slate-500 font-medium">
              Each contact gets their own link, so every open, photo swipe, and map click shows up
              <strong className="text-slate-400"> by name</strong> in Showcase Pulse — no more Anonymous Guests.
            </p>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search contacts by name or phone..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-7 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {contactSearch && (
                <button
                  type="button"
                  onClick={() => setContactSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {loadingContacts ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-slate-900 animate-pulse" />
                ))}
              </div>
            ) : filteredContacts.length === 0 ? (
              <p className="py-4 text-center text-xs font-medium text-slate-500">
                {contacts.length === 0 ? 'No active contacts yet' : 'No matching contacts found'}
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin scrollbar-thumb-slate-800">
                {filteredContacts.slice(0, 50).map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white truncate block">
                        {contact.name || contact.phone}
                      </span>
                      {contact.name && (
                        <span className="text-[10px] text-slate-500 font-medium truncate block">
                          📞 {contact.phone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
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
                        onClick={() => void handleCopyPersonalLink(contact)}
                        className="h-7 px-2 text-[11px] border-slate-800 hover:bg-slate-800 text-slate-350 flex items-center gap-1"
                      >
                        {copiedContactId === contact.id ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
                {filteredContacts.length > 50 && (
                  <p className="pt-1 text-center text-[10px] font-medium text-slate-500">
                    Showing first 50 — refine the search to find others
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

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
      </DialogContent>
    </Dialog>
  );
}
