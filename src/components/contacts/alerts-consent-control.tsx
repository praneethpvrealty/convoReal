'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCan } from '@/hooks/use-can';
import {
  CONSENT_HINTS,
  CONSENT_LABELS,
  CONSENT_OVERRIDE_WARNING,
  CONSENT_STATES,
  consentOverrideNeedsAck,
  isConsentState,
  type AlertsConsent,
} from '@/lib/contacts/alerts-consent';

interface AlertsConsentControlProps {
  contactId: string;
  consent?: string | null;
  requestedAt?: string | null;
}

const STATE_STYLES: Record<AlertsConsent, string> = {
  pending: 'border-slate-700 bg-slate-800/60 text-slate-300',
  granted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  declined: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function AlertsConsentControl({
  contactId,
  consent,
  requestedAt,
}: AlertsConsentControlProps) {
  const canManage = useCan('send-messages');
  const [value, setValue] = useState<AlertsConsent>(
    isConsentState(consent) ? consent : 'pending'
  );
  const [saving, setSaving] = useState(false);

  const apply = async (next: AlertsConsent, acknowledgeOverride = false) => {
    if (next === value || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/consent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: next, acknowledgeOverride }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (json.code === 'CONSENT_OVERRIDE_REQUIRES_ACK') {
          if (window.confirm(`${CONSENT_OVERRIDE_WARNING}\n\nContinue?`)) {
            setSaving(false);
            return apply(next, true);
          }
          return;
        }
        throw new Error(json.error || 'Could not update consent');
      }
      setValue(next);
      toast.success(`Marked as “${CONSENT_LABELS[next]}”.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-slate-300">WhatsApp Marketing Consent</Label>
      <div className="flex flex-wrap gap-2">
        {CONSENT_STATES.map((state) => (
          <button
            key={state}
            type="button"
            disabled={!canManage || saving}
            onClick={() => apply(state)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60',
              value === state
                ? STATE_STYLES[state]
                : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-500'
            )}
          >
            {CONSENT_LABELS[state]}
            {consentOverrideNeedsAck(value, state) ? ' ⚠︎' : ''}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{CONSENT_HINTS[value]}</p>
      <p className="text-xs text-slate-600">
        {requestedAt
          ? `Asked on WhatsApp ${format(new Date(requestedAt), 'd MMM yyyy')}. `
          : ''}
        Their own STOP ALERTS / START ALERTS reply updates this too, and is the
        stronger record — set it here only for what they told you directly.
      </p>
    </div>
  );
}
