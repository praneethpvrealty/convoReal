'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Clock,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
  X,
  CheckCircle2,
  XCircle,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { gateRequestStatusLabel } from '@/lib/inventory/gate-stats';
import type { Property } from '@/types';

interface GateRequest {
  id: string;
  requester_name: string;
  requester_phone: string;
  status: string;
  scope?: string;
  identity_protected?: boolean;
  created_at: string;
  approved_at: string | null;
  view_count: number | null;
}

interface ActiveGrant {
  id: string;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number | null;
  last_viewed_at: string | null;
  reveal_listing?: boolean;
  contact?: { id: string; name: string | null; phone: string | null } | null;
}

interface GateRequestsDrawerProps {
  property: Property;
  onClose: () => void;
  /** Called after a revoke so the caller can refresh its card counts. */
  onChanged?: () => void;
}

const fmt = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

const STATUS_CLASS: Record<string, string> = {
  pending: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  approved: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  rejected: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
};

function StatusPill({ status }: { status: string }) {
  const cls =
    STATUS_CLASS[status] ??
    'text-slate-400 bg-slate-500/10 border-slate-500/25';
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${cls}`}
    >
      {gateRequestStatusLabel(status)}
    </span>
  );
}

// Who asked for a confidential listing, and who can still open it.
//
// The counts on the card say how much demand there is; this says who,
// and gives the one action the counts imply — revoking a key that is
// still live. Before this, revoking meant editing the database.
export function GateRequestsDrawer({
  property,
  onClose,
  onChanged,
}: GateRequestsDrawerProps) {
  const [requests, setRequests] = useState<GateRequest[]>([]);
  const [grants, setGrants] = useState<ActiveGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, grantRes] = await Promise.all([
        fetch(`/api/properties/${property.id}/location-requests`),
        fetch(`/api/properties/${property.id}/share-grants`),
      ]);
      const reqJson = await reqRes.json().catch(() => ({}));
      const grantJson = await grantRes.json().catch(() => ({}));
      setRequests(
        ((reqJson?.data ?? []) as GateRequest[]).filter(
          (r) => r.scope === 'listing'
        )
      );
      setGrants((grantJson?.data ?? []) as ActiveGrant[]);
    } catch (err) {
      console.error('[gate-requests] load failed:', err);
      toast.error('Could not load access requests');
    } finally {
      setLoading(false);
    }
  }, [property.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isLive = (g: ActiveGrant) =>
    !g.revoked_at && new Date(g.expires_at) > new Date();

  const handleRevoke = async (grant: ActiveGrant) => {
    setRevoking(grant.id);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/share-grants?grant_id=${grant.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to revoke');
      }
      toast.success('Access revoked — their link no longer opens the listing.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setRevoking(null);
    }
  };

  const liveGrants = grants.filter(isLive);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-violet-300 uppercase">
              <ShieldCheck className="size-3" /> Confidential listing
            </div>
            <h3 className="mt-1 truncate text-sm font-bold text-white">
              {property.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-slate-400 uppercase">
                  <KeyRound className="size-3.5" /> Who can open it now
                  <span className="text-slate-600">({liveGrants.length})</span>
                </h4>
                {liveGrants.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nobody. The link shows only the stub to everyone.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {liveGrants.map((g) => (
                      <li
                        key={g.id}
                        className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-white">
                              {g.contact?.name ||
                                g.contact?.phone ||
                                'Anyone with the link'}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Expires {fmt(g.expires_at)}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                              <Eye className="size-3" />
                              {g.view_count ?? 0} view
                              {(g.view_count ?? 0) === 1 ? '' : 's'}
                              {g.last_viewed_at
                                ? ` · last ${fmt(g.last_viewed_at)}`
                                : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revoking === g.id}
                            onClick={() => handleRevoke(g)}
                            className="h-7 shrink-0 gap-1 border-rose-500/30 px-2 text-[11px] text-rose-300 hover:bg-rose-500/10"
                          >
                            {revoking === g.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ShieldOff className="size-3" />
                            )}
                            Revoke
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-slate-400 uppercase">
                  <Clock className="size-3.5" /> Requests
                  <span className="text-slate-600">({requests.length})</span>
                </h4>
                {requests.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nobody has asked for access yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {requests.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-white">
                              {r.requester_name}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">
                              {r.requester_phone}
                            </p>
                            {/* A request that arrived through a
                                co-broker's link keeps their client
                                theirs — the masking is enforced server
                                side, this only explains it. */}
                            {r.identity_protected && (
                              <p className="mt-1 text-[10px] text-slate-500 italic">
                                Came through a co-broker — their client&apos;s
                                details stay private
                              </p>
                            )}
                            <p className="mt-1 text-[11px] text-slate-500">
                              Asked {fmt(r.created_at)}
                              {r.approved_at
                                ? ` · approved ${fmt(r.approved_at)}`
                                : ''}
                            </p>
                          </div>
                          <StatusPill status={r.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="flex items-start gap-1.5 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-slate-600" />
                Approve or reject from the WhatsApp ping, or from the approvals
                panel on your dashboard.
              </p>
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                <XCircle className="mt-px size-3.5 shrink-0 text-slate-600" />
                Revoking closes the page for that recipient and stops their
                photos loading. It cannot recall what they already saved.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
