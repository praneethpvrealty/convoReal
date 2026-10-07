'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type PortfolioSide = 'buyer' | 'owner' | 'agent';

interface PortfolioInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  onSent: () => void;
}

interface PreviewResponse {
  data?: {
    sides: PortfolioSide[];
    side: PortfolioSide | null;
    message: string;
    url: string | null;
    agentRegistered?: boolean;
  };
  error?: string;
}

const SIDE_LABELS: Record<PortfolioSide, string> = {
  buyer: 'Buyer Portfolio',
  owner: 'Owner Portfolio',
  agent: 'Agent Invite',
};

export function PortfolioInviteDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  onSent,
}: PortfolioInviteDialogProps) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [chosenSide, setChosenSide] = useState<PortfolioSide | null>(null);
  const name = contactName.trim() || contactPhone || 'this contact';
  const path = `/api/contacts/${contactId}/portfolio-invite`;
  const preview = useQuery({
    queryKey: ['portfolio-invite', contactId, chosenSide],
    enabled: open,
    queryFn: async () => {
      const query = chosenSide ? `?side=${chosenSide}` : '';
      const response = await fetch(`${path}${query}`);
      const body = (await response.json().catch(() => ({}))) as PreviewResponse;
      if (!response.ok || !body.data) {
        throw new Error(body.error || 'Could not prepare the Portfolio invite');
      }
      return body.data;
    },
  });
  const side = preview.data?.side ?? null;
  const sides = preview.data?.sides ?? [];
  const message = preview.data?.message ?? '';
  const agentSide = side === 'agent';
  const agentRegistered = preview.data?.agentRegistered === true;
  const eligible =
    !preview.isLoading &&
    (agentSide ? !agentRegistered : Boolean(side && message));
  const error =
    sendError ||
    (preview.error instanceof Error ? preview.error.message : null);

  async function sendFromBusiness() {
    if (sending || !side) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'business', side }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { delivery?: 'free_text' | 'template' };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || 'Could not send the Portfolio invite');
      }
      toast.success(
        body.data?.delivery === 'template'
          ? `${SIDE_LABELS[side]} invite sent to ${name} with the approved Portfolio access template`
          : `${SIDE_LABELS[side]} invite sent to ${name} from your business WhatsApp`
      );
      onSent();
      onOpenChange(false);
    } catch (reason) {
      setSendError(
        reason instanceof Error
          ? reason.message
          : 'Could not send the Portfolio invite'
      );
    } finally {
      setSending(false);
    }
  }

  async function openAgentInvite() {
    const digits = contactPhone?.replace(/\D/g, '') ?? '';
    if (!digits || sending) return;
    const popup = window.open('', '_blank');
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch('/api/beta-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: contactName.trim() || null,
          invitee_phone: contactPhone,
        }),
      });
      const invite = (await response.json().catch(() => ({}))) as {
        shareMessage?: string;
        error?: string;
      };
      if (!response.ok || !invite.shareMessage) {
        throw new Error(
          invite.error || 'Could not create the ConvoReal invite'
        );
      }
      const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(invite.shareMessage)}`;
      if (popup) popup.location.href = whatsappUrl;
      else window.location.href = whatsappUrl;
      onOpenChange(false);
      const note = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'personal', side: 'agent' }),
      }).catch(() => null);
      if (note?.ok) onSent();
    } catch (reason) {
      popup?.close();
      setSendError(
        reason instanceof Error
          ? reason.message
          : 'Could not create the ConvoReal invite'
      );
    } finally {
      setSending(false);
    }
  }

  async function openPersonalWhatsApp() {
    if (agentSide) return openAgentInvite();
    const digits = contactPhone?.replace(/\D/g, '') ?? '';
    if (!digits || !message || !side) return;
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
    onOpenChange(false);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'personal', side }),
      });
      if (response.ok) onSent();
    } catch {
      // The chat is already open; a missing timeline note is not worth a warning.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <KeyRound className="text-primary size-5" />
            Portfolio invite
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            {agentSide
              ? `Invite ${name} to ConvoReal to run their own inventory, so you can share listings and requirements with them directly.`
              : side === 'owner'
                ? `Invite ${name} to their Owner Portfolio to track enquiries, visits and offers on their property and add new listings themselves.`
                : side === 'buyer'
                  ? `Invite ${name} to their Portfolio to see matched properties, keep a shortlist and update their requirements.`
                  : `Invite ${name} to sign in to their Portfolio with this WhatsApp number.`}
          </DialogDescription>
        </DialogHeader>

        {sides.length > 1 ? (
          <div
            className={cn(
              'grid gap-2',
              sides.length > 2 ? 'grid-cols-3' : 'grid-cols-2'
            )}
          >
            {sides.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSendError(null);
                  setChosenSide(option);
                }}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                  option === side
                    ? 'border-primary bg-primary/15 text-white'
                    : 'border-slate-800 text-slate-400 hover:bg-slate-800/60'
                )}
              >
                {SIDE_LABELS[option]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          {preview.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              Preparing the invite…
            </div>
          ) : agentSide ? (
            <p className="text-sm leading-6 text-slate-300">
              {agentRegistered
                ? `${name} already uses ConvoReal. Use Share Inventory to send listings straight to their Pending Review queue.`
                : `Personal WhatsApp creates a ConvoReal invite link for ${name}, using one of your invite seats, and opens it ready to send from your own WhatsApp.`}
            </p>
          ) : message ? (
            <p className="text-sm leading-6 break-words whitespace-pre-wrap text-slate-300">
              {message}
            </p>
          ) : (
            <p className="text-sm leading-6 text-slate-400">
              Portfolio is for buyers and owners. Classify {name} as a Buyer,
              Owner or Seller, or link them to a listing or enquiry, and the
              invite will be ready here. Classify an agent as Agent to invite
              them to ConvoReal.
            </p>
          )}
        </div>

        <p className="text-xs leading-5 text-slate-500">
          {agentSide
            ? 'A ConvoReal invite is a personal note from you to another agent, so it goes from your own WhatsApp, never the business number. The invite is noted on the timeline.'
            : 'Business WhatsApp is sent and tracked in ConvoReal; outside the 24-hour window it goes out as the approved Portfolio access template with a sign-in button. Personal WhatsApp opens this message in your own app and notes the invite on the timeline.'}
        </p>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 border-slate-800 bg-slate-900 sm:justify-between">
          <Button
            variant={agentSide ? 'default' : 'outline'}
            onClick={openPersonalWhatsApp}
            disabled={!eligible || !contactPhone || (agentSide && sending)}
          >
            {agentSide && sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ExternalLink className="size-4" />
            )}
            Personal WhatsApp
          </Button>
          {agentSide ? null : (
            <Button onClick={sendFromBusiness} disabled={!eligible || sending}>
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {sending ? 'Sending…' : 'Business WhatsApp'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
