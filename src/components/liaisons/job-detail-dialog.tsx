'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { LiaisonJob, LiaisonJobStatus } from '@/types';
import { computeJobTotals } from '@/lib/liaisons/job-math';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building,
  CheckCircle2,
  Edit,
  Loader2,
  RotateCcw,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';

function inr(n: number) {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN')}`;
}

const STATUS_BADGE: Record<
  LiaisonJobStatus,
  { label: string; className: string }
> = {
  open: {
    label: 'Open',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  },
  completed: {
    label: 'Completed',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'border-slate-700 bg-slate-800 text-slate-400',
  },
};

export function JobStatusBadge({ status }: { status: LiaisonJobStatus }) {
  const meta = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

interface JobDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: LiaisonJob | null;
  /** Refetch after any write so the parent list stays truthful. */
  onChanged: () => void;
  onRequestEdit: (job: LiaisonJob) => void;
  onRequestDelete: (job: LiaisonJob) => void;
}

export function JobDetailDialog({
  open,
  onOpenChange,
  job,
  onChanged,
  onRequestEdit,
  onRequestDelete,
}: JobDetailDialogProps) {
  const supabase = createClient();

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirection('in');
    setAmount('');
    setPaidOn(new Date().toISOString().slice(0, 10));
    setNote('');
  }, [open, job?.id]);

  if (!job) return null;

  const payments = job.liaison_job_payments ?? [];
  const totals = computeJobTotals(job, payments);

  const handleAddPayment = async () => {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSavingPayment(true);
    try {
      const res = await fetch(`/api/liaison-jobs/${job.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          amount: n,
          paid_on: paidOn || undefined,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }
      toast.success(
        direction === 'in' ? 'Receipt recorded' : 'Payment recorded'
      );
      setAmount('');
      setNote('');
      onChanged();
    } catch (err) {
      console.error('Error recording payment:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to record payment'
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    const { data: removed, error } = await supabase
      .from('liaison_job_payments')
      .delete()
      .eq('id', paymentId)
      .select('id');
    if (error || !removed?.length) {
      toast.error('Failed to delete entry');
    } else {
      toast.success('Entry deleted');
      onChanged();
    }
  };

  const handleStatusChange = async (status: LiaisonJobStatus) => {
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/liaison-jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_name: job.service_name,
          contact_id: job.contact_id,
          property_id: job.property_id,
          client_charge: job.client_charge,
          liaison_fee: job.liaison_fee,
          notes: job.notes,
          status,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }
      toast.success(
        status === 'completed'
          ? 'Job marked completed'
          : status === 'cancelled'
            ? 'Job cancelled'
            : 'Job reopened'
      );
      onChanged();
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to update status'
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            {job.service_name}
            <JobStatusBadge status={job.status} />
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {job.liaisons?.name ?? 'Unknown liaison'}
            {job.contacts && (
              <span className="ml-3 inline-flex items-center gap-1">
                <User className="size-3" />
                {job.contacts.name || job.contacts.phone}
              </span>
            )}
            {job.properties && (
              <span className="ml-3 inline-flex items-center gap-1">
                <Building className="size-3" />
                {job.properties.title}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Money summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] font-semibold tracking-wider text-slate-500 uppercase">
              Client
            </p>
            <p className="mt-1 text-sm font-bold text-white">
              {inr(totals.received)}
              {job.client_charge !== null && (
                <span className="font-medium text-slate-500">
                  {' '}
                  / {inr(job.client_charge)}
                </span>
              )}
            </p>
            {totals.clientBalance !== null && totals.clientBalance > 0 && (
              <p className="mt-0.5 text-[10px] font-semibold text-amber-400">
                {inr(totals.clientBalance)} to collect
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] font-semibold tracking-wider text-slate-500 uppercase">
              Liaison
            </p>
            <p className="mt-1 text-sm font-bold text-white">
              {inr(totals.paid)}
              {job.liaison_fee !== null && (
                <span className="font-medium text-slate-500">
                  {' '}
                  / {inr(job.liaison_fee)}
                </span>
              )}
            </p>
            {totals.liaisonBalance !== null && totals.liaisonBalance > 0 && (
              <p className="mt-0.5 text-[10px] font-semibold text-amber-400">
                {inr(totals.liaisonBalance)} to pay
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] font-semibold tracking-wider text-slate-500 uppercase">
              Margin
            </p>
            <p
              className={`mt-1 text-sm font-bold ${
                totals.realizedMargin < 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {inr(totals.realizedMargin)}
            </p>
            {totals.agreedMargin !== null && (
              <p className="mt-0.5 text-[10px] text-slate-500">
                agreed {inr(totals.agreedMargin)}
              </p>
            )}
          </div>
        </div>

        {job.notes && (
          <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-[11px] whitespace-pre-wrap text-slate-400">
            {job.notes}
          </p>
        )}

        {/* Add payment */}
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setDirection('in')}
              className={`flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                direction === 'in'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDownLeft className="size-3" />
              From client
            </button>
            <button
              type="button"
              onClick={() => setDirection('out')}
              className={`flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                direction === 'out'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                  : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight className="size-3" />
              To liaison
            </button>
          </div>
          <div className="grid grid-cols-[1fr_8.5rem_auto] gap-2">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Amount ₹"
              inputMode="numeric"
              className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
            />
            <Input
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="h-8 border-slate-700 bg-slate-800 text-xs text-white"
            />
            <Button
              size="sm"
              onClick={handleAddPayment}
              disabled={savingPayment}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer text-xs font-bold"
            >
              {savingPayment && <Loader2 className="size-3 animate-spin" />}
              Add
            </Button>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note, e.g. advance / final settlement"
            className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
          />
        </div>

        {/* Ledger */}
        <div className="space-y-1">
          {payments.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-500">
              No payments recorded yet.
            </p>
          ) : (
            [...payments]
              .sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-950/30 px-2.5 py-1.5"
                >
                  {p.direction === 'in' ? (
                    <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <ArrowUpRight className="size-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="shrink-0 text-xs font-bold text-white">
                    {inr(p.amount)}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {new Date(p.paid_on).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="flex-1 truncate text-[10px] text-slate-400">
                    {p.note ??
                      (p.direction === 'in'
                        ? 'Received from client'
                        : 'Paid to liaison')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeletePayment(p.id)}
                    aria-label="Delete entry"
                    className="shrink-0 cursor-pointer text-slate-600 transition-colors hover:text-red-400"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          {job.status === 'open' ? (
            <>
              <Button
                size="sm"
                onClick={() => handleStatusChange('completed')}
                disabled={updatingStatus}
                className="h-8 cursor-pointer gap-1 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <CheckCircle2 className="size-3.5" />
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('cancelled')}
                disabled={updatingStatus}
                className="h-8 cursor-pointer gap-1 border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
              >
                <XCircle className="size-3.5" />
                Cancel job
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('open')}
              disabled={updatingStatus}
              className="h-8 cursor-pointer gap-1 border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw className="size-3.5" />
              Reopen
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRequestEdit(job)}
              className="h-8 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <Edit className="size-3" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRequestDelete(job)}
              className="h-8 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-400"
            >
              <Trash2 className="size-3" />
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
