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
import { Share2, Loader2 } from 'lucide-react';
import {
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  buildAgentInventoryDigestTemplatePayload,
} from '@/lib/whatsapp/agent-inventory-digest-template';

/**
 * Settings card for the Agent Inventory Digest — periodic WhatsApp
 * reach updates to SOURCE AGENTS (partner agents whose inventory this
 * account lists as agent-referred): direct buyers their listings were
 * shared with, indirect buyers reached through downstream partner
 * agents, and partner agents onboarded. Source agents without a
 * ConvoReal account get a signup invite with each digest.
 */

type Frequency = 'off' | 'daily' | 'weekly';

export function AgentInventoryDigestCard() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('off');
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadState = useCallback(async () => {
    if (!accountId) return;
    try {
      const [{ data: settings }, { data: templates }] = await Promise.all([
        supabase
          .from('agent_inventory_digest_settings')
          .select('frequency')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('name, status, last_submitted_at')
          .eq('account_id', accountId)
          .eq('name', AGENT_INVENTORY_DIGEST_TEMPLATE_NAME)
          .order('last_submitted_at', { ascending: false })
          .limit(1),
      ]);
      if (settings?.frequency) setFrequency(settings.frequency as Frequency);
      setTemplateStatus(templates?.[0]?.status ?? null);
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
        .from('agent_inventory_digest_settings')
        .upsert(
          { account_id: accountId, frequency: value, updated_at: new Date().toISOString() },
          { onConflict: 'account_id' }
        );
      if (error) throw error;
      toast.success(
        value === 'off' ? 'Agent digests turned off' : `Agent digests set to ${value}`
      );
    } catch (err) {
      setFrequency(previous);
      console.error('[agent-inventory-digest] save failed:', err);
      toast.error('Failed to save digest setting');
    } finally {
      setSaving(false);
    }
  };

  // One-click create/resubmit — same flow as the owner digest template.
  // Source agents rarely have an open 24h window, so the template needs
  // Meta approval for the feature to reach them.
  const handleSubmitTemplate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAgentInventoryDigestTemplatePayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      setTemplateStatus('PENDING');
      toast.success('Reach digest template submitted to Meta for approval.');
    } catch (err) {
      console.error('[agent-inventory-digest] template submit failed:', err);
      toast.error(err instanceof Error ? err.message : 'Template submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string | null) =>
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
          <Share2 className="size-4 text-primary" />
          <CardTitle className="text-white">Agent Inventory Digest</CardTitle>
        </div>
        <CardDescription className="text-slate-400">
          Automatic WhatsApp reach updates to partner agents whose inventory you list as
          agent-referred: how many direct buyers their listings were shared with and how many
          more were reached through downstream partner agents. Agents not yet on ConvoReal get
          a signup invite with each digest; their &quot;STOP UPDATES&quot; reply always
          overrides this setting.
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
                  Partner agents usually haven&apos;t messaged you in the last 24 hours, so
                  the digest needs a pre-approved Utility template. Submit it once — Meta
                  approval typically takes minutes to a few hours.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white">Reach digest</p>
                    <p className="text-xs text-slate-400">
                      The recurring reach summary sent to each source agent.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(templateStatus)}
                    {templateStatus !== 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSubmitTemplate}
                        disabled={submitting || templateStatus === 'PENDING'}
                        className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                      >
                        {submitting ? (
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
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
