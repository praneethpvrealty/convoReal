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

const STATUS_BADGE: Record<LiaisonJobStatus, { label: string; className: string }> = {
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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold shrink-0 ${meta.className}`}
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
      toast.success(direction === 'in' ? 'Receipt recorded' : 'Payment recorded');
      setAmount('');
      setNote('');
      onChanged();
    } catch (err) {
      console.error('Error recording payment:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    const { error } = await supabase
      .from('liaison_job_payments')
      .delete()
      .eq('id', paymentId);
    if (error) {
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
            : 'Job reopened',
      );
      onChanged();
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            {job.service_name}
            <JobStatusBadge status={job.status} />
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {job.liaisons?.name ?? 'Unknown liaison'}
            {job.contacts && (
              <span className="inline-flex items-center gap-1 ml-3">
                <User className="size-3" />
                {job.contacts.name || job.contacts.phone}
              </span>
            )}
            {job.properties && (
              <span className="inline-flex items-center gap-1 ml-3">
                <Building className="size-3" />
                {job.properties.title}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Money summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
              Client
            </p>
            <p className="text-sm font-bold text-white mt-1">
              {inr(totals.received)}
              {job.client_charge !== null && (
                <span className="text-slate-500 font-medium"> / {inr(job.client_charge)}</span>
              )}
            </p>
            {totals.clientBalance !== null && totals.clientBalance > 0 && (
              <p className="text-[10px] font-semibold text-amber-400 mt-0.5">
                {inr(totals.clientBalance)} to collect
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
              Liaison
            </p>
            <p className="text-sm font-bold text-white mt-1">
              {inr(totals.paid)}
              {job.liaison_fee !== null && (
                <span className="text-slate-500 font-medium"> / {inr(job.liaison_fee)}</span>
              )}
            </p>
            {totals.liaisonBalance !== null && totals.liaisonBalance > 0 && (
              <p className="text-[10px] font-semibold text-amber-400 mt-0.5">
                {inr(totals.liaisonBalance)} to pay
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
              Margin
            </p>
            <p
              className={`text-sm font-bold mt-1 ${
                totals.realizedMargin < 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {inr(totals.realizedMargin)}
            </p>
            {totals.agreedMargin !== null && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                agreed {inr(totals.agreedMargin)}
              </p>
            )}
          </div>
        </div>

        {job.notes && (
          <p className="text-[11px] text-slate-400 whitespace-pre-wrap border border-slate-800 rounded-lg bg-slate-950/40 p-2.5">
            {job.notes}
          </p>
        )}

        {/* Add payment */}
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setDirection('in')}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
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
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
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
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
            />
            <Input
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white h-8 text-xs"
            />
            <Button
              size="sm"
              onClick={handleAddPayment}
              disabled={savingPayment}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs font-bold cursor-pointer"
            >
              {savingPayment && <Loader2 className="size-3 animate-spin" />}
              Add
            </Button>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note, e.g. advance / final settlement"
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
          />
        </div>

        {/* Ledger */}
        <div className="space-y-1">
          {payments.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-3">
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
                    <ArrowDownLeft className="size-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <ArrowUpRight className="size-3.5 text-amber-400 shrink-0" />
                  )}
                  <span className="text-xs font-bold text-white shrink-0">
                    {inr(p.amount)}
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {new Date(p.paid_on).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate flex-1">
                    {p.note ??
                      (p.direction === 'in' ? 'Received from client' : 'Paid to liaison')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeletePayment(p.id)}
                    aria-label="Delete entry"
                    className="text-slate-600 hover:text-red-400 transition-colors cursor-pointer shrink-0"
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
                className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 text-xs font-bold gap-1 cursor-pointer"
              >
                <CheckCircle2 className="size-3.5" />
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('cancelled')}
                disabled={updatingStatus}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 h-8 text-xs gap-1 cursor-pointer"
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
              className="border-slate-700 text-slate-300 hover:bg-slate-800 h-8 text-xs gap-1 cursor-pointer"
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
              className="h-8 px-2 text-[10px] text-slate-400 hover:text-white hover:bg-slate-800 gap-1 cursor-pointer"
            >
              <Edit className="size-3" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRequestDelete(job)}
              className="h-8 px-2 text-[10px] text-slate-400 hover:text-red-400 hover:bg-slate-800 gap-1 cursor-pointer"
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
