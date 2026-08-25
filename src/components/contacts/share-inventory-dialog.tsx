'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, MessageCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  formatShareAmount,
  propertyShowcaseUrl,
} from '@/lib/share-message-builder';
import type { Property } from '@/types';

interface ShareInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
  properties: Property[];
  showcaseBaseUrl: string;
}

interface ShareStatus {
  registered: boolean;
  recipientName: string;
}

interface ShareResult extends ShareStatus {
  sharedCount: number;
  alreadySharedCount: number;
}

interface IssuedInvite {
  shareMessage: string;
  error?: string;
}

async function readJson<T>(
  response: Response
): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export function ShareInventoryDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  properties,
  showcaseBaseUrl,
}: ShareInventoryDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [includeInvite, setIncludeInvite] = useState(false);
  const [sending, setSending] = useState(false);

  const status = useQuery({
    queryKey: ['agent-inventory-share-status', contactId],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/contacts/${contactId}/share-inventory`
      );
      const body = await readJson<{ data: ShareStatus }>(response);
      if (!response.ok)
        throw new Error(body.error || 'Could not check this agent');
      return body.data;
    },
  });

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch('');
      setIncludeInvite(false);
    }
  }, [open]);

  const available = useMemo(
    () =>
      properties.filter((property) => {
        if (property.status !== 'Available') return false;
        const haystack =
          `${property.title} ${property.location} ${property.type}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      }),
    [properties, search]
  );
  const selectedProperties = properties.filter((property) =>
    selected.has(property.id)
  );
  const registered = status.data?.registered === true;
  const canSend =
    !status.isPending &&
    !status.isError &&
    (selected.size > 0 || (!registered && includeInvite));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 25) next.add(id);
      else toast.error('Choose no more than 25 properties at a time');
      return next;
    });
  }

  async function send() {
    if (!canSend || sending) return;
    const popup = window.open('', '_blank');
    setSending(true);
    try {
      const shareResponse = await fetch(
        `/api/contacts/${contactId}/share-inventory`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_ids: [...selected] }),
        }
      );
      const shareBody = await readJson<{ data: ShareResult }>(shareResponse);
      if (!shareResponse.ok) {
        throw new Error(shareBody.error || 'Could not share this inventory');
      }

      let inviteMessage = '';
      if (!shareBody.data.registered && includeInvite) {
        const inviteResponse = await fetch('/api/beta-invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: contactName || null,
            invitee_phone: contactPhone,
          }),
        });
        const invite = await readJson<IssuedInvite>(inviteResponse);
        if (!inviteResponse.ok) {
          throw new Error(
            invite.error || 'Could not create the app invitation'
          );
        }
        inviteMessage = invite.shareMessage;
      }

      const firstName = contactName.trim().split(/\s+/)[0] || 'there';
      const propertyLines = selectedProperties.map((property, index) => {
        const base = propertyShowcaseUrl(showcaseBaseUrl, property);
        const separator = base.includes('?') ? '&' : '?';
        const url = `${base}${separator}mode=view&v=${encodeURIComponent(contactId)}`;
        const details = [
          property.location,
          formatShareAmount(property.price),
        ].filter(Boolean);
        return `${index + 1}. *${property.title}*${details.length ? ` — ${details.join(' · ')}` : ''}\n${url}`;
      });
      const sections = [
        propertyLines.length
          ? `Hi ${firstName}, sharing ${propertyLines.length === 1 ? 'a property' : `${propertyLines.length} properties`} from my inventory:\n\n${propertyLines.join('\n\n')}`
          : '',
        shareBody.data.registered && propertyLines.length
          ? 'I’ve also shared these directly to your ConvoReal inventory. Please review them under Pending Review.'
          : '',
        inviteMessage,
      ].filter(Boolean);
      const whatsappUrl = `https://wa.me/${contactPhone.replace(/\D/g, '')}?text=${encodeURIComponent(sections.join('\n\n'))}`;
      if (popup) popup.location.href = whatsappUrl;
      else window.location.href = whatsappUrl;

      if (shareBody.data.registered) {
        toast.success(
          shareBody.data.sharedCount > 0
            ? `${shareBody.data.sharedCount} ${shareBody.data.sharedCount === 1 ? 'property' : 'properties'} added to ${contactName || 'the agent'}’s review queue`
            : 'Those properties are already in this agent’s inventory'
        );
      } else if (includeInvite) {
        toast.success(
          'WhatsApp opened with the properties and ConvoReal invite'
        );
      } else {
        toast.success('WhatsApp opened with the selected properties');
      }
      onOpenChange(false);
    } catch (error) {
      popup?.close();
      toast.error(
        error instanceof Error ? error.message : 'Could not share inventory'
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden border-slate-800 bg-slate-900 p-0 text-white">
        <DialogHeader className="px-5 pt-5 pr-14">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-5 text-emerald-400" />
            Share inventory with {contactName || 'agent'}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-slate-400">
            Choose any properties to send on WhatsApp. If this agent uses
            ConvoReal, they also enter their Pending Review queue with your
            attribution intact.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5">
          {status.isPending ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
              <Loader2 className="size-4 animate-spin" /> Checking whether this
              agent uses ConvoReal…
            </div>
          ) : status.isError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              {(status.error as Error).message}
            </div>
          ) : registered ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              ConvoReal account found — selected properties will be added for
              review automatically.
            </div>
          ) : (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
              <input
                type="checkbox"
                checked={includeInvite}
                onChange={(event) => setIncludeInvite(event.target.checked)}
                className="mt-0.5 size-4 accent-violet-500"
              />
              <span className="text-xs leading-relaxed text-violet-100">
                <b>Also invite {contactName || 'this agent'} to ConvoReal.</b>{' '}
                The personal app invite will be added at the end of the WhatsApp
                message.
              </span>
            </label>
          )}

          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-slate-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search available inventory"
              className="border-slate-700 bg-slate-950 pl-9"
            />
          </div>

          <div className="space-y-2 pb-2">
            {available.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No available properties match this search.
              </p>
            ) : (
              available.map((property) => {
                const checked = selected.has(property.id);
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => toggle(property.id)}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${checked ? 'border-violet-500 bg-violet-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}
                  >
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded border ${checked ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-600'}`}
                    >
                      {checked && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-100">
                        {property.title}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {[property.location, formatShareAmount(property.price)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/50 px-5 py-4">
          <span className="text-xs text-slate-400">
            {selected.size} selected
          </span>
          <Button
            onClick={send}
            disabled={!canSend || sending}
            className="gap-2 bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageCircle className="size-4" />
            )}
            Open WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
