'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bookmark,
  ChevronDown,
  FileText,
  Flame,
  Inbox,
  MapPin,
  MessageCircle,
  MessageSquareReply,
  RefreshCw,
  Star,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
  PULSE_ENQUIRY_COUNT_DAYS,
  PULSE_ENQUIRY_FILTERS,
  PULSE_ENQUIRY_KINDS,
  PULSE_ENQUIRY_KIND_LABELS,
  describePulseEnquiry,
  filterPulseEnquiries,
  nextPulseEnquiryCursor,
  pulseEnquiryIsHot,
  pulseEnquiryVisitor,
  type PulseEnquiryCursor,
  type PulseEnquiryFilter,
  type PulseEnquiryKind,
  type PulseEnquiryRow,
} from '@/lib/pulse/enquiries';
import {
  loadPulseEnquiries,
  loadPulseEnquiryCounts,
} from '@/lib/pulse/enquiries-queries';
import { formatDate } from '@/lib/format/date';

interface EnquiriesPanelProps {
  accountId: string;
}

const KIND_ICONS: Record<PulseEnquiryKind, React.ReactNode> = {
  enquiry: <Inbox className="size-4 text-sky-400" />,
  location_request: <MapPin className="size-4 text-amber-400" />,
  document_request: <FileText className="size-4 text-purple-400" />,
  rating: <Star className="size-4 text-yellow-400" />,
  shortlist: <Bookmark className="size-4 text-emerald-400" />,
  whatsapp_tap: <MessageCircle className="size-4 text-green-400" />,
  check_in: <MessageSquareReply className="text-primary size-4" />,
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return formatDate(iso);
}

export function EnquiriesPanel({ accountId }: EnquiriesPanelProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<PulseEnquiryFilter>('all');
  const [older, setOlder] = useState<{
    rows: PulseEnquiryRow[];
    cursor: PulseEnquiryCursor | null;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const countsQuery = useQuery({
    queryKey: ['pulse-enquiry-counts', accountId],
    queryFn: () => loadPulseEnquiryCounts(createClient(), accountId),
    staleTime: 60_000,
  });
  const rowsQuery = useQuery({
    queryKey: ['pulse-enquiries', accountId],
    queryFn: () => loadPulseEnquiries(createClient(), accountId),
    staleTime: 60_000,
  });

  const firstPage = rowsQuery.data ?? [];
  const rows = [...firstPage, ...(older?.rows ?? [])];
  const cursor = older ? older.cursor : nextPulseEnquiryCursor(firstPage);
  const visible = filterPulseEnquiries(rows, filter);
  const counts = countsQuery.data;

  const loadOlder = async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await loadPulseEnquiries(createClient(), accountId, cursor);
      setOlder((current) => ({
        rows: [...(current?.rows ?? []), ...page],
        cursor: nextPulseEnquiryCursor(page),
      }));
    } catch (err) {
      console.error('[pulse] older enquiries failed:', err);
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="space-y-4" data-pulse-enquiries>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {PULSE_ENQUIRY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilter(filter === kind ? 'all' : kind)}
            aria-pressed={filter === kind}
            className={`flex cursor-pointer items-center justify-between rounded-xl border p-3.5 text-left transition-all ${
              filter === kind
                ? 'border-primary bg-primary/10'
                : 'border-slate-800 bg-slate-900 hover:border-slate-700'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                {PULSE_ENQUIRY_KIND_LABELS[kind]}
              </p>
              <p className="mt-1 text-xl font-black text-white">
                {counts ? counts[kind] : '…'}
              </p>
            </div>
            <span className="shrink-0">{KIND_ICONS[kind]}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Last {PULSE_ENQUIRY_COUNT_DAYS} days. Tap a tile to filter the list
        below.
      </p>

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-black tracking-wider text-white uppercase">
              <Inbox className="text-primary size-4" />
              Enquiries &amp; requests
              <InfoHint text="Every enquiry, exact-location and document request, fit rating, shortlist, WhatsApp tap and check-in from your showcase, newest first. A flame marks what deserves a follow-up today." />
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Form and portal enquiries reach the Inbox and Today as well;
              everything else is only here.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {PULSE_ENQUIRY_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all ${
                  filter === option.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {rowsQuery.isPending ? (
          <p className="py-10 text-center text-xs font-bold text-slate-500">
            Loading enquiries…
          </p>
        ) : rowsQuery.isError ? (
          <p className="py-10 text-center text-xs font-bold text-rose-400">
            Enquiries could not be loaded. Refresh to retry.
          </p>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
            <Inbox className="text-slate-650 mx-auto mb-3 size-8" />
            <p className="text-xs font-bold text-slate-500">
              {rows.length === 0
                ? 'No enquiries or requests from your showcase yet'
                : 'Nothing of this kind yet'}
            </p>
          </div>
        ) : (
          <ul className="max-h-[600px] space-y-2 overflow-y-auto pr-2">
            {visible.map((row) => {
              const visitor = pulseEnquiryVisitor(row);
              const hot = pulseEnquiryIsHot(row);
              return (
                <li
                  key={`${row.kind}:${row.id}`}
                  className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/20 p-3.5"
                >
                  <span className="mt-0.5 shrink-0">
                    {KIND_ICONS[row.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-xs font-black text-white">
                      {row.contact_id ? (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/contacts?contactId=${row.contact_id}`)
                          }
                          className="hover:text-primary cursor-pointer truncate hover:underline"
                        >
                          {visitor.label}
                        </button>
                      ) : (
                        <span className="truncate">{visitor.label}</span>
                      )}
                      {hot && (
                        <span className="flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-black text-orange-400">
                          <Flame className="size-3" />
                          Follow up
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed font-medium text-slate-400">
                      {describePulseEnquiry(row)}
                      {row.property_code ? (
                        <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                          {row.property_code}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">
                      {timeAgo(row.occurred_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {cursor && !rowsQuery.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="w-full cursor-pointer rounded-xl border border-slate-800 text-xs font-bold text-slate-400 hover:bg-slate-900/40 hover:text-white"
          >
            {loadingOlder ? (
              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <ChevronDown className="mr-1.5 size-3.5" />
            )}
            {loadingOlder
              ? 'Loading older enquiries...'
              : 'Load older enquiries'}
          </Button>
        )}
      </div>
    </div>
  );
}
