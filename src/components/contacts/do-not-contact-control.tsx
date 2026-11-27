'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/useCan';
import {
  DO_NOT_CONTACT_HINT,
  DO_NOT_CONTACT_LABEL,
  DO_NOT_CONTACT_REASON_MAX,
} from '@/lib/contacts/do-not-contact';

interface DoNotContactControlProps {
  contactId: string;
  enabled?: boolean | null;
  reason?: string | null;
  onChange?: (enabled: boolean) => void;
}

export function DoNotContactControl({
  contactId,
  enabled,
  reason,
  onChange,
}: DoNotContactControlProps) {
  const canManage = useCan('make-changes');
  const [value, setValue] = useState(enabled === true);
  const [savedReason, setSavedReason] = useState(reason ?? '');
  const [draftReason, setDraftReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/do-not-contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next,
          reason: next ? draftReason : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not update contact');
      setValue(next);
      setSavedReason(next ? draftReason.trim() : '');
      setDraftReason('');
      setConfirming(false);
      onChange?.(next);
      toast.success(
        next
          ? 'Marked Do not contact — nothing will be sent to them.'
          : 'Do not contact turned off.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={
        value
          ? 'space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3'
          : 'space-y-2 rounded-xl border border-slate-800 bg-slate-900/50 p-3'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={`dnc-${contactId}`}
          className="flex items-center gap-2 text-slate-200"
        >
          <Ban className="h-4 w-4 text-rose-400" />
          {DO_NOT_CONTACT_LABEL}
        </Label>
        <Switch
          id={`dnc-${contactId}`}
          checked={value || confirming}
          disabled={!canManage || saving}
          onCheckedChange={(checked) => {
            if (checked) setConfirming(true);
            else if (confirming) setConfirming(false);
            else void apply(false);
          }}
        />
      </div>
      <p className="text-xs text-slate-400">{DO_NOT_CONTACT_HINT}</p>
      {value && savedReason && (
        <p className="text-xs text-rose-300">Reason: {savedReason}</p>
      )}
      {confirming && !value && (
        <div className="space-y-2">
          <Input
            value={draftReason}
            maxLength={DO_NOT_CONTACT_REASON_MAX}
            onChange={(e) => setDraftReason(e.target.value)}
            placeholder="Why? (optional) — e.g. deals only through his son"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void apply(true)}
              className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Stop all communication'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirming(false);
                setDraftReason('');
              }}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
