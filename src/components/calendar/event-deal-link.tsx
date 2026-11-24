'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { DealForm, type DealFormSeed } from '@/components/pipelines/deal-form';
import {
  dealOptionDetail,
  fetchDealsForEvent,
  searchDeals,
  type DealOption,
} from '@/lib/deals/event-deal-options';
import {
  dealTitleFromEvent,
  participantsFromEvent,
} from '@/lib/deals/participants';
import { createClient } from '@/lib/supabase/client';
import type { PipelineStage } from '@/types';

import type { CalendarEvent } from './event-types';

interface EventDealLinkProps {
  event: CalendarEvent;
  contacts: readonly {
    id: string;
    name?: string | null;
    classification?: string | null;
  }[];
  properties: readonly {
    id: string;
    title: string;
    owner_contact_id?: string | null;
  }[];
  canEdit: boolean;
  onChanged: (deal: { id: string; title: string } | null) => void;
  onDealCreated: () => void;
}

/**
 * The deal a calendar event belongs to: open it, disconnect it,
 * connect the event to an existing deal, or start a new deal from the
 * event's contacts and property. Mobile parity:
 * mobile/components/event-deal-link.tsx.
 */
export function EventDealLink({
  event,
  contacts,
  properties,
  canEdit,
  onChanged,
  onDealCreated,
}: EventDealLinkProps) {
  const supabase = useMemo(() => createClient(), []);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const term = search.trim();

  const suggestions = useQuery({
    queryKey: ['event-deal-suggestions', event.id],
    enabled: picking,
    queryFn: () => fetchDealsForEvent(supabase, event),
  });
  const results = useQuery({
    queryKey: ['event-deal-search', term],
    enabled: picking && term.length >= 2,
    queryFn: () => searchDeals(supabase, term),
  });
  const pipeline = useQuery({
    queryKey: ['event-deal-pipeline'],
    enabled: creating,
    queryFn: async () => {
      const { data: pipelines, error } = await supabase
        .from('pipelines')
        .select('id')
        .order('created_at')
        .limit(1);
      if (error) throw error;
      const pipelineId = pipelines?.[0]?.id as string | undefined;
      if (!pipelineId) return null;
      const { data: stages, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      if (stageError) throw stageError;
      return { pipelineId, stages: (stages ?? []) as PipelineStage[] };
    },
  });

  const seed = useMemo<DealFormSeed>(() => {
    const property = properties.find((p) => p.id === event.property_id);
    const participants = participantsFromEvent(
      event,
      contacts,
      property?.owner_contact_id
    );
    const lead =
      participants.find((p) => p.role === 'buyer') ?? participants[0];
    return {
      appointmentId: event.id,
      title: dealTitleFromEvent({
        eventTitle: event.title,
        propertyTitle: property?.title,
        contactName: contacts.find((c) => c.id === lead?.contact_id)?.name,
      }),
      participants: lead
        ? [lead, ...participants.filter((p) => p !== lead)]
        : [],
      propertyId: event.property_id ?? null,
    };
  }, [event, contacts, properties]);

  async function link(next: DealOption | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/appointments/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: next?.id ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(
          data?.error ||
            (next
              ? 'Could not connect this event to the deal'
              : 'Could not disconnect the deal')
        );
        return;
      }
      toast.success(next ? 'Event connected to the deal' : 'Deal disconnected');
      setPicking(false);
      setSearch('');
      onChanged(next ? { id: next.id, title: next.title } : null);
    } catch {
      toast.error('Could not update this event');
    } finally {
      setBusy(false);
    }
  }

  if (event.deal) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <Briefcase className="text-primary h-4 w-4 shrink-0" />
        <Link
          href={`/deals/${event.deal.id}`}
          className="text-primary min-w-0 flex-1 truncate text-sm font-semibold hover:underline"
        >
          Deal: {event.deal.title}
        </Link>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void link(null)}
            aria-label="Disconnect this event from the deal"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    );
  }

  if (!canEdit) return null;

  const options = term.length >= 2 ? results.data : suggestions.data;
  const loading = term.length >= 2 ? results.isLoading : suggestions.isLoading;

  return (
    <div>
      {!picking ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="text-primary flex items-center gap-2 text-sm font-semibold hover:underline"
        >
          <Briefcase className="h-4 w-4" />
          Connect to a deal
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              Connect to a deal
            </span>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setSearch('');
              }}
              aria-label="Cancel connecting a deal"
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Create a new deal from this event
          </button>
          <p className="text-[11px] font-medium text-slate-500">
            Starts with this event&apos;s contacts and property. Or pick an
            existing deal:
          </p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            placeholder="Search deals by title"
            aria-label="Search deals"
            className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
          />
          {loading ? (
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
          ) : !options?.length ? (
            <p className="text-xs text-slate-500">
              {term.length >= 2
                ? 'No deal matches that search.'
                : 'No deal yet with this property or these contacts. Search by title, or create one.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void link(option)}
                    className="hover:border-primary flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left disabled:opacity-50"
                  >
                    <Briefcase className="text-primary h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">
                        {option.title}
                      </span>
                      {dealOptionDetail(option) && (
                        <span className="block truncate text-[11px] text-slate-500">
                          {dealOptionDetail(option)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {creating && pipeline.isError && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-400">
          Could not load your pipeline. Try again.
        </p>
      )}
      {creating && pipeline.data === null && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-400">
          Open Deals once to set up your pipeline, then try again.
        </p>
      )}
      {pipeline.data && (
        <DealForm
          open={creating}
          onOpenChange={setCreating}
          pipelineId={pipeline.data.pipelineId}
          stages={pipeline.data.stages}
          seed={seed}
          onSaved={() => {
            setPicking(false);
            onDealCreated();
          }}
        />
      )}
    </div>
  );
}
