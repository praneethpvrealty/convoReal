'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Lock,
  RefreshCw,
  ArrowUp,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConsentHop {
  contact_id: string;
  contact_name: string;
  decision: string;
  at: string;
}

interface LocationApprovalRow {
  id: string;
  property_id: string;
  property_title: string;
  property_code: string | null;
  requester_name: string;
  requester_phone: string;
  identity_protected: boolean;
  via_contact_name: string | null;
  status: string;
  consent_chain: ConsentHop[];
  pending_consent_contact_name: string | null;
  consent_requested_at: string | null;
  approved_at: string | null;
  share_sent_at: string | null;
  view_count: number;
  created_at: string;
}

function statusChip(row: LocationApprovalRow) {
  if (row.status === 'pending' && row.pending_consent_contact_name) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-400">
        <Clock className="size-2.5" /> Awaiting{' '}
        {row.pending_consent_contact_name}
      </span>
    );
  }
  switch (row.status) {
    case 'pending':
      return (
        <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
          <Clock className="size-2.5" /> Your decision
        </span>
      );
    case 'approved':
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
          <CheckCircle className="size-2.5" /> Approved
        </span>
      );
    case 'rejected':
      return (
        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
          <XCircle className="size-2.5" /> Rejected
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
          <Clock className="size-2.5" /> Timed out
        </span>
      );
  }
}

function hopLabel(decision: string): { text: string; className: string } {
  switch (decision) {
    case 'approved':
      return { text: 'consented', className: 'text-emerald-400' };
    case 'declined':
      return { text: 'declined', className: 'text-red-400' };
    default:
      return { text: 'timed out', className: 'text-amber-400' };
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Approval-flow tracker for guarded-location reveals: every request,
 * its current stage, and the consent journey hop by hop (each
 * intermediary's decision, then the listing side's final call).
 * Seeker identities on co-broker-attributed requests stay masked.
 */
export function LocationApprovalsPanel() {
  const [rows, setRows] = useState<LocationApprovalRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRows = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/location-requests');
      if (res.ok) {
        const json = await res.json();
        setRows(json.data || []);
      }
    } catch (err) {
      console.error('[location-approvals] fetch failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  if (rows === null) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <MapPin className="text-primary size-4" />
          Location Reveal Approvals
          {rows.filter(
            (r) => r.status === 'pending' && !r.pending_consent_contact_name
          ).length > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
              {
                rows.filter(
                  (r) =>
                    r.status === 'pending' && !r.pending_consent_contact_name
                ).length
              }
            </span>
          )}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fetchRows(true)}
          disabled={refreshing}
          className="h-6 px-2 text-[10px] text-slate-500 hover:text-white"
        >
          <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          No location requests yet. Requests for guarded listings will be
          tracked here through every consent step.
        </p>
      ) : (
        <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/40 p-3.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-bold text-white">
                    {row.property_title}
                    {row.property_code && (
                      <span className="ml-1.5 font-mono text-[10px] font-medium text-slate-500">
                        {row.property_code}
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-slate-400">
                    <User className="size-3 shrink-0" />
                    {row.requester_name} · {row.requester_phone}
                    {row.identity_protected && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] text-amber-400/90"
                        title="Came through a co-broker share — identity stays with the co-broker"
                      >
                        <Lock className="size-2.5" /> protected
                      </span>
                    )}
                  </p>
                </div>
                <div className="shrink-0">{statusChip(row)}</div>
              </div>

              {/* Consent journey */}
              <div className="border-slate-850 space-y-1 border-t pt-2">
                <p className="text-[10px] text-slate-500">
                  Requested {formatWhen(row.created_at)}
                  {row.via_contact_name
                    ? ` · via ${row.via_contact_name}'s link`
                    : ' · direct'}
                </p>
                {row.consent_chain.map((hop, i) => {
                  const label = hopLabel(hop.decision);
                  return (
                    <p
                      key={`${hop.contact_id}-${i}`}
                      className="flex items-center gap-1.5 text-[11px] text-slate-400"
                    >
                      <ArrowUp className="size-3 shrink-0 text-slate-600" />
                      <span className="font-semibold text-slate-300">
                        {hop.contact_name}
                      </span>
                      <span className={`font-bold ${label.className}`}>
                        {label.text}
                      </span>
                      <span className="text-slate-600">
                        {formatWhen(hop.at)}
                      </span>
                    </p>
                  );
                })}
                {row.status === 'pending' &&
                  row.pending_consent_contact_name && (
                    <p className="flex items-center gap-1.5 text-[11px] text-sky-400">
                      <Clock className="size-3 shrink-0" />
                      Waiting on {row.pending_consent_contact_name}
                      {row.consent_requested_at
                        ? ` since ${formatWhen(row.consent_requested_at)} (2h window)`
                        : ''}
                    </p>
                  )}
                {row.status === 'approved' && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <CheckCircle className="size-3 shrink-0" />
                    Approved
                    {row.approved_at ? ` ${formatWhen(row.approved_at)}` : ''}
                    {row.share_sent_at ? ' · link sent via WhatsApp' : ''}
                    {row.view_count > 0 && (
                      <span className="text-primary ml-1 flex items-center gap-1">
                        <Eye className="size-3" />
                        {row.view_count > 1
                          ? `opened ${row.view_count}×`
                          : 'opened'}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
