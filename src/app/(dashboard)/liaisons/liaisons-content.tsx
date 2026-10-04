'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Liaison } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { LiaisonForm } from '@/components/liaisons/liaison-form';
import { JobForm } from '@/components/liaisons/job-form';
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
  Landmark,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Edit,
  Trash2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/format/currency';
import { getInitials } from '@/lib/format/text';

function formatFee(fee: number | null | undefined): string {
  if (fee === null || fee === undefined) return 'Fee varies';
  return formatCurrency(fee);
}

function computeMargin(
  fee: number | null | undefined,
  clientCharge: number | null | undefined
) {
  if (fee === null || fee === undefined) return null;
  if (clientCharge === null || clientCharge === undefined) return null;
  const margin = clientCharge - fee;
  const pct =
    clientCharge > 0 ? Math.round((margin / clientCharge) * 100) : null;
  return { margin, pct };
}

function formatMargin(margin: number, pct: number | null) {
  const sign = margin < 0 ? '-' : '+';
  return `${sign}₹${Math.abs(margin).toLocaleString('en-IN')}${pct !== null ? ` (${pct}%)` : ''}`;
}

/** wa.me only accepts digits (country code + number, no + or spaces). */
function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

export default function LiaisonsContent() {
  const supabase = createClient();

  const [liaisons, setLiaisons] = useState<Liaison[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Liaison | null>(null);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [jobLiaisonId, setJobLiaisonId] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Liaison | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchLiaisons = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('liaisons')
        .select('*')
        .order('is_active', { ascending: false })
        .order('name');

      if (error) throw error;
      setLiaisons(data || []);
    } catch (err) {
      console.error('Error fetching liaisons:', err);
      toast.error('Failed to load liaisons');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchLiaisons();
  }, [fetchLiaisons]);

  // Filter chips come from the services people actually carry, so the
  // list never shows a chip that would filter down to nothing.
  const serviceNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of liaisons) {
      for (const s of l.services ?? []) {
        const key = s.name.trim().toLowerCase();
        if (key && !seen.has(key)) seen.set(key, s.name.trim());
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [liaisons]);

  const filteredLiaisons = useMemo(() => {
    let list = liaisons;
    if (serviceFilter) {
      const f = serviceFilter.toLowerCase();
      list = list.filter((l) =>
        (l.services ?? []).some((s) => s.name.trim().toLowerCase() === f)
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.phone && l.phone.includes(q)) ||
          (l.alt_phone && l.alt_phone.includes(q)) ||
          (l.office_area && l.office_area.toLowerCase().includes(q)) ||
          (l.notes && l.notes.toLowerCase().includes(q)) ||
          (l.services ?? []).some((s) => s.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [liaisons, searchQuery, serviceFilter]);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(liaison: Liaison) {
    setEditTarget(liaison);
    setFormOpen(true);
  }

  function openLogJob(liaison: Liaison) {
    setJobLiaisonId(liaison.id);
    setJobFormOpen(true);
  }

  function confirmDelete(liaison: Liaison) {
    setDeleteTarget(liaison);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { data: deleted, error } = await supabase
      .from('liaisons')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id');

    if (error || !deleted?.length) {
      toast.error('Failed to delete liaison');
    } else {
      toast.success('Liaison deleted');
      fetchLiaisons();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, service, area, phone..."
            className="focus-visible:ring-primary border-slate-800 bg-slate-900/60 pl-9 text-sm text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
          />
        </div>
        <Button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 cursor-pointer gap-1.5 px-4 text-xs font-bold sm:ml-auto"
        >
          <Plus className="size-3.5" />
          Add Liaison
        </Button>
      </div>

      {/* Service filter chips */}
      {serviceNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setServiceFilter(null)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
              serviceFilter === null
                ? 'border-primary/40 bg-primary/10 text-white'
                : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700 hover:text-white'
            }`}
          >
            All services
          </button>
          {serviceNames.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setServiceFilter(serviceFilter === s ? null : s)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                serviceFilter === s
                  ? 'border-primary/40 bg-primary/10 text-white'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Directory */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <ConvoRealLoader size={24} label="Loading liaisons" />
        </div>
      ) : filteredLiaisons.length === 0 ? (
        <div className="mx-auto mt-4 max-w-lg rounded-xl border border-dashed border-slate-800 bg-slate-900/20 py-16 text-center">
          <Landmark className="mx-auto mb-4 size-12 text-slate-700 opacity-45" />
          <h4 className="mb-1 text-sm font-semibold text-white">
            {liaisons.length === 0 ? 'No liaisons yet' : 'No matches'}
          </h4>
          <p className="mx-auto mb-4 max-w-xs text-xs text-slate-400">
            {liaisons.length === 0
              ? 'Add the people who handle khata, EC, registration and other government work, with the fees they quoted.'
              : 'Try a different search or clear the service filter.'}
          </p>
          {liaisons.length === 0 && (
            <Button
              onClick={openAdd}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer gap-1.5 px-4 text-xs font-bold"
            >
              <Plus className="size-3.5" />
              Add your first liaison
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredLiaisons.map((liaison) => (
            <div
              key={liaison.id}
              className={`flex flex-col overflow-hidden rounded-xl border bg-slate-900/40 transition-all duration-300 ${
                liaison.is_active
                  ? 'border-slate-800/80 hover:border-slate-700/80'
                  : 'border-slate-800/50 opacity-60'
              }`}
            >
              {/* Identity */}
              <div className="flex items-start gap-3 p-4 pb-3">
                <Avatar className="size-10 shrink-0 border border-slate-800">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {getInitials(liaison.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {liaison.name}
                    </h3>
                    {!liaison.is_active && (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                        Inactive
                      </span>
                    )}
                  </div>
                  {liaison.office_area && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
                      <Landmark className="size-3 shrink-0" />
                      <span className="truncate">{liaison.office_area}</span>
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    {liaison.phone && (
                      <>
                        <a
                          href={`tel:${liaison.phone}`}
                          className="hover:text-primary flex items-center gap-1 text-slate-300 transition-colors"
                        >
                          <Phone className="size-3" />
                          {liaison.phone}
                        </a>
                        <a
                          href={waLink(liaison.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${liaison.name}`}
                          className="flex items-center gap-1 text-emerald-400/80 transition-colors hover:text-emerald-300"
                        >
                          <MessageSquare className="size-3" />
                          WhatsApp
                        </a>
                      </>
                    )}
                    {liaison.alt_phone && (
                      <a
                        href={`tel:${liaison.alt_phone}`}
                        className="hover:text-primary flex items-center gap-1 text-slate-400 transition-colors"
                      >
                        <Phone className="size-3" />
                        {liaison.alt_phone}
                      </a>
                    )}
                    {liaison.email && (
                      <a
                        href={`mailto:${liaison.email}`}
                        className="hover:text-primary flex items-center gap-1 truncate text-slate-400 transition-colors"
                      >
                        <Mail className="size-3 shrink-0" />
                        <span className="truncate">{liaison.email}</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Services & fees */}
              <div className="flex-1 px-4">
                {(liaison.services ?? []).length === 0 ? (
                  <p className="border-t border-slate-800/80 pt-3 text-[11px] text-slate-500">
                    No services recorded.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/50 border-t border-slate-800/80 pt-2">
                    {liaison.services.map((service, i) => {
                      const hasCharge =
                        service.client_charge !== null &&
                        service.client_charge !== undefined;
                      const m = computeMargin(
                        service.fee,
                        service.client_charge
                      );
                      return (
                        <li
                          key={i}
                          className="flex items-start justify-between gap-3 py-1.5"
                        >
                          <span className="min-w-0 text-xs text-slate-300">
                            {service.name}
                            {service.fee_note && (
                              <span className="mt-0.5 block text-[10px] text-slate-500">
                                {service.fee_note}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-right">
                            {/* Client-facing charge leads; the liaison's cut and
                                margin sit under it so quoting stays one glance. */}
                            <span
                              className={`block text-xs font-bold ${
                                hasCharge ||
                                (service.fee !== null &&
                                  service.fee !== undefined)
                                  ? 'text-primary'
                                  : 'font-medium text-slate-500'
                              }`}
                            >
                              {hasCharge
                                ? formatFee(service.client_charge)
                                : formatFee(service.fee)}
                            </span>
                            {hasCharge &&
                              service.fee !== null &&
                              service.fee !== undefined && (
                                <span className="mt-0.5 block text-[10px] text-slate-500">
                                  Pay {formatFee(service.fee)}
                                </span>
                              )}
                            {m && (
                              <span
                                className={`mt-0.5 block text-[10px] font-semibold ${
                                  m.margin < 0
                                    ? 'text-red-400'
                                    : 'text-emerald-400'
                                }`}
                              >
                                {formatMargin(m.margin, m.pct)}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Notes */}
              {liaison.notes && (
                <p className="line-clamp-2 px-4 pt-2 text-[11px] whitespace-pre-wrap text-slate-500">
                  {liaison.notes}
                </p>
              )}

              {/* Actions */}
              <div className="mt-3 flex justify-end gap-2 border-t border-slate-800/80 p-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openLogJob(liaison)}
                  className="mr-auto h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <Briefcase className="size-3" />
                  Log job
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(liaison)}
                  className="h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <Edit className="size-3" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => confirmDelete(liaison)}
                  className="h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit form */}
      <LiaisonForm
        open={formOpen}
        onOpenChange={setFormOpen}
        liaison={editTarget}
        onSaved={fetchLiaisons}
      />

      {/* Quick "Log job" from a directory card — the Jobs tab refetches
          on mount, so no cross-tab sync is needed here. */}
      <JobForm
        open={jobFormOpen}
        onOpenChange={setJobFormOpen}
        liaisons={liaisons}
        defaultLiaisonId={jobLiaisonId}
        onSaved={() => {}}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Liaison</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="font-medium text-slate-200">
                {deleteTarget?.name}
              </span>
              ? Their services, fee details, and job &amp; payment history will
              be removed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-700 bg-slate-900">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
