'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import type { Liaison, LiaisonService } from '@/types';
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
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2 } from 'lucide-react';

/** Common Bengaluru property-paperwork services — one tap adds a fee row. */
const SERVICE_SUGGESTIONS = [
  'Khata transfer',
  'New khata',
  'BBMP work',
  'EC',
  'Registration',
  'Mutation',
  'DC conversion',
  'Tax paid receipt',
];

/** Editable row: fee kept as string while typing, parsed on submit. */
interface ServiceRow {
  name: string;
  fee: string;
  fee_note: string;
}

function toRows(services: LiaisonService[]): ServiceRow[] {
  return services.map((s) => ({
    name: s.name,
    fee: s.fee !== null && s.fee !== undefined ? String(s.fee) : '',
    fee_note: s.fee_note ?? '',
  }));
}

interface LiaisonFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  liaison?: Liaison | null;
  onSaved: () => void;
}

export function LiaisonForm({ open, onOpenChange, liaison, onSaved }: LiaisonFormProps) {
  const isEdit = !!liaison;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [email, setEmail] = useState('');
  const [officeArea, setOfficeArea] = useState('');
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Re-seed the fields every time the dialog opens — the same mounted
  // instance is reused across add/edit invocations.
  useEffect(() => {
    if (!open) return;
    setName(liaison?.name ?? '');
    setPhone(liaison?.phone ?? '');
    setAltPhone(liaison?.alt_phone ?? '');
    setEmail(liaison?.email ?? '');
    setOfficeArea(liaison?.office_area ?? '');
    setServices(liaison ? toRows(liaison.services ?? []) : []);
    setNotes(liaison?.notes ?? '');
    setIsActive(liaison?.is_active ?? true);
  }, [open, liaison]);

  const updateService = (index: number, patch: Partial<ServiceRow>) => {
    setServices((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const addService = (serviceName = '') => {
    setServices((prev) => [...prev, { name: serviceName, fee: '', fee_note: '' }]);
  };

  const removeService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index));
  };

  const suggestionsLeft = SERVICE_SUGGESTIONS.filter(
    (s) => !services.some((row) => row.name.trim().toLowerCase() === s.toLowerCase()),
  );

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || null,
        alt_phone: altPhone.trim() || null,
        email: email.trim() || null,
        office_area: officeArea.trim() || null,
        services: services
          .filter((row) => row.name.trim())
          .map((row) => {
            const fee = Number(row.fee);
            return {
              name: row.name.trim(),
              fee: row.fee.trim() && Number.isFinite(fee) && fee >= 0 ? fee : null,
              fee_note: row.fee_note.trim() || null,
            };
          }),
        notes: notes.trim() || null,
        ...(isEdit ? { is_active: isActive } : {}),
      };

      const url = isEdit ? `/api/liaisons/${liaison.id}` : '/api/liaisons';
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

      toast.success(isEdit ? 'Liaison updated' : 'Liaison added');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error('Error saving liaison:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save liaison');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Liaison' : 'Add Liaison'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Who they are, how to reach them, and what they charge for each service.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="liaison-name" className="text-xs text-slate-300">
                Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="liaison-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shiv"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liaison-office-area" className="text-xs text-slate-300">
                Office / Area
              </Label>
              <Input
                id="liaison-office-area"
                value={officeArea}
                onChange={(e) => setOfficeArea(e.target.value)}
                placeholder="e.g. BBMP Bommanahalli, SRO Jayanagar"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liaison-phone" className="text-xs text-slate-300">
                Phone
              </Label>
              <Input
                id="liaison-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9876543210"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liaison-alt-phone" className="text-xs text-slate-300">
                Alternate Phone
              </Label>
              <Input
                id="liaison-alt-phone"
                value={altPhone}
                onChange={(e) => setAltPhone(e.target.value)}
                placeholder="Optional"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="liaison-email" className="text-xs text-slate-300">
                Email
              </Label>
              <Input
                id="liaison-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Services & fees */}
          <div className="space-y-2 border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-300">Services & Fees</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => addService()}
                className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 gap-1 cursor-pointer"
              >
                <Plus className="size-3" />
                Add service
              </Button>
            </div>

            {suggestionsLeft.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestionsLeft.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addService(s)}
                    className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[10px] font-semibold text-slate-400 hover:text-white hover:border-primary/40 hover:bg-primary/10 transition-colors cursor-pointer"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            )}

            {services.length === 0 ? (
              <p className="text-[11px] text-slate-500 py-2">
                No services added yet — tap a suggestion above or add your own.
              </p>
            ) : (
              <div className="space-y-2">
                {services.map((row, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_8rem_1fr_auto] gap-2 items-start rounded-lg border border-slate-800 bg-slate-950/40 p-2"
                  >
                    <Input
                      value={row.name}
                      onChange={(e) => updateService(index, { name: e.target.value })}
                      placeholder="Service, e.g. Khata transfer"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
                    />
                    <Input
                      value={row.fee}
                      onChange={(e) =>
                        updateService(index, {
                          fee: e.target.value.replace(/[^\d.]/g, ''),
                        })
                      }
                      placeholder="Fee ₹"
                      inputMode="numeric"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs sm:col-start-2 col-start-1"
                    />
                    <Input
                      value={row.fee_note}
                      onChange={(e) => updateService(index, { fee_note: e.target.value })}
                      placeholder="Fee note, e.g. excl. govt charges"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs col-start-1 sm:col-start-3"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeService(index)}
                      aria-label="Remove service"
                      className="h-8 w-8 p-0 text-slate-500 hover:text-red-400 hover:bg-slate-800 cursor-pointer row-start-1 col-start-2 sm:col-start-4"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5 border-t border-slate-800 pt-4">
            <Label htmlFor="liaison-notes" className="text-xs text-slate-300">
              Notes
            </Label>
            <Textarea
              id="liaison-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Turnaround times, documents they need, who referred them..."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-20 resize-none"
            />
          </div>

          {isEdit && (
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <div>
                <Label className="text-xs text-slate-300">Active</Label>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Turn off if they&apos;ve stopped taking work — the entry stays for reference.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
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
            {isEdit ? 'Save changes' : 'Add liaison'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
