'use client';

import { useState } from 'react';
import { ClipboardCheck, Loader2, Radar, Send } from 'lucide-react';
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

interface BuyerPreferenceRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
}

export function BuyerPreferenceRequestDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
}: BuyerPreferenceRequestDialogProps) {
  const [sending, setSending] = useState(false);
  const name = contactName.trim() || 'the buyer';

  async function sendRequest() {
    setSending(true);
    try {
      const response = await fetch('/api/whatsapp/flows/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not send the form');

      toast.success(`Requirement form sent to ${name}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the form');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <ClipboardCheck className="text-primary size-5" />
            Ask for buyer requirements
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Send {name} a WhatsApp form pre-filled with the preferences already on record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
          <p className="text-xs text-slate-400">
            Sent directly from your connected ConvoReal WhatsApp number and tracked in
            Inbox. This will not open your personal WhatsApp.
          </p>
          <p>They can confirm or update budget, localities and property types.</p>
          <div className="flex gap-2 text-xs text-slate-400">
            <Radar className="text-primary mt-0.5 size-4 shrink-0" />
            <p>
              Only their submitted response changes the record. ConvoReal then re-runs
              matching, sends suitable listings and keeps the active requirement available
              to Match Radar for future properties.
            </p>
          </div>
        </div>

        <DialogFooter className="border-slate-800 bg-slate-900">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={sendRequest} disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? 'Sending from Engine…' : 'Send from Engine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
