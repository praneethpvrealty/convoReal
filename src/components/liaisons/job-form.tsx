'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Liaison, LiaisonJob, Property } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableContactSelect } from '@/components/ui/searchable-contact-select';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import { Loader2 } from 'lucide-react';

function parseAmount(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() && Number.isFinite(n) && n >= 0 ? n : null;
}

interface JobFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit an existing job; null/undefined = create. */
  job?: LiaisonJob | null;
  liaisons: Liaison[];
  /** Preselect the liaison when launched from a directory card. */
  defaultLiaisonId?: string | null;
  onSaved: () => void;
}

export function JobForm({
  open,
  onOpenChange,
  job,
  liaisons,
  defaultLiaisonId,
  onSaved,
}: JobFormProps) {
  const supabase = createClient();
  const isEdit = !!job;

  const [liaisonId, setLiaisonId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [clientCharge, setClientCharge] = useState('');
  const [liaisonFee, setLiaisonFee] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  const fetchPickerData = useCallback(async () => {
    const [contactsRes, propertiesRes] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      supabase
        .from('properties')
        .select('id, title, property_code, location, sublocality, project')
        .order('title'),
    ]);
    if (contactsRes.data) setContacts(contactsRes.data);
    if (propertiesRes.data) setProperties(propertiesRes.data as Property[]);
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    setLiaisonId(job?.liaison_id ?? defaultLiaisonId ?? '');
    setServiceName(job?.service_name ?? '');
    setContactId(job?.contact_id ?? null);
    setPropertyId(job?.property_id ?? null);
    setClientCharge(
      job?.client_charge !== null && job?.client_charge !== undefined
        ? String(job.client_charge)
        : '',
    );
    setLiaisonFee(
      job?.liaison_fee !== null && job?.liaison_fee !== undefined
        ? String(job.liaison_fee)
        : '',
    );
    setNotes(job?.notes ?? '');
    fetchPickerData();
  }, [open, job, defaultLiaisonId, fetchPickerData]);

  const selectedLiaison = useMemo(
    () => liaisons.find((l) => l.id === liaisonId) ?? null,
    [liaisons, liaisonId],
  );

  /** Picking a rate-card service fills the name and seeds both amounts —
   *  the point of the directory is not retyping the numbers. */
  const applyService = (name: string) => {
    setServiceName(name);
    const entry = selectedLiaison?.services.find((s) => s.name === name);
    if (!entry) return;
    if (entry.client_charge !== null && entry.client_charge !== undefined) {
      setClientCharge(String(entry.client_charge));
    }
    if (entry.fee !== null && entry.fee !== undefined) {
      setLiaisonFee(String(entry.fee));
    }
  };

  const marginPreview = useMemo(() => {
    const fee = parseAmount(liaisonFee);
    const charge = parseAmount(clientCharge);
    if (fee === null || charge === null) return null;
    const margin = charge - fee;
    const pct = charge > 0 ? Math.round((margin / charge) * 100) : null;
    const sign = margin < 0 ? '-' : '';
    return {
      negative: margin < 0,
      text: `Margin ${sign}₹${Math.abs(margin).toLocaleString('en-IN')}${pct !== null ? ` (${pct}%)` : ''}`,
    };
  }, [liaisonFee, clientCharge]);

  const handleSubmit = async () => {
    if (!liaisonId) {
      toast.error('Pick a liaison');
      return;
    }
    if (!serviceName.trim()) {
      toast.error('Service is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        liaison_id: liaisonId,
        service_name: serviceName.trim(),
        contact_id: contactId,
        property_id: propertyId,
        client_charge: parseAmount(clientCharge),
        liaison_fee: parseAmount(liaisonFee),
        notes: notes.trim() || null,
        ...(isEdit ? { status: job.status } : {}),
      };

      const url = isEdit ? `/api/liaison-jobs/${job.id}` : '/api/liaison-jobs';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }

      toast.success(isEdit ? 'Job updated' : 'Job logged');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error('Error saving job:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Job' : 'Log Job'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            One engagement with a liaison — link the client and property, agree the
            amounts, then record payments as they happen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">
              Liaison <span className="text-red-400">*</span>
            </Label>
            <select
              value={liaisonId}
              onChange={(e) => setLiaisonId(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Select liaison...</option>
              {liaisons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.office_area ? ` — ${l.office_area}` : ''}
                  {l.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-service" className="text-xs text-slate-300">
              Service <span className="text-red-400">*</span>
            </Label>
            {selectedLiaison && selectedLiaison.services.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {selectedLiaison.services.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => applyService(s.name)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                      serviceName === s.name
                        ? 'border-primary/40 bg-primary/10 text-white'
                        : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-white hover:border-primary/40'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <Input
              id="job-service"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. Khata transfer"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Client</Label>
              <SearchableContactSelect
                contacts={contacts.map((c) => ({
                  id: c.id,
                  name: c.name ?? c.phone,
                  phone: c.phone,
                  name_tag: c.name_tag,
                }))}
                value={contactId}
                onChange={setContactId}
                placeholder="Link a contact..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Property</Label>
              <SearchablePropertySelect
                properties={properties}
                value={propertyId}
                onChange={setPropertyId}
                placeholder="Link a property..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="job-charge" className="text-xs text-slate-300">
                Client charge ₹
              </Label>
              <Input
                id="job-charge"
                value={clientCharge}
                onChange={(e) => setClientCharge(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="What you bill"
                inputMode="numeric"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-fee" className="text-xs text-slate-300">
                Liaison fee ₹
              </Label>
              <Input
                id="job-fee"
                value={liaisonFee}
                onChange={(e) => setLiaisonFee(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="What they charge"
                inputMode="numeric"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
          </div>
          {marginPreview && (
            <p
              className={`text-[11px] font-semibold -mt-2 ${
                marginPreview.negative ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {marginPreview.text}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="job-notes" className="text-xs text-slate-300">
              Notes
            </Label>
            <Textarea
              id="job-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Documents handed over, expected completion, follow-ups..."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-16 resize-none"
            />
          </div>
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Log job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
