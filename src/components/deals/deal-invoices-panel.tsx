'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { formatInvoiceDate } from '@/lib/invoices/financial-year';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { INVOICE_STATUS_LABELS } from '@/lib/invoices/types';
import type { Invoice, InvoiceStatus } from '@/lib/invoices/types';
import { cn } from '@/lib/utils';

import { InvoiceEditor } from './invoice-editor';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
  issued: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  sent: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  cancelled: 'bg-rose-500/10 text-rose-300/80 border-rose-500/25',
};

interface DealInvoicesPanelProps {
  dealId: string;
  canEdit: boolean;
}

export function DealInvoicesPanel({ dealId, canEdit }: DealInvoicesPanelProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['deal-invoices', dealId],
    queryFn: async (): Promise<Invoice[]> => {
      const response = await fetch(`/api/deals/${dealId}/invoices`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load invoices');
      return json.data ?? [];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-invoices', dealId] });

  const createDraft = useMutation({
    mutationFn: async (): Promise<Invoice> => {
      const response = await fetch(`/api/deals/${dealId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not create the invoice');
      return json.data;
    },
    onSuccess: async (invoice) => {
      await refresh();
      setEditingId(invoice.id);
      toast.success('Draft prepared from the deal — check it over and issue.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function act(
    invoice: Invoice,
    path: string,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setBusyId(invoice.id);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'That did not work');
      await refresh();
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  async function discardDraft(invoice: Invoice) {
    if (!window.confirm('Discard this draft invoice?')) return;
    setBusyId(invoice.id);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not discard the draft');
      await refresh();
      toast.success('Draft discarded.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not discard the draft'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function cancelInvoice(invoice: Invoice) {
    const reason = window.prompt(
      `Cancel invoice ${invoice.invoice_number}?\n\nThe number stays in your series so the books have no gap. Reason (optional):`
    );
    if (reason === null) return;
    await act(invoice, 'cancel', { reason }, 'Invoice cancelled.');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Invoices</h3>
          <p className="text-xs text-slate-400">
            Raised from this deal&apos;s value and brokerage rate.
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => createDraft.mutate()}
            disabled={createDraft.isPending}
          >
            {createDraft.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New invoice
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No invoices on this deal yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            A new invoice fills itself in from the deal value, the brokerage
            rate and the property — you only confirm it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((invoice) => {
            const busy = busyId === invoice.id;
            return (
              <div
                key={invoice.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">
                        {invoice.invoice_number ?? 'Draft'}
                      </span>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                          STATUS_STYLES[invoice.status]
                        )}
                      >
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </span>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] tracking-wide text-slate-400 uppercase">
                        {invoice.side} · {invoice.share_percent}%
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-300">
                      {invoice.bill_to?.name || 'No customer name'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatInvoiceDate(invoice.invoice_date)}
                      {invoice.status === 'cancelled' && invoice.cancel_reason
                        ? ` · ${invoice.cancel_reason}`
                        : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold text-white">
                      Rs. {formatIndianDigits(invoice.grand_total)}
                    </p>
                    {invoice.gst_mode !== 'nil' && (
                      <p className="text-[11px] text-slate-500">
                        incl. GST Rs.{' '}
                        {formatIndianDigits(
                          invoice.cgst + invoice.sgst + invoice.igst
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                  {invoice.status === 'draft' && canEdit && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(invoice.id)}
                      >
                        Review &amp; edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          act(
                            invoice,
                            'issue',
                            {},
                            'Invoice issued and numbered.'
                          )
                        }
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Issue
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => discardDraft(invoice)}
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  {invoice.status !== 'draft' && (
                    <a
                      href={`/api/invoices/${invoice.id}/pdf?download=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="outline">
                        <Download className="h-4 w-4" />
                        PDF
                      </Button>
                    </a>
                  )}

                  {['issued', 'sent'].includes(invoice.status) && canEdit && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          act(
                            invoice,
                            'send',
                            { channel: 'whatsapp' },
                            'Invoice sent on WhatsApp.'
                          )
                        }
                        disabled={busy}
                      >
                        <MessageSquare className="h-4 w-4" />
                        WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          act(
                            invoice,
                            'send',
                            { channel: 'email' },
                            'Invoice emailed.'
                          )
                        }
                        disabled={busy}
                      >
                        <Mail className="h-4 w-4" />
                        Email
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          act(invoice, 'mark-paid', {}, 'Marked as paid.')
                        }
                        disabled={busy}
                      >
                        <Wallet className="h-4 w-4" />
                        Mark paid
                      </Button>
                    </>
                  )}

                  {invoice.status !== 'draft' &&
                    invoice.status !== 'cancelled' &&
                    canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelInvoice(invoice)}
                        disabled={busy}
                      >
                        <Ban className="h-4 w-4" />
                        Cancel
                      </Button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingId && (
        <InvoiceEditor
          invoiceId={editingId}
          open
          onOpenChange={(open) => !open && setEditingId(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
