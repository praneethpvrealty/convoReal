'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  const [edited, setEdited] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [closedThreadId, setClosedThreadId] = useState<string | null>(null);

  const { data: showcaseBase } = useQuery({
    queryKey: ['showcase-base', accountId],
    queryFn: () => accountShowcaseBase(supabase, accountId!),
    enabled: Boolean(accountId),
    staleTime: Infinity,
  });
  const propertyUrl =
    showcaseBase && property && contact
      ? `${propertyShowcaseUrl(showcaseBase, property)}&v=${encodeURIComponent(contact.id)}`
      : null;

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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .gte('created_at', since);
    if ((count ?? 0) === 0) {
      setOpening(false);
      setClosedThreadId(conversation.id);
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
        {closedThreadId ? (
          <p
            role="status"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200"
          >
            {name} hasn&apos;t written in the last 24 hours, so WhatsApp only
            accepts an approved template from the inbox. Send this draft with
            the WhatsApp button, or{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => router.push(`/inbox?c=${closedThreadId}`)}
            >
              open the chat to pick a template
            </button>
            .
          </p>
        ) : null}
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
          disabled={opening || !message.trim() || closedThreadId !== null}
        >
          <Send className="h-4 w-4" />
          Open in inbox
        </Button>
      </DialogFooter>
    </>
  );
}
