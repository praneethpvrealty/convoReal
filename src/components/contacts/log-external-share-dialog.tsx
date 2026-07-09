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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Share2, Smartphone, ExternalLink } from 'lucide-react';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';

interface LogExternalShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  properties: Property[];
  onSaved?: () => void;
}

export function LogExternalShareDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  properties,
  onSaved,
}: LogExternalShareDialogProps) {
  const supabase = createClient();
  const { user, accountId, profile } = useAuth();

  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharingMedia, setSharingMedia] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPropertyId(null);
      setNote('');
      setSharingMedia(false);
    }
  }, [open]);

  const selectedProperty = useMemo(() => {
    if (!selectedPropertyId) return null;
    return properties.find((p) => p.id === selectedPropertyId) || null;
  }, [selectedPropertyId, properties]);

  // Generate shareable message based on property details
  const generateShareMessage = useCallback(() => {
    if (!selectedProperty) return '';

    const showcaseUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?property_id=${selectedProperty.id}`
      : `/?property_id=${selectedProperty.id}`;

    const title = selectedProperty.title || 'this property';

    // Price Formatter
    const amount = Number(selectedProperty.price);
    let price = 'Price on request';
    if (!isNaN(amount) && amount > 0) {
      if (amount >= 10000000) {
        const cr = amount / 10000000;
        price = `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      } else if (amount >= 100000) {
        const lakhs = amount / 100000;
        price = `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      } else {
        price = new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          maximumFractionDigits: 0,
        }).format(amount);
      }
    }

    const location = [selectedProperty.sublocality, selectedProperty.city, selectedProperty.state].filter(Boolean).join(', ') || selectedProperty.location || '';
    const type = selectedProperty.type || '';
    const beds = selectedProperty.bedrooms ? `${selectedProperty.bedrooms} BHK` : '';
    const area = selectedProperty.area_sqft ? `${selectedProperty.area_sqft} ${selectedProperty.area_unit || 'Sq.Ft.'}` : '';
    const agentName = profile?.full_name || '';
    const agentPhone = profile?.phone || '';
    const signOff = agentName ? `Best regards, ${agentName}` : 'Best regards';
    const signOffWithPhone = agentPhone ? `${signOff}\n${agentPhone}` : signOff;

    const details = [beds, type, area, location].filter(Boolean).join(' | ');

    return `Hi,\n\nI wanted to share a property listing that might interest you:\n\n*${title}*\n${details ? `${details}\n` : ''}*Price: ${price}*\n\nFor complete details, photos, and location map, please visit:\n${showcaseUrl}\n\nFeel free to reach out if you have any questions.\n\n${signOffWithPhone}`;
  }, [selectedProperty, profile]);

  async function handleSubmit(shareMethod?: 'whatsapp' | 'device') {
    if (!contactId || !user || !accountId) {
      toast.error('Auth context missing');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // Build the note text
      const propertyLabel = selectedProperty
        ? `${selectedProperty.property_code ? `[${selectedProperty.property_code}] ` : ''}${selectedProperty.title}`
        : null;

      const methodLabel = shareMethod === 'device'
        ? '📱 Shared via device sharing (with image)'
        : shareMethod === 'whatsapp'
        ? '📱 Shared via personal WhatsApp'
        : '📱 Shared via external channel';

      const noteLines = [
        methodLabel,
        propertyLabel ? `🏠 Property: ${propertyLabel}` : null,
        note.trim() ? `📝 ${note.trim()}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      // Build the contact update payload
      const contactUpdate: Record<string, unknown> = {
        last_contacted_at: now,
      };
      if (selectedPropertyId) {
        contactUpdate.last_inquired_property_id = selectedPropertyId;
      }

      // Fire all writes in parallel
      const [contactRes, noteRes] = await Promise.allSettled([
        supabase
          .from('contacts')
          .update(contactUpdate)
          .eq('id', contactId),
        supabase
          .from('contact_notes')
          .insert({
            contact_id: contactId,
            user_id: user.id,
            account_id: accountId,
            note_text: noteLines,
          }),
      ]);

      const contactErr =
        contactRes.status === 'fulfilled' ? contactRes.value.error : contactRes.reason;
      const noteErr =
        noteRes.status === 'fulfilled' ? noteRes.value.error : noteRes.reason;

      if (contactErr) {
        console.error('[log-share] contact update failed:', contactErr);
        throw new Error('Failed to update contact');
      }
      if (noteErr) {
        console.error('[log-share] note insert failed:', noteErr);
        throw new Error('Failed to save note');
      }

      toast.success(
        `Logged external share for ${contactName || contactPhone}`,
      );
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  /** Open + log in one shot: opens wa.me with prefilled message if selected, then saves the log. */
  async function handleOpenAndLog() {
    let url = `https://wa.me/${contactPhone.replace(/\D/g, '')}`;
    if (selectedProperty) {
      const message = generateShareMessage();
      url += `?text=${encodeURIComponent(message)}`;
    }

    // Open WhatsApp immediately (synchronous for popup-blocker safety)
    window.open(url, '_blank');
    await handleSubmit('whatsapp');
  }

  /** Shares the property details with images and showcase link using navigator.share and logs it. */
  async function handleNativeShareAndLog() {
    if (!selectedProperty) return;
    setSharingMedia(true);

    try {
      const message = generateShareMessage();
      const shareData: ShareData = {
        title: selectedProperty.title || 'Property Details',
        text: message,
      };

      // Try to attach the property thumbnail image if available
      const imageUrl = selectedProperty.images?.find((img) => img.trim().length > 0);
      if (imageUrl && typeof navigator !== 'undefined' && 'canShare' in navigator) {
        try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const sanitizedTitle = (selectedProperty.title || 'property')
            .replace(/[^a-zA-Z0-9\s_-]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .slice(0, 50);
          const file = new File([blob], `${sanitizedTitle || 'property'}.jpg`, { type: blob.type || 'image/jpeg' });
          if (navigator.canShare({ files: [file] })) {
            shareData.files = [file];
          }
        } catch (e) {
          console.error('Failed to load sharing image, using text only', e);
        }
      }

      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(message);
        toast.success('Message + Link copied to clipboard!');
      }

      await handleSubmit('device');
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error(err.message || 'Failed to share');
      }
    } finally {
      setSharingMedia(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
        <DialogHeader className="border-b border-slate-800 pb-3 mb-1">
          <DialogTitle className="text-white flex items-center gap-2 text-base font-black tracking-tight">
            <Share2 className="size-4 text-primary" />
            Share Property Listing
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Record that you shared a property with{' '}
            <span className="text-white font-semibold">{contactName || contactPhone}</span>{' '}
            outside the CRM (e.g. personal WhatsApp, SMS, in-person).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Property Picker */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-semibold">
              Property shared <span className="text-slate-500 font-normal">(optional)</span>
            </Label>
            <SearchablePropertySelect
              properties={properties}
              value={selectedPropertyId}
              onChange={setSelectedPropertyId}
              placeholder="Search & pick a property..."
            />
            {selectedProperty && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2.5 flex items-center gap-2 text-xs animate-in fade-in duration-200">
                <span className="text-slate-400">🏠</span>
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold truncate">{selectedProperty.title}</p>
                  {selectedProperty.location && (
                    <p className="text-slate-400 truncate text-[10px] mt-0.5">
                      📍 {selectedProperty.sublocality || selectedProperty.location}
                      {selectedProperty.price ? ` · ₹${Number(selectedProperty.price) >= 10000000 ? `${(Number(selectedProperty.price) / 10000000).toFixed(2).replace(/\.00$/, '')} Cr` : Number(selectedProperty.price) >= 100000 ? `${(Number(selectedProperty.price) / 100000).toFixed(2).replace(/\.00$/, '')} L` : Number(selectedProperty.price).toLocaleString('en-IN')}` : ''}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Optional Note */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-semibold">
              Note <span className="text-slate-500 font-normal">(optional)</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Sent photos on WhatsApp, client seemed interested..."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[70px] text-xs resize-none"
            />
          </div>

          {/* Preview of what will be logged */}
          <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">What will be logged</p>
            <ul className="text-xs text-slate-400 space-y-0.5">
              <li className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-emerald-400 shrink-0" />
                <span>Mark as <span className="text-emerald-400 font-semibold">contacted now</span></span>
              </li>
              {selectedProperty && (
                <li className="flex items-center gap-1.5">
                  <span className="size-1 rounded-full bg-primary shrink-0" />
                  <span>
                    Link property{' '}
                    <span className="text-primary font-semibold">
                      {selectedProperty.property_code || selectedProperty.title}
                    </span>
                  </span>
                </li>
              )}
              <li className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-amber-400 shrink-0" />
                <span>
                  Add note: <span className="text-white font-medium">
                    {selectedProperty
                      ? '"Shared via device sharing / WhatsApp"'
                      : '"Shared via personal WhatsApp"'}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
          {selectedProperty && (
            <Button
              onClick={handleNativeShareAndLog}
              disabled={saving || sharingMedia}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-9 rounded-xl flex items-center justify-center gap-1.5"
            >
              {sharingMedia ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Share2 className="size-3.5" />
              )}
              Share Listing &amp; Log
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              onClick={handleOpenAndLog}
              disabled={saving || sharingMedia}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 rounded-xl flex items-center justify-center gap-1.5"
            >
              {saving && !sharingMedia ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              {selectedProperty ? 'WhatsApp &amp; Log' : 'Open WhatsApp &amp; Log'}
            </Button>
            <Button
              onClick={() => handleSubmit()}
              disabled={saving || sharingMedia}
              variant="outline"
              className="flex-1 border-slate-700 text-white hover:bg-slate-800 font-bold text-xs h-9 rounded-xl flex items-center justify-center gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Smartphone className="size-3.5" />
              )}
              Log Only
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
