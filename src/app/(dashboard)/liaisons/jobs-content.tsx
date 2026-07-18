'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Liaison, LiaisonJob, LiaisonJobStatus } from '@/types';
import { computeJobTotals } from '@/lib/liaisons/job-math';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { JobForm } from '@/components/liaisons/job-form';
import {
  JobDetailDialog,
  JobStatusBadge,
} from '@/components/liaisons/job-detail-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Briefcase,
  Building,
  Loader2,
  Plus,
  Search,
  User,
} from 'lucide-react';

function inr(n: number) {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN')}`;
}

const STATUS_FILTERS: { id: LiaisonJobStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function JobsContent() {
  const supabase = createClient();

  const [jobs, setJobs] = useState<LiaisonJob[]>([]);
  const [liaisons, setLiaisons] = useState<Liaison[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LiaisonJobStatus | 'all'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LiaisonJob | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LiaisonJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, liaisonsRes] = await Promise.all([
        supabase
          .from('liaison_jobs')
          .select(
            '*, liaisons(name), contacts(id, name, phone), properties(id, title), liaison_job_payments(*)',
          )
          .order('created_at', { ascending: false }),
        supabase.from('liaisons').select('*').order('name'),
      ]);

      if (jobsRes.error) throw jobsRes.error;
      setJobs(jobsRes.data || []);
      if (liaisonsRes.data) setLiaisons(liaisonsRes.data);
    } catch (err) {
      console.error('Error fetching jobs:', err);
      toast.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Keep the open detail dialog fed with fresh rows after any write.
  const detailJob = useMemo(
    () => jobs.find((j) => j.id === detailJobId) ?? null,
    [jobs, detailJobId],
  );

  const filteredJobs = useMemo(() => {
    let list = jobs;
    if (statusFilter !== 'all') {
      list = list.filter((j) => j.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (j) =>
          j.service_name.toLowerCase().includes(q) ||
          (j.liaisons?.name && j.liaisons.name.toLowerCase().includes(q)) ||
          (j.contacts?.name && j.contacts.name.toLowerCase().includes(q)) ||
          (j.contacts?.phone && j.contacts.phone.includes(q)) ||
          (j.properties?.title && j.properties.title.toLowerCase().includes(q)) ||
          (j.notes && j.notes.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [jobs, searchQuery, statusFilter]);

  // Money position across everything that still counts (cancelled jobs
  // keep their recorded payments in the margin, but stop asking for
  // their unpaid balances).
  const summary = useMemo(() => {
    let toCollect = 0;
    let toPay = 0;
    let realizedMargin = 0;
    for (const job of jobs) {
      const totals = computeJobTotals(job, job.liaison_job_payments ?? []);
      realizedMargin += totals.realizedMargin;
      if (job.status !== 'cancelled') {
        if (totals.clientBalance !== null && totals.clientBalance > 0) {
          toCollect += totals.clientBalance;
        }
        if (totals.liaisonBalance !== null && totals.liaisonBalance > 0) {
          toPay += totals.liaisonBalance;
        }
      }
    }
    return { toCollect, toPay, realizedMargin };
  }, [jobs]);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(job: LiaisonJob) {
    setEditTarget(job);
    setFormOpen(true);
  }

  function requestDelete(job: LiaisonJob) {
    setDeleteTarget(job);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('liaison_jobs')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete job');
    } else {
      toast.success('Job deleted');
      if (detailJobId === deleteTarget.id) setDetailJobId(null);
      fetchData();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      {/* Money position */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            To collect from clients
          </p>
          <p className="text-xl font-extrabold text-amber-400 mt-1">
            {inr(summary.toCollect)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Due to liaisons
          </p>
          <p className="text-xl font-extrabold text-sky-400 mt-1">
            {inr(summary.toPay)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Margin in hand
          </p>
          <p
            className={`text-xl font-extrabold mt-1 ${
              summary.realizedMargin < 0 ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {inr(summary.realizedMargin)}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by service, liaison, client, property..."
            className="pl-9 bg-slate-900/60 border-slate-800 text-sm text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                statusFilter === f.id
                  ? 'border-primary/40 bg-primary/10 text-white'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold h-9 gap-1.5 cursor-pointer px-4 sm:ml-auto"
        >
          <Plus className="size-3.5" />
          Log Job
        </Button>
      </div>

      {/* Jobs list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <ConvoRealLoader size={24} label="Loading jobs" />
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl bg-slate-900/20 max-w-lg mx-auto mt-4">
          <Briefcase className="size-12 mx-auto text-slate-700 mb-4 opacity-45" />
          <h4 className="text-sm font-semibold text-white mb-1">
            {jobs.length === 0 ? 'No jobs yet' : 'No matches'}
          </h4>
          <p className="text-xs text-slate-400 max-w-xs mx-auto mb-4">
            {jobs.length === 0
              ? 'Log each engagement — khata transfer for a property, EC for a client — and track what came in, what went out, and the margin.'
              : 'Try a different search or status filter.'}
          </p>
          {jobs.length === 0 && (
            <Button
              onClick={openAdd}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold h-8 gap-1.5 cursor-pointer px-4"
            >
              <Plus className="size-3.5" />
              Log your first job
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredJobs.map((job) => {
            const totals = computeJobTotals(job, job.liaison_job_payments ?? []);
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setDetailJobId(job.id)}
                className="w-full text-left rounded-xl border border-slate-800/80 bg-slate-900/40 hover:border-slate-700/80 transition-all duration-200 p-4 cursor-pointer"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {job.service_name}
                      </h3>
                      <JobStatusBadge status={job.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-400">
                      <span className="font-medium text-slate-300">
                        {job.liaisons?.name ?? 'Unknown liaison'}
                      </span>
                      {job.contacts && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3" />
                          {job.contacts.name || job.contacts.phone}
                        </span>
                      )}
                      {job.properties && (
                        <span className="inline-flex items-center gap-1">
                          <Building className="size-3" />
                          {job.properties.title}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right shrink-0">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                        In / Charge
                      </p>
                      <p className="text-xs font-bold text-white mt-0.5">
                        {inr(totals.received)}
                        {job.client_charge !== null && (
                          <span className="text-slate-500 font-medium">
                            {' '}/ {inr(job.client_charge)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                        Out / Fee
                      </p>
                      <p className="text-xs font-bold text-white mt-0.5">
                        {inr(totals.paid)}
                        {job.liaison_fee !== null && (
                          <span className="text-slate-500 font-medium">
                            {' '}/ {inr(job.liaison_fee)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                        Margin
                      </p>
                      <p
                        className={`text-xs font-bold mt-0.5 ${
                          totals.realizedMargin < 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {inr(totals.realizedMargin)}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Log / edit job */}
      <JobForm
        open={formOpen}
        onOpenChange={setFormOpen}
        job={editTarget}
        liaisons={liaisons}
        onSaved={fetchData}
      />

      {/* Job detail + payments */}
      <JobDetailDialog
        open={detailJob !== null}
        onOpenChange={(open) => {
          if (!open) setDetailJobId(null);
        }}
        job={detailJob}
        onChanged={fetchData}
        onRequestEdit={(job) => {
          setDetailJobId(null);
          openEdit(job);
        }}
        onRequestDelete={(job) => {
          setDetailJobId(null);
          requestDelete(job);
        }}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Job</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="text-slate-200 font-medium">
                {deleteTarget?.service_name}
              </span>
              {deleteTarget?.liaisons?.name && (
                <> with {deleteTarget.liaisons.name}</>
              )}
              ? All its payment entries will be removed too. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
