'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, MessageSquareText, Send } from 'lucide-react';
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
import type { Property } from '@/types';

interface PropertyInterestFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  property: Property;
  onSent: () => void;
}

interface PreviewResponse {
  data?: { message: string; phone: string | null };
  error?: string;
}

export function PropertyInterestFollowUpDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  property,
  onSent,
}: PropertyInterestFollowUpDialogProps) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const name = contactName.trim() || contactPhone || 'this contact';
  const preview = useQuery({
    queryKey: ['property-interest-follow-up', contactId, property.id],
    enabled: open,
    queryFn: async () => {
      const response = await fetch(
        `/api/contacts/${contactId}/inquiries/${property.id}`
      );
      const body = (await response.json().catch(() => ({}))) as PreviewResponse;
      if (!response.ok || !body.data?.message) {
        throw new Error(body.error || 'Could not prepare the check-in');
      }
      return body.data;
    },
  });
  const message = preview.data?.message ?? '';
  const error =
    sendError ||
    (preview.error instanceof Error ? preview.error.message : null);

  async function sendFromEngine() {
    if (sending) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(
        `/api/contacts/${contactId}/inquiries/${property.id}`,
        { method: 'POST' }
      );
      const body = (await response.json().catch(() => ({}))) as {
        data?: { delivery?: 'free_text' | 'template' };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || 'Could not send the check-in');
      }
      toast.success(
        body.data?.delivery === 'template'
          ? `Check-in sent to ${name} with the approved WhatsApp template`
          : `Check-in sent to ${name} from your business WhatsApp`
      );
      onSent();
      onOpenChange(false);
    } catch (reason) {
      setSendError(
        reason instanceof Error ? reason.message : 'Could not send the check-in'
      );
    } finally {
      setSending(false);
    }
  }

  function openPersonalWhatsApp() {
    const digits = contactPhone?.replace(/\D/g, '') ?? '';
    if (!digits || !message) return;
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <MessageSquareText className="text-primary size-5" />
            Check latest interest
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Ask {name} whether they are still considering{' '}
            {property.property_code ? `[${property.property_code}] ` : ''}
            {property.title}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          {preview.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              Preparing property-specific message…
            </div>
          ) : (
            <p className="text-sm leading-6 whitespace-pre-wrap text-slate-300">
              {message}
            </p>
          )}
        </div>

        <p className="text-xs leading-5 text-slate-500">
          Business WhatsApp is sent and tracked in ConvoReal. Replies are filed
          against this property. Personal WhatsApp opens this message in your
          own app; replies stay outside the Engine.
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
            onClick={sendFromEngine}
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
