'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RadarManualContact } from '@/types';

function contactName(contact: RadarManualContact): string {
  return (
    [contact.name, contact.second_name].filter(Boolean).join(' ') ||
    contact.phone
  );
}

export function ManualContactPicker({
  eventId,
  matchedCount,
  value,
  onChange,
}: {
  eventId: string;
  matchedCount: number;
  value: RadarManualContact[];
  onChange: (contacts: RadarManualContact[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [draft, setDraft] = useState<Map<string, RadarManualContact>>(
    new Map()
  );
  const maxManual = Math.max(0, 20 - matchedCount);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const contacts = useQuery({
    queryKey: ['radar-manual-contacts', eventId, debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams({ eventId, q: debounced });
      const response = await fetch(`/api/radar/contacts?${params.toString()}`);
      const payload = (await response.json()) as {
        data?: RadarManualContact[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || 'Could not search contacts');
      return payload.data ?? [];
    },
  });

  const results = useMemo(
    () => (contacts.data ?? []).filter((contact) => !draft.has(contact.id)),
    [contacts.data, draft]
  );

  const toggle = (contact: RadarManualContact) => {
    setDraft((current) => {
      const next = new Map(current);
      if (next.has(contact.id)) next.delete(contact.id);
      else if (next.size < maxManual) next.set(contact.id, contact);
      return next;
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={maxManual === 0}
        onClick={() => {
          setDraft(new Map(value.map((contact) => [contact.id, contact])));
          setOpen(true);
        }}
        className="border-slate-750 hover:bg-slate-850 h-7 rounded-lg text-[11px] font-bold text-slate-300"
      >
        <UserPlus className="mr-1 size-3.5" />
        Add contacts{value.length > 0 ? ` (${value.length})` : ''}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSearch('');
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add contacts</DialogTitle>
            <DialogDescription>
              Search active Buyers or Agents who were not suggested by this
              match.
            </DialogDescription>
          </DialogHeader>

          {draft.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...draft.values()].map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => toggle(contact)}
                  className="border-primary/30 bg-primary/10 text-primary rounded-full border px-2 py-1 text-[11px] font-semibold"
                  aria-label={`Remove ${contactName(contact)}`}
                >
                  {contactName(contact)} ×
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, tag or phone"
              className="focus:border-primary h-10 w-full rounded-lg border border-slate-700 bg-slate-950/50 pr-3 pl-9 text-sm outline-none placeholder:text-slate-600"
            />
          </div>

          <div className="max-h-72 min-h-32 space-y-2 overflow-y-auto">
            {debounced.length < 2 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                Type at least 2 characters to search.
              </p>
            ) : contacts.isFetching ? (
              <p className="py-8 text-center text-xs text-slate-500">
                Searching…
              </p>
            ) : contacts.isError ? (
              <p className="py-8 text-center text-xs text-rose-400">
                {contacts.error instanceof Error
                  ? contacts.error.message
                  : 'Search failed'}
              </p>
            ) : results.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No other eligible contacts found.
              </p>
            ) : (
              results.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  disabled={draft.size >= maxManual}
                  onClick={() => toggle(contact)}
                  className="hover:border-primary/40 flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-left disabled:opacity-50"
                >
                  <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-black">
                    {contactName(contact).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-white">
                      {contactName(contact)}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {contact.phone}
                      {contact.name_tag ? ` · ${contact.name_tag}` : ''}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {contact.classification}
                  </span>
                </button>
              ))
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                onChange([...draft.values()]);
                setOpen(false);
              }}
              className="rounded-lg"
            >
              Add {draft.size} contact{draft.size === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
