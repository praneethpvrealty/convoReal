'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BellRing, Loader2 } from 'lucide-react';
import {
  OWNER_DIGEST_TEMPLATE_NAME,
  OWNER_DIGEST_CONSENT_TEMPLATE_NAME,
  buildOwnerDigestTemplatePayload,
  buildOwnerDigestConsentTemplatePayload,
} from '@/lib/whatsapp/owner-digest-template';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

/**
 * Settings card for the Owner Property Digest — periodic WhatsApp
 * status updates to property owners/sellers (new enquiries, shortlists,
 * scheduled site visits, showcase views on their listings).
 *
 * Consent-first: before any digest, each owner gets a one-time consent
 * request; digests flow only after they reply yes, and their choice
 * always overrides this account-level setting. Digests are sent only
 * when there's new activity in the period.
 */

type Frequency = 'off' | 'daily' | 'weekly';

interface TemplateSlot {
  name: string;
  label: string;
  description: string;
  buildPayload: () => TemplatePayload;
}

const TEMPLATE_SLOTS: TemplateSlot[] = [
  {
    name: OWNER_DIGEST_CONSENT_TEMPLATE_NAME,
    label: 'Consent request',
    description: 'Asks each owner once whether they want updates (Yes/No buttons).',
    buildPayload: buildOwnerDigestConsentTemplatePayload,
  },
  {
    name: OWNER_DIGEST_TEMPLATE_NAME,
    label: 'Status digest',
    description: 'The recurring activity summary sent to owners who said yes.',
    buildPayload: buildOwnerDigestTemplatePayload,
  },
];

export function OwnerDigestCard() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('off');
  const [templateStatus, setTemplateStatus] = useState<Record<string, string | null>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!accountId) return;
    try {
      const [{ data: settings }, { data: templates }] = await Promise.all([
        supabase
          .from('owner_digest_settings')
          .select('frequency')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('name, status, last_submitted_at')
          .eq('account_id', accountId)
          .in(
            'name',
            TEMPLATE_SLOTS.map((t) => t.name)
          )
          .order('last_submitted_at', { ascending: false }),
      ]);
      if (settings?.frequency) setFrequency(settings.frequency as Frequency);
      const statuses: Record<string, string | null> = {};
      for (const row of templates || []) {
        // Rows are newest-first; keep the first status seen per name.
        if (!(row.name in statuses)) statuses[row.name] = row.status;
      }
      setTemplateStatus(statuses);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (!authLoading) loadState();
  }, [authLoading, loadState]);

  const handleFrequencyChange = async (value: Frequency) => {
    if (!accountId) return;
    const previous = frequency;
    setFrequency(value);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('owner_digest_settings')
        .upsert(
          { account_id: accountId, frequency: value, updated_at: new Date().toISOString() },
          { onConflict: 'account_id' }
        );
      if (error) throw error;
      toast.success(
        value === 'off' ? 'Owner digests turned off' : `Owner digests set to ${value}`
      );
    } catch (err) {
      setFrequency(previous);
      console.error('[owner-digest] save failed:', err);
      toast.error('Failed to save digest setting');
    } finally {
      setSaving(false);
    }
  };

  // One-click create/resubmit — same flow as the Match Radar alert
  // template. Owners rarely have an open 24h window, so both templates
  // need Meta approval for the feature to reach them.
  const handleSubmitTemplate = async (slot: TemplateSlot) => {
    setSubmitting(slot.name);
    try {
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slot.buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      setTemplateStatus((prev) => ({ ...prev, [slot.name]: 'PENDING' }));
      toast.success(`${slot.label} template submitted to Meta for approval.`);
    } catch (err) {
      console.error('[owner-digest] template submit failed:', err);
      toast.error(err instanceof Error ? err.message : 'Template submission failed');
    } finally {
      setSubmitting(null);
    }
  };

  const statusBadge = (status: string | null | undefined) =>
    status === 'APPROVED' ? (
      <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        Approved
      </Badge>
    ) : status === 'PENDING' ? (
      <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">
        Pending approval
      </Badge>
    ) : status ? (
      <Badge className="bg-red-500/15 text-red-400 border border-red-500/30">
        {status.toLowerCase()}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-slate-600 text-slate-400">
        Not created
      </Badge>
    );

  return (
    <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="size-4 text-primary" />
          <CardTitle className="text-white">Owner Property Digest</CardTitle>
        </div>
        <CardDescription className="text-slate-400">
          Automatic WhatsApp status updates to property owners/sellers: new enquiries,
          shortlisted buyers, scheduled site visits and showcase views on their listings.
          Consent-first — each owner is asked once before anything is sent, digests go out
          only when there&apos;s new activity, and the owner&apos;s reply
          (&quot;STOP UPDATES&quot; / &quot;START UPDATES&quot;) always overrides this setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading digest settings...
          </div>
        ) : (
          <>
            <div className="space-y-2 max-w-xs">
              <Label className="text-slate-300">Frequency</Label>
              <Select
                value={frequency}
                onValueChange={(v) => handleFrequencyChange(v as Frequency)}
                disabled={saving}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="daily">Daily (mornings, IST)</SelectItem>
                  <SelectItem value="weekly">Weekly (Monday mornings, IST)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {frequency !== 'off' && (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <p className="text-sm text-slate-300">
                  Owners usually haven&apos;t messaged you in the last 24 hours, so both
                  messages below need pre-approved Utility templates. Submit each once —
                  Meta approval typically takes minutes to a few hours.
                </p>
                {TEMPLATE_SLOTS.map((slot) => {
                  const status = templateStatus[slot.name] ?? null;
                  return (
                    <div
                      key={slot.name}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-white">{slot.label}</p>
                        <p className="text-xs text-slate-400">{slot.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statusBadge(status)}
                        {status !== 'APPROVED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSubmitTemplate(slot)}
                            disabled={submitting !== null || status === 'PENDING'}
                            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                          >
                            {submitting === slot.name ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                Submitting...
                              </>
                            ) : (
                              'Submit to Meta'
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
