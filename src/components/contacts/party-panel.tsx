'use client';

/**
 * Who this contact buys with — the household, firm or set of partners
 * sharing one requirement.
 *
 * This is emphatically NOT the merge panel next door. Merge is for one
 * person recorded twice and collapses the rows; linking a party keeps
 * every contact whole (their own number, consent, language and WhatsApp
 * thread) and only changes what the Engine treats as one deal: a single
 * follow-up card instead of one per person, and a silence clock that
 * counts a reply from any member.
 *
 * The wording throughout says "buys with", never "duplicate", so an
 * agent is never one wrong click from destroying a real second person.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Star, Unlink, UsersRound } from 'lucide-react';
import { toast } from 'sonner';

import type { Contact, ContactPartySummary, PartyKind } from '@/types';
import { contactFullName } from '@/lib/contacts/full-name';
import { Button } from '@/components/ui/button';
import { SearchableContactSelect } from '@/components/ui/searchable-contact-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const KIND_LABELS: Record<PartyKind, string> = {
  household: 'Household',
  company: 'Same company',
  partners: 'Partners',
};

interface PartyPanelProps {
  contactId: string;
  /** The book, for picking who to link. The contact themselves and
   *  anyone already linked are filtered out. */
  contacts: Contact[];
  canEdit: boolean;
}

export function PartyPanel({ contactId, contacts, canEdit }: PartyPanelProps) {
  const [party, setParty] = useState<ContactPartySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [kind, setKind] = useState<PartyKind>('household');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/party`);
      const json = (await res.json()) as { data?: ContactPartySummary | null };
      setParty(json.data ?? null);
      if (json.data?.kind) setKind(json.data.kind);
    } catch {
      // A panel that cannot load its own state should stay quiet rather
      // than toast on every contact the agent opens.
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberIds = useMemo(
    () => new Set((party?.members ?? []).map((m) => m.contact_id)),
    [party]
  );
  // The picker declares its own narrower shape (a required name), so
  // an unnamed contact is shown by number rather than dropped.
  const linkable = useMemo(
    () =>
      contacts
        .filter((c) => c.id !== contactId && !memberIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: contactFullName(c) || c.phone || 'Unnamed',
          phone: c.phone ?? null,
          name_tag: c.name_tag ?? null,
        })),
    [contacts, contactId, memberIds]
  );

  const run = async (fn: () => Promise<Response>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || 'That did not work.');
        return;
      }
      toast.success(success);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const link = () => {
    if (!picked) return;
    void run(
      () =>
        fetch(`/api/contacts/${contactId}/party`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_ids: [picked], kind }),
        }),
      'Linked — they now share one follow-up.'
    ).then(() => setPicked(null));
  };

  const makePrimary = (targetId: string) =>
    run(
      () =>
        fetch(`/api/contacts/${contactId}/party`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact_ids: (party?.members ?? [])
              .map((m) => m.contact_id)
              .filter((id) => id !== contactId),
            primary_contact_id: targetId,
            kind,
          }),
        }),
      'Updated who we message.'
    );

  const unlink = (targetId: string) =>
    run(
      () => fetch(`/api/contacts/${targetId}/party`, { method: 'DELETE' }),
      'Unlinked. Their contact record is untouched.'
    );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading who they buy with…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-center gap-2">
        <UsersRound className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-200">Buys with</span>
        {party && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {KIND_LABELS[party.kind]}
          </span>
        )}
      </div>

      {party ? (
        <ul className="space-y-1.5">
          {party.members.map((m) => (
            <li
              key={m.contact_id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs text-slate-200">
                    {m.name || m.phone || 'Unnamed'}
                  </span>
                  {m.is_primary && (
                    <span className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                      <Star className="h-2.5 w-2.5" />
                      we message
                    </span>
                  )}
                </div>
                {m.phone && (
                  <span className="text-[10px] text-slate-500">{m.phone}</span>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  {!m.is_primary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => makePrimary(m.contact_id)}
                      className="text-[10px] text-slate-400 hover:text-amber-300 disabled:opacity-40"
                    >
                      message this one
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => unlink(m.contact_id)}
                    aria-label={`Unlink ${m.name || m.phone || 'contact'}`}
                    className="text-slate-600 transition-colors hover:text-red-400 disabled:opacity-40"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Nobody linked. Link a spouse, partner or colleague working the same
          requirement and the Engine treats them as one deal — one follow-up
          card instead of one each, and a reply from any of them counts.
        </p>
      )}

      {canEdit && (
        <div className="space-y-2 border-t border-slate-800 pt-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableContactSelect
                contacts={linkable}
                value={picked}
                onChange={setPicked}
                placeholder="Add someone who buys with them…"
              />
            </div>
            {!party && (
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as PartyKind)}
              >
                <SelectTrigger className="h-8 w-32 shrink-0 border-slate-800 bg-slate-950 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as PartyKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              disabled={!picked || busy}
              onClick={link}
              className="shrink-0"
            >
              Link
            </Button>
          </div>
          <p className="text-[10px] text-slate-600">
            Linking is not merging: everyone keeps their own number, consent and
            chat. Use Duplicates if this is the same person twice.
          </p>
        </div>
      )}
    </div>
  );
}
