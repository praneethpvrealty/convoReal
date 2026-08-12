'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  Copy,
  Loader2,
  MessageSquare,
  Send,
} from 'lucide-react';
import {
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerPropertyLabel,
  type OwnerDetailsSection,
} from '@/lib/owners/details-request';
import type { Property } from '@/types';

interface OwnerDetailsRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  /** The properties this contact is the owner of. Empty is fine — the
   *  request then reads "your property". */
  properties?: Property[];
}

/**
 * The intake request an agent sends a seller: everything a listing
 * needs, and the promise of what comes back once it is live.
 *
 * The message is an Engine template, not a Meta one, so it has two ways
 * out and the dialog offers both. Inside the contact's 24-hour window it
 * goes through the account's business number and lands in the inbox
 * thread, which is what makes the "you will hear from this number"
 * promise true. Outside it — or for a contact who has never messaged the
 * Engine — the same text opens in the agent's own WhatsApp instead of
 * dead-ending, and the ask still gets made.
 */
export function OwnerDetailsRequestDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  properties = [],
}: OwnerDetailsRequestDialogProps) {
  const { profile, account } = useAuth();
  const canSend = useCan('send-messages');

  // `undefined` is "the agent has not chosen", which defaults to their
  // first listing — properties arrive with the parent's fetch, so an
  // initial-state default would stick at null for whoever opens first.
  const [chosenId, setChosenId] = useState<string | null | undefined>();
  const [omitted, setOmitted] = useState<OwnerDetailsSection[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const propertyId =
    chosenId === undefined ? (properties[0]?.id ?? null) : chosenId;
  const property = properties.find((p) => p.id === propertyId) ?? null;

  // The checklist a property of this type deserves; an agent's toggles
  // narrow it, and switching property re-derives it from scratch.
  const available = useMemo(
    () => defaultOwnerDetailsSections(property?.type),
    [property?.type]
  );
  const sections = available.filter((s) => !omitted.includes(s));

  const composed = useMemo(
    () =>
      buildOwnerDetailsRequestMessage({
        ownerName: contactName,
        propertyLabel: ownerPropertyLabel(property),
        propertyType: property?.type,
        sections: available.filter((s) => !omitted.includes(s)),
        agentName: profile?.full_name,
        agentPhone: profile?.phone,
        brandName: account?.name,
        now: new Date(),
      }),
    [contactName, property, available, omitted, profile, account]
  );
  const message = draft ?? composed;

  function reset() {
    setDraft(null);
    setOmitted([]);
    setChosenId(undefined);
    setSending(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggleSection(section: OwnerDetailsSection) {
    setDraft(null);
    setOmitted((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  }

  function openWhatsApp() {
    const digits = contactPhone.replace(/\D/g, '');
    if (!digits) {
      toast.error('This contact has no usable phone number');
      return;
    }
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  async function copyMessage() {
    await navigator.clipboard.writeText(message);
    toast.success('Copied — paste it wherever you are talking to them');
  }

  async function sendFromEngine() {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/owners/details-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          ...(propertyId ? { property_id: propertyId } : {}),
          message,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409) {
        toast.info(
          'They have not messaged the Engine in the last 24 hours, so it cannot go from the business number. Opening WhatsApp with the same message.'
        );
        openWhatsApp();
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Could not send');

      toast.success(`Details request sent to ${contactName || 'the owner'}`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <ClipboardList className="size-5 text-amber-400" />
            Ask for property details
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-slate-400">
            One message that asks {contactName || 'the owner'} for everything a
            listing needs, and tells them what this number will send back —
            enquiries, shortlisted buyers, site visits and offers.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {properties.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                Which property
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setDraft(null);
                      setOmitted([]);
                      setChosenId(p.id);
                    }}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      propertyId === p.id
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-slate-800 text-slate-400 hover:bg-slate-800'
                    )}
                  >
                    {p.title}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setDraft(null);
                    setOmitted([]);
                    setChosenId(null);
                  }}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    propertyId === null
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-slate-800 text-slate-400 hover:bg-slate-800'
                  )}
                >
                  Not listed yet
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-300">
              What to ask for
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {OWNER_DETAILS_SECTIONS.filter((s) => available.includes(s)).map(
                (section) => (
                  <button
                    key={section}
                    onClick={() => toggleSection(section)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      sections.includes(section)
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-slate-800 text-slate-500 hover:bg-slate-800'
                    )}
                  >
                    {OWNER_DETAILS_SECTION_TITLES[section]}
                  </button>
                )
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              {property?.type
                ? `Tuned for a ${property.type.toLowerCase()} — tap to drop anything you already have.`
                : 'Tap to drop anything you already have.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-300">
              Message
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setDraft(e.target.value)}
              className="focus-visible:border-primary focus-visible:ring-primary min-h-[240px] resize-none border-slate-700 bg-slate-800 text-xs leading-relaxed text-slate-100 focus-visible:ring-1"
            />
            <p className="text-[10px] text-slate-500">
              Keep the STOP UPDATES line — it is how they turn the updates off
              without calling you.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={copyMessage}
              className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={openWhatsApp}
              className="h-9 gap-1.5 rounded-lg border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
            >
              <MessageSquare className="size-3.5" />
              My WhatsApp
            </Button>
          </div>

          {canSend && (
            <Button
              onClick={sendFromEngine}
              disabled={sending || !message.trim()}
              className="h-10 w-full gap-1.5 rounded-lg text-xs font-bold"
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Send from the Engine number
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
