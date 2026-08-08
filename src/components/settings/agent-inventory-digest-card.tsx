'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
} from '@/lib/whatsapp/agent-inventory-digest-template';

/**
 * Settings card for the Agent Inventory Digest — periodic WhatsApp
 * reach updates to SOURCE AGENTS (partner agents whose inventory this
 * account lists as agent-referred): direct buyers their listings were
 * shared with, indirect buyers reached through downstream partner
 * agents, and partner agents onboarded. Source agents without a
 * ConvoReal account get a signup invite once the chat is open.
 *
 * There is no agent-specific template to submit here: the digest sends
 * through the owner digest's approved Utility template (see the header
 * of agent-inventory-digest-template.ts for why). This card reports
 * that template's status and points at the Owner Digest tab, which
 * owns submitting it.
 */

type Frequency = 'off' | 'daily' | 'weekly';

export function AgentInventoryDigestCard() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('off');
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [templateCategory, setTemplateCategory] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);

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
          .select('id, name, status, category, meta_template_id, last_submitted_at')
          .eq('account_id', accountId)
          .in('name', AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES)
          .order('last_submitted_at', { ascending: false }),
      ]);
      if (settings?.frequency) setFrequency(settings.frequency as Frequency);
      // Mirrors the send path: the shared owner template wins, and a
      // legacy agent-specific row is the fallback that still delivers.
      const shared = (templates || []).find(
        (t) => t.name === AGENT_INVENTORY_DIGEST_TEMPLATE_NAME && t.status === 'APPROVED'
      );
      const template = shared ?? (templates || []).find((t) => t.status === 'APPROVED') ?? null;
      setTemplateStatus(template?.status ?? null);
      setTemplateCategory(template?.category ?? null);
      setTemplateName(template?.name ?? null);
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

  const sharesOwnerTemplate = templateName === AGENT_INVENTORY_DIGEST_TEMPLATE_NAME;
  const miscategorized = templateCategory === 'Marketing';

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
          a signup invite once they reply and the chat is open; their &quot;STOP UPDATES&quot;
          reply always overrides this setting.
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
                  the digest needs a pre-approved template. It shares the Owner Property
                  Digest template rather than having one of its own — submit that one in the
                  Owner Digest tab and both digests are covered.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white">Reach digest</p>
                    <p className="text-xs text-slate-400">
                      {templateName
                        ? `Sends through "${templateName}".`
                        : 'The recurring reach summary sent to each source agent.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">{statusBadge(templateStatus)}</div>
                </div>
                {!templateStatus && (
                  <p className="text-xs text-amber-400">
                    No approved template yet — submit the Status digest in the Owner Digest
                    tab. Until then, agents with an open chat still get the full free-form
                    breakdown; the rest are skipped.
                  </p>
                )}
                {miscategorized && !sharesOwnerTemplate && (
                  <p className="text-xs text-amber-400">
                    Digests are going out on {templateName}, which Meta categorised as
                    Marketing — billed at the marketing rate and requiring marketing opt-in.
                    Submitting the Owner Digest template moves them onto its Utility
                    category. A template&apos;s category is fixed once Meta approves it, so
                    the only way to change this one is an appeal in WhatsApp Manager
                    (Business Support) within 60 days.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
