'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, LiaisonWorkflow } from '@/types';
import { buildWorkflowMessage } from '@/lib/liaisons/workflows';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableContactSelect } from '@/components/ui/searchable-contact-select';
import { Copy, ExternalLink, Loader2, Send } from 'lucide-react';

interface ShareWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: LiaisonWorkflow | null;
}

export function ShareWorkflowDialog({ open, onOpenChange, workflow }: ShareWorkflowDialogProps) {
  const supabase = createClient();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*').order('name');
    if (data) setContacts(data);
  }, [supabase]);

  useEffect(() => {
    if (!open || !workflow) return;
    setContactId(null);
    setMessage(buildWorkflowMessage(workflow));
    fetchContacts();
  }, [open, workflow, fetchContacts]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === contactId) ?? null,
    [contacts, contactId],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Message copied');
    } catch {
      toast.error('Could not copy — select the text manually');
    }
  };

  const handleOpenWhatsApp = () => {
    if (!selectedContact?.phone) {
      toast.error('Pick a contact first');
      return;
    }
    const digits = selectedContact.phone.replace(/\D/g, '');
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const handleSend = async () => {
    if (!workflow) return;
    if (!contactId) {
      toast.error('Pick a contact first');
      return;
    }
    if (!message.trim()) {
      toast.error('Message is empty');
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/liaison-workflows/${workflow.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }

      toast.success('Process shared on WhatsApp');
      onOpenChange(false);
    } catch (err) {
      console.error('Error sharing workflow:', err);
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to send — try "Open in WhatsApp" instead',
      );
    } finally {
      setSending(false);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Share Process</DialogTitle>
          <DialogDescription className="text-slate-400">
            Send &ldquo;{workflow.service_name}&rdquo; to a client so they know exactly
            what happens, who approves it, and how long it takes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">Client</Label>
            <SearchableContactSelect
              contacts={contacts.map((c) => ({
                id: c.id,
                name: c.name ?? c.phone,
                phone: c.phone,
                name_tag: c.name_tag,
              }))}
              value={contactId}
              onChange={setContactId}
              placeholder="Select the client..."
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="share-message" className="text-xs text-slate-300">
                Message (edit before sending)
              </Label>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <Copy className="size-3" />
                Copy
              </button>
            </div>
            <Textarea
              id="share-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-64 text-xs font-mono leading-relaxed"
            />
            <p className="text-[10px] text-slate-500">
              *text* renders bold and _text_ italic on WhatsApp.
            </p>
          </div>
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700 flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleOpenWhatsApp}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 gap-1.5"
          >
            <ExternalLink className="size-3.5" />
            Open in WhatsApp
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold gap-1.5"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send via ConvoReal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
