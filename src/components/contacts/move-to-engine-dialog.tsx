'use client';

import { useState } from 'react';
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
import { Loader2, Copy, MessageSquare, AlertTriangle } from 'lucide-react';

interface MoveToEngineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
}

interface EngineNumber {
  phone: string;
  prefix: string;
  sandbox: boolean;
}

async function fetchEngineNumber(): Promise<EngineNumber> {
  const res = await fetch('/api/whatsapp/engine-number');
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(body.error || 'Could not load the Engine number');
  return body.data as EngineNumber;
}

function buildInvite(engine: EngineNumber, contactName: string): string {
  const link = `https://wa.me/${engine.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
    `${engine.prefix}START ALERTS`
  )}`;
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  return (
    `Hi ${firstName} 👋\n\n` +
    `I've saved what you're looking for. From here, our listings engine watches the market for you:\n\n` +
    `⚡ You hear the *moment* a matching property comes in\n` +
    `💎 First look at steal deals — sellers needing a quick exit, priced under market\n` +
    `🎯 Only what fits your requirement — no spam, reply STOP ALERTS anytime\n\n` +
    `Tap once to switch it on:\n${link}`
  );
}

/**
 * Hands a contact the one link that moves them onto the Engine's
 * WhatsApp number.
 *
 * A conversation held on an agent's personal number is invisible to the
 * Engine: no conversation row, no 24-hour window, and the match digest
 * cannot even ask for alert consent without one. Only the contact can
 * fix that, by messaging the Engine number once — so this builds the
 * invite and sends it through whatever thread the agent already has
 * with them. The pre-filled START ALERTS is what
 * parseBuyerAlertsCommand reads on arrival, so a single tap both opens
 * the window and records consent.
 */
export function MoveToEngineDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
}: MoveToEngineDialogProps) {
  // The connected number rarely changes, so it is cached across every
  // contact the agent opens rather than refetched per dialog.
  const engineQuery = useQuery({
    queryKey: ['engine-number'],
    queryFn: fetchEngineNumber,
    enabled: open,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const engine = engineQuery.data;

  // The message is derived from the resolved number; an agent edit
  // becomes an override that is dropped on close, so the next contact
  // never inherits the previous one's draft.
  const [draft, setDraft] = useState<string | null>(null);
  const message = draft ?? (engine ? buildInvite(engine, contactName) : '');

  function handleOpenChange(next: boolean) {
    if (!next) setDraft(null);
    onOpenChange(next);
  }

  function handleSend() {
    const to = contactPhone.replace(/\D/g, '');
    if (!to) {
      toast.error('This contact has no usable phone number');
      return;
    }
    window.open(
      `https://wa.me/${to}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  function handleCopy() {
    navigator.clipboard.writeText(message);
    toast.success('Invite copied — paste it wherever you are talking to them');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <MessageSquare className="size-5 text-emerald-400" />
            Move to Engine WhatsApp
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-slate-400">
            Send this from wherever you are already talking to{' '}
            {contactName || 'them'}. One tap opens their chat on the Engine
            number and switches on property alerts.
          </DialogDescription>
        </DialogHeader>

        {engineQuery.isPending ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="size-7 animate-spin text-emerald-500" />
            <p className="text-[11px] text-slate-500">
              Reading your connected number…
            </p>
          </div>
        ) : engineQuery.isError ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-200/90">
              {(engineQuery.error as Error).message}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-[10px] font-black tracking-widest text-slate-500 uppercase">
                Engine number
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {engine?.phone}
              </p>
              {engine?.sandbox && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  Shared sandbox number — the link carries your{' '}
                  {engine.prefix.trim()} code so their message reaches this
                  account.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                Invite message
              </Label>
              <Textarea
                value={message}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[150px] resize-none border-slate-700 bg-slate-800 text-xs leading-relaxed text-slate-100 focus-visible:border-emerald-500 focus-visible:ring-1 focus-visible:ring-emerald-500"
              />
              <p className="text-[10px] text-slate-500">
                Keep the link intact — the pre-filled text is what turns their
                alerts on.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={handleCopy}
                className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                <Copy className="size-3.5" />
                Copy invite
              </Button>
              <Button
                onClick={handleSend}
                className="h-9 gap-1.5 rounded-lg bg-emerald-500 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/10 hover:bg-emerald-600"
              >
                <MessageSquare className="size-3.5 fill-slate-950" />
                Send on WhatsApp
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
