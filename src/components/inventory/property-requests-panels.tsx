'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  MapPin,
  Lock,
  FileText,
  Copy,
  Check,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
} from 'lucide-react';

interface PropertyRequestsPanelsProps {
  property?: Property | null;
  refreshKey: number;
}

export function PropertyRequestsPanels({
  property,
  refreshKey,
}: PropertyRequestsPanelsProps) {
  const { accountId } = useAuth();

  // Document Requests management
  interface DocRequest {
    id: string;
    requester_name: string;
    requester_phone: string;
    requester_email: string | null;
    status: 'pending' | 'approved' | 'rejected';
    share_token: string | null;
    share_token_expires_at: string | null;
    share_sent_at: string | null;
    viewed_at: string | null;
    view_count: number;
    last_viewed_at: string | null;
    created_at: string;
  }
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  const [docRequestsLoading, setDocRequestsLoading] = useState(false);
  const [processingDocReqId, setProcessingDocReqId] = useState<string | null>(
    null
  );
  const [copiedLinkReqId, setCopiedLinkReqId] = useState<string | null>(null);

  const fetchDocRequests = useCallback(async () => {
    if (!property?.id || !accountId) return;
    setDocRequestsLoading(true);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/document-requests`
      );
      if (res.ok) {
        const json = await res.json();
        setDocRequests(json.data || []);
      }
    } catch (e) {
      console.error('[fetchDocRequests]', e);
    } finally {
      setDocRequestsLoading(false);
    }
  }, [property?.id, accountId]);

  const handleDocRequestAction = async (
    reqId: string,
    action: 'approve' | 'reject'
  ) => {
    if (!property?.id) return;
    setProcessingDocReqId(reqId);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/document-requests`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: reqId, action }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');

      if (action === 'approve') {
        toast.success(
          'Request approved! Documents link sent to requester via WhatsApp.'
        );
        // Copy link to clipboard automatically
        if (json.share_link) {
          navigator.clipboard.writeText(json.share_link).catch(() => {});
          setCopiedLinkReqId(reqId);
          setTimeout(() => setCopiedLinkReqId(null), 3000);
        }
      } else {
        toast.info('Request rejected.');
      }
      await fetchDocRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    } finally {
      setProcessingDocReqId(null);
    }
  };

  const copyShareLink = (req: DocRequest) => {
    const appBase = window.location.origin;
    const link = `${appBase}/docs/${req.share_token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLinkReqId(req.id);
      setTimeout(() => setCopiedLinkReqId(null), 3000);
      toast.success('Share link copied!');
    });
  };

  interface LocRequest {
    id: string;
    requester_name: string;
    requester_phone: string;
    status: string;
    identity_protected?: boolean;
    via_contact_id: string | null;
    pending_consent_contact_id: string | null;
    share_token: string | null;
    share_token_expires_at: string | null;
    share_sent_at: string | null;
    view_count: number;
    last_viewed_at: string | null;
    created_at: string;
  }
  const [locRequests, setLocRequests] = useState<LocRequest[]>([]);
  const [locRequestsLoading, setLocRequestsLoading] = useState(false);
  const [processingLocReqId, setProcessingLocReqId] = useState<string | null>(
    null
  );

  const fetchLocRequests = useCallback(async () => {
    if (!property?.id || !accountId) return;
    setLocRequestsLoading(true);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/location-requests`
      );
      if (res.ok) {
        const json = await res.json();
        setLocRequests(json.data || []);
      }
    } catch (e) {
      console.error('[fetchLocRequests]', e);
    } finally {
      setLocRequestsLoading(false);
    }
  }, [property?.id, accountId]);

  const handleLocRequestAction = async (
    reqId: string,
    action: 'approve' | 'reject'
  ) => {
    if (!property?.id) return;
    setProcessingLocReqId(reqId);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/location-requests`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: reqId, action }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      if (action === 'approve') {
        toast.success(
          'Request approved! Location link sent to the requester via WhatsApp.'
        );
        if (json.share_link) {
          navigator.clipboard.writeText(json.share_link).catch(() => {});
        }
      } else {
        toast.info(
          'Request rejected — the requester has been redirected to their sharer.'
        );
      }
      await fetchLocRequests();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setProcessingLocReqId(null);
    }
  };

  // Fetch document requests when form opens for an existing property (view mode)
  useEffect(() => {
    if (property?.id) {
      fetchDocRequests();
    } else {
      setDocRequests([]);
    }
  }, [property?.id, fetchDocRequests, refreshKey]);

  useEffect(() => {
    if (property?.id) {
      fetchLocRequests();
    } else {
      setLocRequests([]);
    }
  }, [property?.id, fetchLocRequests]);

  return (
    <>
      {/* Document Requests Panel */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <FileText className="text-primary size-3.5" />
            Document Requests
            {docRequests.filter((r) => r.status === 'pending').length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
                {docRequests.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fetchDocRequests}
            disabled={docRequestsLoading}
            className="h-6 px-2 text-[10px] text-slate-500 hover:text-white"
          >
            {docRequestsLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              'Refresh'
            )}
          </Button>
        </div>

        {docRequestsLoading && docRequests.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading requests...
          </div>
        ) : docRequests.length === 0 ? (
          <div className="border-slate-850 rounded-xl border bg-slate-950/20 p-4 text-center text-xs text-slate-500">
            No document requests yet. Requests submitted via the property
            showcase will appear here.
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {docRequests.map((req) => {
              const isExpired = req.share_token_expires_at
                ? new Date() > new Date(req.share_token_expires_at)
                : false;
              return (
                <div
                  key={req.id}
                  className={`space-y-2 rounded-xl border p-3.5 text-xs transition-colors ${
                    req.status === 'pending'
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : req.status === 'approved'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-slate-800 bg-slate-900/20 opacity-60'
                  }`}
                >
                  {/* Requester Info */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-bold text-white">
                        {req.requester_name}
                      </p>
                      <p className="text-slate-400">{req.requester_phone}</p>
                      {req.requester_email && (
                        <p className="text-slate-500">{req.requester_email}</p>
                      )}
                      <p className="text-[10px] text-slate-600">
                        {new Date(req.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {req.status === 'pending' && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                          <Clock className="size-2.5" /> Pending
                        </span>
                      )}
                      {req.status === 'approved' && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                          <CheckCircle className="size-2.5" /> Approved
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          <XCircle className="size-2.5" /> Rejected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {req.status === 'pending' && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={processingDocReqId === req.id}
                        onClick={() =>
                          handleDocRequestAction(req.id, 'approve')
                        }
                        className="flex h-7 flex-1 items-center justify-center gap-1 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-500"
                      >
                        {processingDocReqId === req.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle className="size-3" />
                        )}
                        Approve & Send
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={processingDocReqId === req.id}
                        onClick={() => handleDocRequestAction(req.id, 'reject')}
                        className="flex h-7 items-center gap-1 border-red-500/30 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <XCircle className="size-3" /> Reject
                      </Button>
                    </div>
                  )}

                  {/* Share link for approved requests */}
                  {req.status === 'approved' && req.share_token && (
                    <div className="flex items-center gap-2 pt-1">
                      {isExpired ? (
                        <span className="flex items-center gap-1 text-[10px] text-amber-500">
                          <Clock className="size-3" /> Link expired
                        </span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Clock className="size-3" />
                            Expires:{' '}
                            {new Date(
                              req.share_token_expires_at!
                            ).toLocaleDateString('en-IN')}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => copyShareLink(req)}
                            className="ml-auto flex h-6 items-center gap-1 border-slate-700 text-[10px] text-slate-400 hover:text-white"
                          >
                            {copiedLinkReqId === req.id ? (
                              <>
                                <Check className="size-3 text-emerald-400" />{' '}
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="size-3" /> Copy Link
                              </>
                            )}
                          </Button>
                        </>
                      )}
                      {req.share_sent_at && (
                        <span className="ml-1 flex items-center gap-1 text-[10px] text-emerald-500">
                          <CheckCircle className="size-3" />
                          Sent via WA
                        </span>
                      )}
                      {req.viewed_at && (
                        <span
                          className="text-primary ml-1 flex items-center gap-1 text-[10px]"
                          title={[
                            `First opened ${new Date(req.viewed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
                            req.view_count > 1 && req.last_viewed_at
                              ? `Last opened ${new Date(req.last_viewed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} — may include a forwarded open`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <Eye className="size-3" />
                          {req.view_count > 1
                            ? `Viewed ${req.view_count}×`
                            : 'Viewed'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Location Reveal Requests Panel */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <MapPin className="text-primary size-3.5" />
            Location Requests
            {locRequests.filter((r) => r.status === 'pending').length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
                {locRequests.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fetchLocRequests}
            disabled={locRequestsLoading}
            className="h-6 px-2 text-[10px] text-slate-500 hover:text-white"
          >
            {locRequestsLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              'Refresh'
            )}
          </Button>
        </div>

        {locRequestsLoading && locRequests.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading requests...
          </div>
        ) : locRequests.length === 0 ? (
          <div className="border-slate-850 rounded-xl border bg-slate-950/20 p-4 text-center text-xs text-slate-500">
            No location requests yet. Requests from the showcase&apos;s
            &quot;Request Exact Location&quot; button will appear here.
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {locRequests.map((req) => {
              const awaitingConsent =
                req.status === 'pending' &&
                Boolean(req.pending_consent_contact_id);
              return (
                <div
                  key={req.id}
                  className={`space-y-2 rounded-xl border p-3.5 text-xs transition-colors ${
                    req.status === 'pending'
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : req.status === 'approved'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-slate-800 bg-slate-900/20 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-bold text-white">
                        {req.requester_name}
                      </p>
                      <p className="text-slate-400">{req.requester_phone}</p>
                      {req.identity_protected && (
                        <p className="flex items-center gap-1 text-[10px] text-amber-400/90">
                          <Lock className="size-2.5" /> Via a co-broker share —
                          identity protected
                        </p>
                      )}
                      <p className="text-[10px] text-slate-600">
                        {new Date(req.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {awaitingConsent && (
                        <span className="flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                          <Clock className="size-2.5" /> Awaiting co-broker
                        </span>
                      )}
                      {req.status === 'pending' && !awaitingConsent && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                          <Clock className="size-2.5" /> Pending
                        </span>
                      )}
                      {req.status === 'approved' && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                          <CheckCircle className="size-2.5" /> Approved
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          <XCircle className="size-2.5" /> Rejected
                        </span>
                      )}
                      {req.status === 'expired' && (
                        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          <Clock className="size-2.5" /> Timed out
                        </span>
                      )}
                    </div>
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          processingLocReqId === req.id || awaitingConsent
                        }
                        onClick={() =>
                          handleLocRequestAction(req.id, 'approve')
                        }
                        title={
                          awaitingConsent
                            ? 'The co-broker who shared the link must consent first'
                            : undefined
                        }
                        className="flex h-7 flex-1 items-center justify-center gap-1 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {processingLocReqId === req.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle className="size-3" />
                        )}
                        Approve & Send
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={processingLocReqId === req.id}
                        onClick={() => handleLocRequestAction(req.id, 'reject')}
                        className="flex h-7 items-center gap-1 border-red-500/30 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <XCircle className="size-3" /> Reject
                      </Button>
                    </div>
                  )}

                  {req.status === 'approved' && req.share_token && (
                    <div className="flex items-center gap-2 pt-1">
                      {req.share_token_expires_at &&
                      new Date() > new Date(req.share_token_expires_at) ? (
                        <span className="flex items-center gap-1 text-[10px] text-amber-500">
                          <Clock className="size-3" /> Link expired
                        </span>
                      ) : (
                        req.share_token_expires_at && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Clock className="size-3" />
                            Expires:{' '}
                            {new Date(
                              req.share_token_expires_at
                            ).toLocaleDateString('en-IN')}
                          </span>
                        )
                      )}
                      {req.share_sent_at && (
                        <span className="ml-1 flex items-center gap-1 text-[10px] text-emerald-500">
                          <CheckCircle className="size-3" />
                          Sent via WA
                        </span>
                      )}
                      {req.view_count > 0 && (
                        <span className="text-primary ml-1 flex items-center gap-1 text-[10px]">
                          <Eye className="size-3" />
                          {req.view_count > 1
                            ? `Viewed ${req.view_count}×`
                            : 'Viewed'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
