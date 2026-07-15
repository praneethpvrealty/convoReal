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
  buildOwnerDigestTemplatePayload,
} from '@/lib/whatsapp/owner-digest-template';

/**
 * Settings card for the Owner Property Digest — periodic WhatsApp
 * status updates to property owners/sellers (new enquiries, shortlists,
 * scheduled site visits, showcase views on their listings). Digests are
 * sent only when there is new activity; owners can pause anytime by
 * replying "STOP UPDATES".
 */

type Frequency = 'off' | 'daily' | 'weekly';

export function OwnerDigestCard() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('off');
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [submittingTemplate, setSubmittingTemplate] = useState(false);

  const loadState = useCallback(async () => {
    if (!accountId) return;
    try {
      const [{ data: settings }, { data: template }] = await Promise.all([
        supabase
          .from('owner_digest_settings')
          .select('frequency')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('status')
          .eq('account_id', accountId)
          .eq('name', OWNER_DIGEST_TEMPLATE_NAME)
          .order('last_submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (settings?.frequency) setFrequency(settings.frequency as Frequency);
      setTemplateStatus(template?.status ?? null);
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
        value === 'off'
          ? 'Owner digests turned off'
          : `Owner digests set to ${value}`
      );
    } catch (err) {
      setFrequency(previous);
      console.error('[owner-digest] save failed:', err);
      toast.error('Failed to save digest setting');
    } finally {
      setSaving(false);
    }
  };

  // One-click create/resubmit of the owner_property_digest Utility
  // template — same flow as the Match Radar alert template. Owners
  // rarely have an open 24h window, so digests need this approved.
  const handleSubmitTemplate = async () => {
    setSubmittingTemplate(true);
    try {
      const payload = buildOwnerDigestTemplatePayload();
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      setTemplateStatus('PENDING');
      toast.success(
        'Template submitted to Meta — digests go out automatically once it is approved.'
      );
    } catch (err) {
      console.error('[owner-digest] template submit failed:', err);
      toast.error(err instanceof Error ? err.message : 'Template submission failed');
    } finally {
      setSubmittingTemplate(false);
    }
  };

  const templateBadge =
    templateStatus === 'APPROVED' ? (
      <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        Template approved
      </Badge>
    ) : templateStatus === 'PENDING' ? (
      <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">
        Template pending approval
      </Badge>
    ) : templateStatus ? (
      <Badge className="bg-red-500/15 text-red-400 border border-red-500/30">
        Template {templateStatus.toLowerCase()}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-slate-600 text-slate-400">
        Template not created
      </Badge>
    );

  return (
    <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-primary" />
            <CardTitle className="text-white">Owner Property Digest</CardTitle>
          </div>
          {!loading && templateBadge}
        </div>
        <CardDescription className="text-slate-400">
          Automatic WhatsApp status updates to property owners/sellers: new enquiries,
          shortlisted buyers, scheduled site visits and showcase views on their
          listings. Sent only when there&apos;s new activity — owners can reply
          &quot;STOP UPDATES&quot; to pause anytime.
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

            {frequency !== 'off' && templateStatus !== 'APPROVED' && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 space-y-3">
                <p>
                  Owners usually haven&apos;t messaged you in the last 24 hours, so
                  digests need the pre-approved{' '}
                  <span className="font-mono text-xs">{OWNER_DIGEST_TEMPLATE_NAME}</span>{' '}
                  Utility template. Submit it once — Meta approval typically takes
                  minutes to a few hours.
                </p>
                <Button
                  size="sm"
                  onClick={handleSubmitTemplate}
                  disabled={submittingTemplate || templateStatus === 'PENDING'}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {submittingTemplate ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Submitting...
                    </>
                  ) : templateStatus === 'PENDING' ? (
                    'Waiting for Meta approval'
                  ) : (
                    'Submit digest template to Meta'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
