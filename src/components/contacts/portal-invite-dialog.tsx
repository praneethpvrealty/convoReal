'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Loader2, Send } from 'lucide-react';
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

interface PortalInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  onSent: () => void;
}

interface PreviewResponse {
  data?: { message: string; url: string; phone: string | null };
  error?: string;
}

export function PortalInviteDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  onSent,
}: PortalInviteDialogProps) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const name = contactName.trim() || contactPhone || 'this contact';
  const path = `/api/contacts/${contactId}/portal-invite`;
  const preview = useQuery({
    queryKey: ['portal-invite', contactId],
    enabled: open,
    queryFn: async () => {
      const response = await fetch(path);
      const body = (await response.json().catch(() => ({}))) as PreviewResponse;
      if (!response.ok || !body.data?.message) {
        throw new Error(body.error || 'Could not prepare the portal link');
      }
      return body.data;
    },
  });
  const message = preview.data?.message ?? '';
  const error =
    sendError ||
    (preview.error instanceof Error ? preview.error.message : null);

  async function sendFromBusiness() {
    if (sending) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'business' }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { delivery?: 'free_text' | 'template' };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || 'Could not send the portal link');
      }
      toast.success(
        body.data?.delivery === 'template'
          ? `Portal link sent to ${name} with the approved property selection template`
          : `Portal link sent to ${name} from your business WhatsApp`
      );
      onSent();
      onOpenChange(false);
    } catch (reason) {
      setSendError(
        reason instanceof Error
          ? reason.message
          : 'Could not send the portal link'
      );
    } finally {
      setSending(false);
    }
  }

  async function openPersonalWhatsApp() {
    const digits = contactPhone?.replace(/\D/g, '') ?? '';
    if (!digits || !message) return;
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
        body: JSON.stringify({ channel: 'personal' }),
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
            <Globe className="text-primary size-5" />
            Share portal link
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Invite {name} to browse the portal, filter by their requirements and
            shortlist the properties they like. The link opens on their recorded
            interests and their visit shows up in Pulse.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          {preview.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              Preparing the invite…
            </div>
          ) : (
            <p className="text-sm leading-6 break-words whitespace-pre-wrap text-slate-300">
              {message}
            </p>
          )}
        </div>

        <p className="text-xs leading-5 text-slate-500">
          Business WhatsApp is sent and tracked in ConvoReal; outside the
          24-hour window it goes out as the approved property selection template
          with a button to the portal. Personal WhatsApp opens this message in
          your own app and notes the share on the timeline.
        </p>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 border-slate-800 bg-slate-900 sm:justify-between">
          <Button
            variant="outline"
            onClick={openPersonalWhatsApp}
            disabled={preview.isLoading || !message || !contactPhone}
          >
            <ExternalLink className="size-4" />
            Personal WhatsApp
          </Button>
          <Button
            onClick={sendFromBusiness}
            disabled={preview.isLoading || !message || sending}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {sending ? 'Sending…' : 'Business WhatsApp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
