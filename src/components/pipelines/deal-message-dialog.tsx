'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MessageCircle, Send } from 'lucide-react';
import type { Deal, PipelineStage } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { resolveConversation } from '@/lib/conversations/resolve';
import { accountShowcaseBase } from '@/lib/showcase/account-showcase-url';
import { propertyShowcaseUrl } from '@/lib/share-message-builder';
import { buildStageMessage } from '@/lib/pipelines/stage-message';

interface DealMessageDialogProps {
  deal: Deal | null;
  stage: PipelineStage | null;
  onClose: () => void;
}

export function DealMessageDialog({
  deal,
  stage,
  onClose,
}: DealMessageDialogProps) {
  return (
    <Dialog open={deal !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-md">
        {deal ? (
          <DealMessageForm
            key={deal.id}
            deal={deal}
            stage={stage}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DealMessageForm({
  deal,
  stage,
  onClose,
}: {
  deal: Deal;
  stage: PipelineStage | null;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, accountId } = useAuth();
  const contact = deal.contact ?? null;
  const property = deal.property ?? null;
  const [propertyUrl, setPropertyUrl] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!property || !contact || !accountId) return;
    let cancelled = false;
    void accountShowcaseBase(supabase, accountId).then((base) => {
      if (cancelled) return;
      setPropertyUrl(
        `${propertyShowcaseUrl(base, property)}&v=${encodeURIComponent(contact.id)}`
      );
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, accountId, property, contact]);

  const { title, message: suggested } = buildStageMessage({
    stage,
    contactName: contact?.name,
    propertyTitle: property?.title,
    propertyCode: property?.property_code,
    propertyUrl,
  });
  const message = edited ?? suggested;
  const name = contact?.name || contact?.phone || 'the contact';

  const openInInbox = async () => {
    if (!contact || !accountId || opening || !message.trim()) return;
    setOpening(true);
    const { conversation, error } = await resolveConversation<{ id: string }>(
      supabase,
      {
        accountId,
        contactId: contact.id,
        userId: user?.id ?? null,
        columns: 'id',
      }
    );
    if (!conversation) {
      setOpening(false);
      toast.error(error?.message ?? 'Could not open the chat thread');
      return;
    }
    router.push(
      `/inbox?c=${conversation.id}&draft=${encodeURIComponent(message)}`
    );
  };

  const phone = contact?.phone?.replace(/\D/g, '') ?? '';

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-white">
          {title} · {name}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-2 py-2">
        <p className="text-xs text-slate-400">
          Suggested for{' '}
          <span className="font-semibold text-slate-300">
            {stage?.name ?? 'this stage'}
          </span>
          . Edit it before sending.
        </p>
        <Textarea
          aria-label="Message"
          value={message}
          onChange={(e) => setEdited(e.target.value)}
          rows={7}
          className="border-slate-700 bg-slate-800 text-sm text-slate-100"
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {phone ? (
          <Button
            variant="outline"
            onClick={() => {
              window.open(
                `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
                '_blank',
                'noopener,noreferrer'
              );
              onClose();
            }}
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </Button>
        ) : null}
        <Button
          onClick={() => void openInInbox()}
          disabled={opening || !message.trim()}
        >
          <Send className="h-4 w-4" />
          Open in inbox
        </Button>
      </DialogFooter>
    </>
  );
}
