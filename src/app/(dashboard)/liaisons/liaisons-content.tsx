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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
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

function formatFee(fee: number | null | undefined): string {
  if (fee === null || fee === undefined) return 'Fee varies';
  if (fee >= 10000000) return `₹${(fee / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (fee >= 100000) return `₹${(fee / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
  return `₹${fee.toLocaleString('en-IN')}`;
}

function computeMargin(fee: number | null | undefined, clientCharge: number | null | undefined) {
  if (fee === null || fee === undefined) return null;
  if (clientCharge === null || clientCharge === undefined) return null;
  const margin = clientCharge - fee;
  const pct = clientCharge > 0 ? Math.round((margin / clientCharge) * 100) : null;
  return { margin, pct };
}

function formatMargin(margin: number, pct: number | null) {
  const sign = margin < 0 ? '-' : '+';
  return `${sign}₹${Math.abs(margin).toLocaleString('en-IN')}${pct !== null ? ` (${pct}%)` : ''}`;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
        (l.services ?? []).some((s) => s.name.trim().toLowerCase() === f),
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
          (l.services ?? []).some((s) => s.name.toLowerCase().includes(q)),
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

  function confirmDelete(liaison: Liaison) {
    setDeleteTarget(liaison);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('liaisons')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, service, area, phone..."
            className="pl-9 bg-slate-900/60 border-slate-800 text-sm text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
          />
        </div>
        <Button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold h-9 gap-1.5 cursor-pointer px-4 sm:ml-auto"
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
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
              serviceFilter === null
                ? 'border-primary/40 bg-primary/10 text-white'
                : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:border-slate-700'
            }`}
          >
            All services
          </button>
          {serviceNames.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setServiceFilter(serviceFilter === s ? null : s)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                serviceFilter === s
                  ? 'border-primary/40 bg-primary/10 text-white'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white hover:border-slate-700'
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
        <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl bg-slate-900/20 max-w-lg mx-auto mt-4">
          <Landmark className="size-12 mx-auto text-slate-700 mb-4 opacity-45" />
          <h4 className="text-sm font-semibold text-white mb-1">
            {liaisons.length === 0 ? 'No liaisons yet' : 'No matches'}
          </h4>
          <p className="text-xs text-slate-400 max-w-xs mx-auto mb-4">
            {liaisons.length === 0
              ? 'Add the people who handle khata, EC, registration and other government work, with the fees they quoted.'
              : 'Try a different search or clear the service filter.'}
          </p>
          {liaisons.length === 0 && (
            <Button
              onClick={openAdd}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold h-8 gap-1.5 cursor-pointer px-4"
            >
              <Plus className="size-3.5" />
              Add your first liaison
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredLiaisons.map((liaison) => (
            <div
              key={liaison.id}
              className={`flex flex-col rounded-xl border bg-slate-900/40 overflow-hidden transition-all duration-300 ${
                liaison.is_active
                  ? 'border-slate-800/80 hover:border-slate-700/80'
                  : 'border-slate-800/50 opacity-60'
              }`}
            >
              {/* Identity */}
              <div className="flex items-start gap-3 p-4 pb-3">
                <Avatar className="size-10 border border-slate-800 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {getInitials(liaison.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {liaison.name}
                    </h3>
                    {!liaison.is_active && (
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-slate-400 shrink-0">
                        Inactive
                      </span>
                    )}
                  </div>
                  {liaison.office_area && (
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5 truncate">
                      <Landmark className="size-3 shrink-0" />
                      <span className="truncate">{liaison.office_area}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]">
                    {liaison.phone && (
                      <>
                        <a
                          href={`tel:${liaison.phone}`}
                          className="flex items-center gap-1 text-slate-300 hover:text-primary transition-colors"
                        >
                          <Phone className="size-3" />
                          {liaison.phone}
                        </a>
                        <a
                          href={waLink(liaison.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${liaison.name}`}
                          className="flex items-center gap-1 text-emerald-400/80 hover:text-emerald-300 transition-colors"
                        >
                          <MessageSquare className="size-3" />
                          WhatsApp
                        </a>
                      </>
                    )}
                    {liaison.alt_phone && (
                      <a
                        href={`tel:${liaison.alt_phone}`}
                        className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors"
                      >
                        <Phone className="size-3" />
                        {liaison.alt_phone}
                      </a>
                    )}
                    {liaison.email && (
                      <a
                        href={`mailto:${liaison.email}`}
                        className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors truncate"
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
                  <p className="text-[11px] text-slate-500 border-t border-slate-800/80 pt-3">
                    No services recorded.
                  </p>
                ) : (
                  <ul className="border-t border-slate-800/80 pt-2 divide-y divide-slate-800/50">
                    {liaison.services.map((service, i) => {
                      const hasCharge =
                        service.client_charge !== null && service.client_charge !== undefined;
                      const m = computeMargin(service.fee, service.client_charge);
                      return (
                        <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                          <span className="text-xs text-slate-300 min-w-0">
                            {service.name}
                            {service.fee_note && (
                              <span className="block text-[10px] text-slate-500 mt-0.5">
                                {service.fee_note}
                              </span>
                            )}
                          </span>
                          <span className="text-right shrink-0">
                            {/* Client-facing charge leads; the liaison's cut and
                                margin sit under it so quoting stays one glance. */}
                            <span
                              className={`block text-xs font-bold ${
                                hasCharge || (service.fee !== null && service.fee !== undefined)
                                  ? 'text-primary'
                                  : 'text-slate-500 font-medium'
                              }`}
                            >
                              {hasCharge ? formatFee(service.client_charge) : formatFee(service.fee)}
                            </span>
                            {hasCharge && service.fee !== null && service.fee !== undefined && (
                              <span className="block text-[10px] text-slate-500 mt-0.5">
                                Pay {formatFee(service.fee)}
                              </span>
                            )}
                            {m && (
                              <span
                                className={`block text-[10px] font-semibold mt-0.5 ${
                                  m.margin < 0 ? 'text-red-400' : 'text-emerald-400'
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
                <p className="px-4 pt-2 text-[11px] text-slate-500 line-clamp-2 whitespace-pre-wrap">
                  {liaison.notes}
                </p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-slate-800/80 p-3 mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(liaison)}
                  className="h-7 px-2 text-[10px] text-slate-400 hover:text-white hover:bg-slate-800 gap-1 cursor-pointer"
                >
                  <Edit className="size-3" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => confirmDelete(liaison)}
                  className="h-7 px-2 text-[10px] text-slate-400 hover:text-red-400 hover:bg-slate-800 gap-1 cursor-pointer"
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

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Liaison</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="text-slate-200 font-medium">{deleteTarget?.name}</span>? Their
              services and fee details will be removed. This action cannot be undone.
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
