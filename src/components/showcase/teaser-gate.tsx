'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle,
  Images,
  Lock,
  MapPin,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { storagePublicUrl } from '@/lib/storage/url';
import type { Property } from '@/types';

interface TeaserGateProps {
  property: Property;
  accountId: string;
  visitorName?: string;
  visitorPhone?: string;
  visitorRef?: string;
  shareId?: string;
  onSaveVisitorInfo?: (name: string, phone: string) => void;
  onClose: () => void;
}

// The whole of a teaser-gated listing's public page: a stub and the way
// through it. The stub is what the server sent — nothing here is hidden
// in CSS, because the payload never carried the rest (see
// src/lib/inventory/showcase-visibility.ts).
//
// The copy names the OWNER as the source of the restriction. That is
// both true and the point: a buyer reads "the agent is hiding something"
// into an unexplained wall, and reads professionalism into a
// confidentiality undertaking. Every restriction is paired with the one
// tap through it.
export function TeaserGate({
  property,
  accountId,
  visitorName = '',
  visitorPhone = '',
  visitorRef,
  shareId,
  onSaveVisitorInfo,
  onClose,
}: TeaserGateProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(visitorName);
  const [phone, setPhone] = useState(visitorPhone);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Images travel as bucket-relative paths, not URLs — resolved at the
  // read boundary here, the same as every other showcase surface.
  const coverImage = property.images?.[0]
    ? storagePublicUrl(property.images[0])
    : null;
  const hiddenPhotos = Math.max(
    (property.image_count ?? 0) - (coverImage ? 1 : 0),
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/properties/${property.id}/location-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_name: name.trim(),
            requester_phone: phone.trim(),
            account_id: accountId,
            scope: 'listing',
            via_contact_id: visitorRef || undefined,
            via_share_id: shareId || undefined,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      onSaveVisitorInfo?.(name.trim(), phone.trim());
      setSubmitted(true);
      toast.success(
        'Request sent. You will receive the full listing on WhatsApp once approved.'
      );
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to submit request'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md">
      <div
        className="flex min-h-full items-center justify-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="animate-zoom-in relative w-full max-w-lg overflow-hidden border border-slate-800 bg-slate-900/85 shadow-2xl backdrop-blur-xl sm:rounded-3xl">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 cursor-pointer rounded-full border border-slate-800/80 bg-slate-950/80 p-1.5 text-slate-400 hover:text-white"
          >
            <X className="size-4" />
          </button>

          <div className="relative flex h-44 items-center justify-center overflow-hidden bg-slate-950">
            {coverImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImage}
                  alt={property.title}
                  className="h-full w-full object-cover opacity-70"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-600">
                <Lock className="size-8" />
                <span className="text-[11px] font-semibold tracking-wider uppercase">
                  Photos shared on request
                </span>
              </div>
            )}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1">
              <ShieldCheck className="size-3 text-amber-400" />
              <span className="text-[10px] font-extrabold tracking-wider text-amber-400 uppercase">
                Confidential listing
              </span>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <h3 className="text-lg leading-snug font-bold text-white">
                {property.title}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {property.location}
                </span>
                {property.price_band && (
                  <span className="font-semibold text-slate-300">
                    Guide price {property.price_band}
                  </span>
                )}
                {hiddenPhotos > 0 && (
                  <span className="flex items-center gap-1">
                    <Images className="size-3.5" />
                    {hiddenPhotos} more photo{hiddenPhotos > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
              <p className="text-[12px] leading-relaxed text-slate-400">
                The owner has asked us to keep this property confidential — it
                is not listed publicly, and the address, photographs and exact
                price are shared only with buyers we introduce.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
                Tell us who you are and we will open the full listing for you on
                WhatsApp, usually within the hour.
              </p>
            </div>

            {submitted ? (
              <div className="flex items-start gap-2 text-[12px] font-semibold text-emerald-400">
                <CheckCircle className="mt-px size-4 shrink-0" />
                Request sent — you will receive the full listing on WhatsApp
                once the owner approves it.
              </div>
            ) : open ? (
              <form onSubmit={handleSubmit} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                    className="h-9 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                  />
                  <Input
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="WhatsApp Number"
                    className="h-9 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-primary hover:bg-primary-hover text-primary-foreground flex h-9 w-full items-center justify-center gap-2 text-xs font-bold"
                >
                  {submitting ? (
                    <div className="border-primary-foreground h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  Request full details
                </Button>
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Your number is used to send you the listing and is not
                  published anywhere.
                </p>
              </form>
            ) : (
              <Button
                type="button"
                onClick={() => setOpen(true)}
                className="bg-primary hover:bg-primary-hover text-primary-foreground flex h-9 w-full items-center justify-center gap-2 text-xs font-bold"
              >
                <Lock className="size-3" />
                Request full details
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
