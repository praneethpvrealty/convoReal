'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  OWNER_DETAILS_SECTION_TITLES,
  availableOwnerDetailsSections,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerHandoverLink,
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

interface EngineNumber {
  phone: string;
  prefix: string;
  sandbox: boolean;
}

interface DetailsRequestSettings {
  sections: OwnerDetailsSection[];
  body_template: string | null;
}

/**
 * The first message an agent sends a seller.
 *
 * It goes from the agent's OWN WhatsApp, which is the only place a
 * first conversation with an owner exists — there is no open 24-hour
 * window on the business number until the owner writes to it. So the
 * message carries a one-tap link that moves them there, and the primary
 * button here opens the agent's own WhatsApp with it, not the Engine.
 *
 * Sending through the Engine stays available for the owner who is
 * already on the business number and inside the window; outside it the
 * route answers 409 and this falls back to the same personal-WhatsApp
 * hand-off rather than dead-ending.
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

  // The connected number rarely changes, so it is cached across every
  // contact the agent opens. A failure is not fatal: the message drops
  // the hand-off link and asks them to reply where they are.
  const engineQuery = useQuery({
    queryKey: ['engine-number'],
    queryFn: async (): Promise<EngineNumber> => {
      const res = await fetch('/api/whatsapp/engine-number');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No number connected');
      return body.data as EngineNumber;
    },
    enabled: open,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const settingsQuery = useQuery({
    queryKey: ['owner-details-request-settings'],
    queryFn: async (): Promise<DetailsRequestSettings> => {
      const res = await fetch('/api/owners/details-request/settings');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load settings');
      return body.data as DetailsRequestSettings;
    },
    enabled: open,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // `undefined` is "the agent has not chosen", which defaults to their
  // first listing — properties arrive with the parent's fetch, so an
  // initial-state default would stick at null for whoever opens first.
  const [chosenId, setChosenId] = useState<string | null | undefined>();
  const [selection, setSelection] = useState<OwnerDetailsSection[] | null>(
    null
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const propertyId =
    chosenId === undefined ? (properties[0]?.id ?? null) : chosenId;
  const property = properties.find((p) => p.id === propertyId) ?? null;

  const offered = useMemo(
    () => availableOwnerDetailsSections(property?.type),
    [property?.type]
  );
  // The account's saved selection stands in for the built-in default;
  // the agent's toggles override both, for this send only.
  const sections = useMemo(() => {
    const saved = settingsQuery.data?.sections ?? [];
    const base =
      selection ??
      (saved.length > 0 ? saved : defaultOwnerDetailsSections(property?.type));
    return offered.filter((s) => base.includes(s));
  }, [selection, settingsQuery.data, property?.type, offered]);

  const engineLink = engineQuery.data
    ? ownerHandoverLink(engineQuery.data)
    : null;

  const composed = useMemo(
    () =>
      buildOwnerDetailsRequestMessage({
        ownerName: contactName,
        propertyLabel: ownerPropertyLabel(property),
        propertyType: property?.type,
        sections,
        agentName: profile?.full_name,
        agentPhone: profile?.phone,
        brandName: account?.name,
        engineLink,
        bodyTemplate: settingsQuery.data?.body_template,
        now: new Date(),
      }),
    [
      contactName,
      property,
      sections,
      profile,
      account,
      engineLink,
      settingsQuery.data,
    ]
  );
  const message = draft ?? composed;

  function reset() {
    setDraft(null);
    setSelection(null);
    setChosenId(undefined);
    setSending(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggleSection(section: OwnerDetailsSection) {
    setDraft(null);
    const next = sections.includes(section)
      ? sections.filter((s) => s !== section)
      : offered.filter((s) => sections.includes(s) || s === section);
    setSelection(next);
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
          'They have not messaged the Engine in the last 24 hours, so it cannot go from the business number. Opening your own WhatsApp with the same message.'
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
            Send this from your own WhatsApp, where you are already talking to{' '}
            {contactName || 'them'}. It asks for the basics — no documents — and
            moves them onto the office number, which is what starts their
            updates on buyers, visits and offers.
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
                      setSelection(null);
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
                    setSelection(null);
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
              {offered.map((section) => (
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
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              Papers and ownership are off for a first ask — turn them on once a
              buyer is finalised and the token is paid.
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
              {engineLink
                ? 'Keep the office WhatsApp link — their tap on it is what opens the thread and switches their updates on.'
                : 'No number is connected yet, so the message asks them to reply where they are. Connect one in Settings → WhatsApp to hand them over.'}
            </p>
          </div>

          <Button
            onClick={openWhatsApp}
            className="h-10 w-full gap-1.5 rounded-lg bg-emerald-500 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/10 hover:bg-emerald-600"
          >
            <MessageSquare className="size-3.5 fill-slate-950" />
            Send from my WhatsApp
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={copyMessage}
              className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            {canSend && (
              <Button
                variant="outline"
                onClick={sendFromEngine}
                disabled={sending || !message.trim()}
                title="Only works if they messaged the office number in the last 24 hours"
                className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                {sending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Send from office
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
