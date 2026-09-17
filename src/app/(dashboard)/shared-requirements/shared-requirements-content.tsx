'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Check,
  Clock3,
  Inbox,
  Loader2,
  MapPin,
  Search,
  Send,
  X,
} from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';

type Box = 'received' | 'sent';
type ShareStatus = 'sent' | 'viewed' | 'responded' | 'declined';

interface Brief {
  reference: string;
  classification: string;
  requirements: string | null;
  noBudget: boolean;
  minBudget: number | null;
  maxBudget: number | null;
  areas: string[];
  projects: string[];
  propertyTypes: string[];
}

interface Share {
  id: string;
  reference: string;
  brief: Brief;
  senderName: string | null;
  senderAccountName: string;
  status: ShareStatus;
  viewedAt: string | null;
  respondedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  responseCount: number;
}

interface PropertyRow {
  id: string;
  title: string;
  location: string | null;
  price: number | null;
  status: string | null;
}

interface ShareDetail {
  share: Share;
  properties: PropertyRow[];
  responsePropertyIds: string[];
  responseProperties: PropertyRow[];
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

function money(value: number | null): string | null {
  if (!value) return null;
  if (value >= 10_000_000) {
    return `₹${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')} Cr`;
  }
  if (value >= 100_000) {
    return `₹${(value / 100_000).toFixed(2).replace(/\.00$/, '')} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function budget(brief: Brief): string {
  if (brief.noBudget) return 'No fixed budget';
  const min = money(brief.minBudget);
  const max = money(brief.maxBudget);
  if (min && max) return `${min}–${max}`;
  if (max) return `Up to ${max}`;
  if (min) return `Above ${min}`;
  return 'Budget not specified';
}

function statusCopy(status: ShareStatus): string {
  if (status === 'viewed') return 'Viewed';
  if (status === 'responded') return 'Responded';
  if (status === 'declined') return 'Declined';
  return 'Delivered';
}

function BriefBlock({ brief }: { brief: Brief }) {
  return (
    <div className="space-y-2 text-sm text-slate-300">
      {brief.requirements ? (
        <p className="whitespace-pre-wrap leading-6">{brief.requirements}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {budget(brief)}
        </span>
        {brief.propertyTypes.map((type) => (
          <span
            key={type}
            className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
          >
            {type}
          </span>
        ))}
      </div>
      {brief.areas.length ? (
        <p className="flex items-start gap-2 text-xs text-slate-400">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          {brief.areas.join(', ')}
        </p>
      ) : null}
      {brief.projects.length ? (
        <p className="text-xs text-slate-400">
          Projects: {brief.projects.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export function SharedRequirementsContent({
  initialBox,
  initialShareId,
}: {
  initialBox: Box;
  initialShareId: string | null;
}) {
  const queryClient = useQueryClient();
  const [box, setBox] = useState<Box>(initialBox);
  const [selectedId, setSelectedId] = useState<string | null>(initialShareId);
  const [search, setSearch] = useState('');
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const list = useQuery({
    queryKey: ['requirement-account-shares', box],
    queryFn: async () => {
      const body = await readJson<{ data: Share[] }>(
        await fetch(`/api/requirement-account-shares?box=${box}`)
      );
      return body.data;
    },
  });

  const detail = useQuery({
    queryKey: ['requirement-account-share', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const body = await readJson<{ data: ShareDetail }>(
        await fetch(`/api/requirement-account-shares/${selectedId}`)
      );
      return body.data;
    },
  });

  useEffect(() => {
    setSelectedProperties(detail.data?.responsePropertyIds ?? []);
  }, [detail.data?.responsePropertyIds]);

  const respond = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('Select a requirement');
      return readJson<{ data: { responseCount: number } }>(
        await fetch(
          `/api/requirement-account-shares/${selectedId}/respond`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              property_ids: selectedProperties,
              note,
            }),
          }
        )
      );
    },
    onSuccess: async () => {
      toast.success('Matching properties sent to the requesting agent');
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['requirement-account-shares'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['requirement-account-share', selectedId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not respond');
    },
  });

  const decline = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('Select a requirement');
      return readJson<{ data: { status: ShareStatus } }>(
        await fetch(`/api/requirement-account-shares/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'decline' }),
        })
      );
    },
    onSuccess: async () => {
      toast.success('Requirement declined');
      setSelectedId(null);
      await queryClient.invalidateQueries({
        queryKey: ['requirement-account-shares'],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not decline');
    },
  });

  const shown = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return list.data ?? [];
    return (list.data ?? []).filter((share) =>
      [
        share.reference,
        share.senderName,
        share.senderAccountName,
        share.brief.requirements,
        ...share.brief.areas,
        ...share.brief.projects,
        ...share.brief.propertyTypes,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    );
  }, [list.data, search]);

  const selected = detail.data;
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-white">
            <Inbox className="size-6 text-primary" />
            Shared Requirements
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Exchange masked buyer briefs and respond from verified ConvoReal
            inventory without exposing the buyer.
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-800 bg-slate-950/40 p-1">
          {(['received', 'sent'] as Box[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setBox(value);
                setSelectedId(null);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors ${
                box === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {value === 'received' ? (
                <ArrowDownLeft className="size-3.5" />
              ) : (
                <ArrowUpRight className="size-3.5" />
              )}
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search reference, brokerage, area or requirement"
          className="border-slate-800 bg-slate-950/40 pl-9 text-white"
        />
      </div>

      {list.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 text-sm text-rose-300">
          {list.error instanceof Error
            ? list.error.message
            : 'Could not load shared requirements'}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center">
          <Inbox className="mx-auto size-8 text-slate-600" />
          <p className="mt-3 font-semibold text-slate-300">
            No {box} requirements yet
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {box === 'received'
              ? 'Requirements shared directly with your account will appear here.'
              : 'Use the share action on a buyer requirement to send it to a registered agent.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {shown.map((share) => (
            <button
              key={share.id}
              type="button"
              onClick={() => setSelectedId(share.id)}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-white">{share.reference}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                    <Building2 className="size-3.5" />
                    {share.senderAccountName}
                    {share.senderName ? ` · ${share.senderName}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                  {statusCopy(share.status)}
                </span>
              </div>
              <div className="mt-4">
                <BriefBlock brief={share.brief} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock3 className="size-3" />
                  {formatDistanceToNowStrict(new Date(share.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                {share.responseCount > 0 ? (
                  <span className="font-semibold text-emerald-400">
                    {share.responseCount} match
                    {share.responseCount === 1 ? '' : 'es'}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selected?.share.reference || 'Shared requirement'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selected
                ? `Shared by ${selected.share.senderAccountName}${
                    selected.share.senderName
                      ? ` · ${selected.share.senderName}`
                      : ''
                  }`
                : 'Loading the masked buyer brief…'}
            </DialogDescription>
          </DialogHeader>

          {detail.isPending ? (
            <div className="flex min-h-48 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : detail.isError ? (
            <p className="text-sm text-rose-300">
              {detail.error instanceof Error
                ? detail.error.message
                : 'Could not load the requirement'}
            </p>
          ) : selected ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <BriefBlock brief={selected.share.brief} />
              </div>

              {box === 'received' ? (
                <>
                  <div>
                    <h3 className="font-bold text-white">
                      Select matching inventory
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Only properties from your account can be returned. Buyer
                      identity remains hidden.
                    </p>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {selected.properties.length ? (
                      selected.properties.map((property) => {
                        const checked = selectedProperties.includes(property.id);
                        return (
                          <button
                            key={property.id}
                            type="button"
                            onClick={() =>
                              setSelectedProperties((current) =>
                                current.includes(property.id)
                                  ? current.filter((id) => id !== property.id)
                                  : [...current, property.id]
                              )
                            }
                            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
                              checked
                                ? 'border-primary bg-primary/10'
                                : 'border-slate-800 bg-slate-950/30'
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-slate-600'
                              }`}
                            >
                              {checked ? <Check className="size-3.5" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-white">
                                {property.title}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {[property.location, money(property.price), property.status]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-sm text-slate-500">
                        No active inventory is available to send.
                      </p>
                    )}
                  </div>
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Optional note to the requesting agent"
                    maxLength={1000}
                    className="border-slate-800 bg-slate-950/40 text-white"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => decline.mutate()}
                      disabled={decline.isPending || respond.isPending}
                      className="border-slate-700 text-slate-300"
                    >
                      {decline.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <X className="size-4" />
                      )}
                      No matching property
                    </Button>
                    <Button
                      onClick={() => respond.mutate()}
                      disabled={
                        selectedProperties.length === 0 || respond.isPending
                      }
                    >
                      {respond.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Send {selectedProperties.length || ''} match
                      {selectedProperties.length === 1 ? '' : 'es'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <h3 className="font-bold text-white">Agent response</h3>
                  {selected.responseProperties.length ? (
                    selected.responseProperties.map((property) => (
                      <div
                        key={property.id}
                        className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
                      >
                        <p className="font-semibold text-white">
                          {property.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {[property.location, money(property.price), property.status]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                      {selected.share.status === 'declined'
                        ? 'The receiving agent reported no matching property.'
                        : 'No properties have been returned yet.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
