'use client';

import { useEffect, useMemo, useState } from 'react';
import { Forward, Loader2, Search, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { createClient } from '@/lib/supabase/client';
import { contactFullName } from '@/lib/contacts/full-name';
import { stripDeliveryFailure } from '@/lib/whatsapp/delivery-failure';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';

interface ForwardRow {
  id: string;
  name: string;
  phone: string;
  name_tag?: string | null;
}

interface ForwardResult {
  contact_id: string;
  name: string;
  sent: boolean;
  window_closed?: boolean;
  error?: string;
}

interface ForwardMessageDialogProps {
  /** The message being forwarded; null closes the dialog. */
  message: Message | null;
  onOpenChange: (open: boolean) => void;
}

/** Recipients per forward — matches the cap the API enforces. */
const MAX_RECIPIENTS = 10;

/**
 * Sends one message's text on to other contacts. Contacts are searched
 * server-side rather than listed: an account's book runs to thousands of
 * rows, and forwarding needs one or two of them by name.
 */
export function ForwardMessageDialog({
  message,
  onOpenChange,
}: ForwardMessageDialogProps) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ForwardRow[]>([]);
  const [searching, setSearching] = useState(false);
  // Held as whole rows, not ids: searching again to find the next person
  // must not drop the chips already picked.
  const [picked, setPicked] = useState<ForwardRow[]>([]);
  const [sending, setSending] = useState(false);

  const open = message !== null;
  const preview = useMemo(
    () => stripDeliveryFailure(message?.content_text),
    [message]
  );

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setRows([]);
      setPicked([]);
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open || debounced.length < 2) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const term = `%${debounced}%`;
    // Digits-only match so "+91 97006 06010" finds "+919700606010".
    const digits = debounced.replace(/\D/g, '');
    const or =
      digits.length >= 4
        ? `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},phone.ilike.%${digits}%`
        : `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`;
    createClient()
      .from('contacts')
      .select('id, name, phone, name_tag')
      .or(or)
      .limit(8)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('[forward] contact search failed:', error);
        setRows((data ?? []) as ForwardRow[]);
        setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const toggle = (row: ForwardRow) => {
    setPicked((prev) =>
      prev.some((p) => p.id === row.id)
        ? prev.filter((p) => p.id !== row.id)
        : prev.length >= MAX_RECIPIENTS
          ? prev
          : [...prev, row]
    );
  };

  const handleForward = async () => {
    if (!message || picked.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: message.id,
          contact_ids: picked.map((p) => p.id),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || 'Could not forward this message');
        return;
      }

      const results = (payload?.data?.results ?? []) as ForwardResult[];
      const sent = results.filter((r) => r.sent);
      const blocked = results.filter((r) => !r.sent && r.window_closed);
      const failed = results.filter((r) => !r.sent && !r.window_closed);

      if (sent.length === results.length) {
        toast.success(
          `Forwarded to ${sent.length} contact${sent.length === 1 ? '' : 's'}`
        );
      } else {
        toast.warning(
          sent.length === 0
            ? 'Nothing was forwarded'
            : `Forwarded to ${sent.length} of ${results.length}`,
          {
            description: [
              blocked.length
                ? `Past the 24-hour window — an approved template is needed for: ${blocked
                    .map((r) => r.name)
                    .join(', ')}.`
                : null,
              failed.length
                ? `Could not send to: ${failed.map((r) => r.name).join(', ')}.`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
            duration: 8000,
          }
        );
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to forward message:', err);
      toast.error('Could not forward this message');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-900 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Forward className="text-primary size-4" />
            Forward message
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Sends from your business number into each contact&apos;s own chat. A
            contact who hasn&apos;t messaged in 24 hours needs an approved
            template instead.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-24 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs break-words whitespace-pre-wrap text-slate-300">
          {preview}
        </div>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts by name or phone..."
            aria-label="Search contacts"
            className="focus:ring-primary h-9 w-full rounded-lg border border-slate-800 bg-slate-950 pr-3 pl-8 text-xs text-white placeholder:text-slate-500 focus:ring-1 focus:outline-none"
          />
        </div>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picked.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p)}
                className="border-primary/25 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                aria-label={`Remove ${contactFullName(p)}`}
              >
                {contactFullName(p)}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}

        <div className="min-h-24 space-y-0.5">
          {searching ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Searching…
            </p>
          ) : debounced.length < 2 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Type at least two characters to find a contact.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No matching contacts found
            </p>
          ) : (
            rows.map((row) => {
              const isPicked = picked.some((p) => p.id === row.id);
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => toggle(row)}
                  aria-pressed={isPicked}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-800',
                    isPicked ? 'bg-primary/10 text-primary' : 'text-slate-200'
                  )}
                >
                  <span className="min-w-0 flex-1 pr-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-bold">
                        {contactFullName(row)}
                      </span>
                      <NameTagBadge tag={row.name_tag} />
                    </span>
                    <span className="text-slate-450 mt-0.5 block truncate text-[10px]">
                      📞 {row.phone}
                    </span>
                  </span>
                  {isPicked && <Check className="size-3.5 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <Button
          onClick={handleForward}
          disabled={picked.length === 0 || sending}
          className="w-full"
        >
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Forwarding…
            </>
          ) : (
            `Forward${picked.length > 0 ? ` to ${picked.length}` : ''}`
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
