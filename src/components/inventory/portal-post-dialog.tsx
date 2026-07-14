'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Trash2,
  Download,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PORTALS,
  PORTAL_KEYS,
  buildPortalFields,
  type PortalKey,
} from '@/lib/portals/post-kit';

interface PortalListingRow {
  id: string;
  portal: PortalKey;
  listing_url: string | null;
  posted_at: string;
  expires_on: string | null;
  status: 'active' | 'expired' | 'removed';
}

interface PortalPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
  currency?: string;
  onSaved?: () => void;
}

function defaultExpiryDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().substring(0, 10);
}

/** Copy-paste assistant for posting a listing on 99acres /
 *  MagicBricks / Housing (no public posting APIs exist): fields in
 *  the portal's own order and limits, photo downloads, a deep link
 *  to the post form, and posted/expiry tracking per portal. */
export function PortalPostDialog({ open, onOpenChange, property, currency = 'INR', onSaved }: PortalPostDialogProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [activePortal, setActivePortal] = useState<PortalKey>('99acres');
  const [listings, setListings] = useState<PortalListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);
  const [showMarkForm, setShowMarkForm] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formExpiry, setFormExpiry] = useState(defaultExpiryDate());
  // Chrome-extension bridge (extension/portal-autofill): detected via a
  // ping/pong handshake over window.postMessage; "Send to Extension"
  // hands the listing payload to the portal-side autofill panel.
  const [extensionDetected, setExtensionDetected] = useState(false);

  const fetchListings = useCallback(async () => {
    if (!property || !accountId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('property_portal_listings')
        .select('id, portal, listing_url, posted_at, expires_on, status')
        .eq('account_id', accountId)
        .eq('property_id', property.id);
      if (error) throw error;
      setListings((data || []) as PortalListingRow[]);
    } catch {
      // Table missing (migration 121 not applied) — dialog still works
      // as a pure copy-paste kit, just without posted-tracking.
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, property, accountId]);

  useEffect(() => {
    if (open) {
      setActivePortal('99acres');
      setShowMarkForm(false);
      setFormUrl('');
      setFormExpiry(defaultExpiryDate());
      fetchListings();
    }
  }, [open, fetchListings]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; propertyTitle?: string } | null;
      if (data?.type === 'CONVOREAL_PORTAL_EXT_PONG') {
        setExtensionDetected(true);
      } else if (data?.type === 'CONVOREAL_PORTAL_PAYLOAD_SAVED') {
        toast.success('Sent to the extension — open the portal tab and use the Autofill panel.');
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'CONVOREAL_PORTAL_EXT_PING' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  const sendToExtension = () => {
    if (!property) return;
    const portals = Object.fromEntries(
      PORTAL_KEYS.map((key) => [key, buildPortalFields(property, key, currency)])
    );
    window.postMessage(
      {
        type: 'CONVOREAL_PORTAL_PAYLOAD',
        payload: {
          propertyId: property.id,
          title: property.title,
          portals,
          photos: (property.images || []).filter((img) => img.trim().length > 0),
        },
      },
      window.location.origin
    );
  };

  const activeListing = listings.find((l) => l.portal === activePortal && l.status === 'active') || null;
  const meta = PORTALS[activePortal];

  const fields = useMemo(
    () => (property ? buildPortalFields(property, activePortal, currency) : []),
    [property, activePortal, currency]
  );

  const images = useMemo(
    () => (property?.images || []).filter((img) => img.trim().length > 0),
    [property]
  );

  const copyField = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const copyAll = async () => {
    const all = fields.map((f) => `${f.label}:\n${f.value}`).join('\n\n');
    await navigator.clipboard.writeText(all);
    toast.success('All fields copied — paste anywhere as a reference.');
  };

  const downloadPhoto = async (url: string, idx: number) => {
    setDownloadingIdx(idx);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${property?.property_code || 'property'}-photo-${idx + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error('Photo download failed — open it in a new tab instead.');
    } finally {
      setDownloadingIdx(null);
    }
  };

  const markPosted = async () => {
    if (!property || !accountId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('property_portal_listings').upsert(
        {
          account_id: accountId,
          property_id: property.id,
          user_id: user?.id || null,
          portal: activePortal,
          listing_url: formUrl.trim() || null,
          expires_on: formExpiry || null,
          status: 'active',
          expiry_reminder_sent: false,
          posted_at: new Date().toISOString(),
        },
        { onConflict: 'property_id,portal' }
      );
      if (error) throw error;
      toast.success(`Marked as posted on ${meta.label}. Expiry reminder is set.`);
      setShowMarkForm(false);
      fetchListings();
      onSaved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      toast.error(msg.includes('property_portal_listings') ? 'Run migration 121 to enable portal tracking.' : msg);
    } finally {
      setSaving(false);
    }
  };

  const markRemoved = async () => {
    if (!activeListing) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('property_portal_listings')
        .update({ status: 'removed' })
        .eq('id', activeListing.id);
      if (error) throw error;
      toast.success(`Marked as removed from ${meta.label}.`);
      fetchListings();
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  if (!property) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b border-slate-800 pb-3 mb-2">
          <DialogTitle className="text-white flex items-center gap-2 text-lg font-black tracking-tight">
            <Globe className="size-5 text-primary" />
            Post to Property Portals
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            The portals have no posting APIs — this kit preps every field in the portal&apos;s own format so posting
            &quot;{property.title}&quot; takes minutes, then tracks where it&apos;s live.
          </DialogDescription>
        </DialogHeader>

        {/* Portal tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
          {PORTAL_KEYS.map((key) => {
            const p = PORTALS[key];
            const posted = listings.some((l) => l.portal === key && l.status === 'active');
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActivePortal(key);
                  setShowMarkForm(false);
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-all border',
                  activePortal === key
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'text-slate-400 hover:text-white border-transparent'
                )}
              >
                {p.label}
                {posted && <CheckCircle2 className="size-3.5 text-emerald-400" />}
              </button>
            );
          })}
        </div>

        {/* Posted status */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
            <Loader2 className="size-3.5 animate-spin" /> Checking posted status…
          </div>
        ) : activeListing ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="text-xs text-emerald-300 flex items-center gap-2 min-w-0">
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="min-w-0">
                Live on {meta.label} since{' '}
                {new Date(activeListing.posted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {activeListing.expires_on && (
                  <>
                    {' '}· expires{' '}
                    {new Date(`${activeListing.expires_on}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </>
                )}
                {activeListing.listing_url && (
                  <a
                    href={activeListing.listing_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 underline decoration-emerald-500/50 hover:text-white"
                  >
                    View listing
                  </a>
                )}
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormUrl(activeListing.listing_url || '');
                  setFormExpiry(activeListing.expires_on || defaultExpiryDate());
                  setShowMarkForm(true);
                }}
                className="h-7 border-slate-800 text-xs text-slate-300 hover:bg-slate-850"
              >
                Update
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={markRemoved}
                className="h-7 border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/10"
              >
                <Trash2 className="size-3 mr-1" />
                Mark Removed
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <span className="text-xs text-slate-400">Not posted on {meta.label} yet.</span>
            <div className="flex gap-2">
              <Button
                onClick={() => window.open(meta.postUrl, '_blank', 'noopener')}
                className="h-7 bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-3 flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                Open {meta.label} Post Form
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowMarkForm(true)}
                className="h-7 border-slate-800 text-xs text-slate-300 hover:bg-slate-850 flex items-center gap-1"
              >
                <CheckCircle2 className="size-3" />
                Mark as Posted
              </Button>
            </div>
          </div>
        )}

        {/* Browser-extension autofill */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
            <span
              className={cn(
                'h-2 w-2 rounded-full shrink-0',
                extensionDetected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600'
              )}
            />
            {extensionDetected ? (
              <span>
                Autofill extension detected — send this listing, then click <strong className="text-slate-200">Autofill</strong> in
                the floating panel on the portal page.
              </span>
            ) : (
              <span>
                Autofill extension not detected. Install once from{' '}
                <code className="text-slate-300 bg-slate-900 px-1 rounded">extension/portal-autofill</code> (chrome://extensions →
                Load unpacked) to fill portal forms in one click.
              </span>
            )}
          </div>
          <Button
            disabled={!extensionDetected}
            onClick={sendToExtension}
            className="h-7 bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 flex items-center gap-1 shrink-0 disabled:opacity-40"
          >
            <Globe className="size-3" />
            Send to Extension
          </Button>
        </div>

        {/* Mark-as-posted form */}
        {showMarkForm && (
          <div className="rounded-xl border border-primary/30 bg-slate-950/60 p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-slate-300 font-semibold">Listing URL (optional)</Label>
                <Input
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={`https://www.${activePortal === 'housing' ? 'housing.com' : `${activePortal}.com`}/...`}
                  className="bg-slate-900 border-slate-700 text-xs h-9 text-slate-200"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-slate-300 font-semibold flex items-center gap-1">
                  <CalendarClock className="size-3" />
                  Expires on — WhatsApp reminder 3 days before
                </Label>
                <Input
                  type="date"
                  value={formExpiry}
                  onChange={(e) => setFormExpiry(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-xs h-9 text-slate-200"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMarkForm(false)}
                className="h-8 border-slate-800 text-xs text-slate-300"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={markPosted}
                className="h-8 bg-primary text-primary-foreground text-xs flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Copy-ready fields */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-slate-300 text-[11px] font-semibold">
              Fields in {meta.label}&apos;s form order — copy top to bottom
            </Label>
            <button
              type="button"
              onClick={copyAll}
              className="text-[10px] text-primary hover:underline flex items-center gap-1"
            >
              <Copy className="size-3" />
              Copy all
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/70 overflow-hidden">
            {fields.map((field) => (
              <div key={field.label} className="flex items-center gap-3 bg-slate-950/40 px-3 py-2">
                <span className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {field.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200" title={field.value}>
                  {field.value}
                </span>
                <button
                  type="button"
                  onClick={() => copyField(field.label, field.value)}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white transition-colors"
                  title={`Copy ${field.label}`}
                >
                  {copiedField === field.label ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Photo pack */}
        {images.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-300 text-[11px] font-semibold">
              Photos ({images.length}) — download, then upload on the portal
            </Label>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {images.map((img, idx) => (
                <button
                  key={img}
                  type="button"
                  onClick={() => downloadPhoto(img, idx)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-slate-800"
                  title={`Download photo ${idx + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/60 opacity-0 transition-opacity group-hover:opacity-100">
                    {downloadingIdx === idx ? (
                      <Loader2 className="size-4 animate-spin text-white" />
                    ) : (
                      <Download className="size-4 text-white" />
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-800 pt-3.5 flex justify-between items-center">
          <span className="text-[10px] text-slate-500">
            Tip: keep the portal tab open beside this dialog and copy field by field.
          </span>
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
