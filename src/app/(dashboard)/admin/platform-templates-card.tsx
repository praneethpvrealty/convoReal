'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareHeart, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  buildExtensionApologyTemplatePayload,
  buildExtensionGoodwillTemplatePayload,
  EXTENSION_APOLOGY_TEMPLATE_NAME,
  EXTENSION_GOODWILL_TEMPLATE_NAME,
} from '@/lib/whatsapp/subscription-extension-template';
import {
  buildSupportTicketReplyTemplatePayload,
  SUPPORT_TICKET_REPLY_TEMPLATE_NAME,
} from '@/lib/whatsapp/support-ticket-reply-template';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

interface Slot {
  name: string;
  label: string;
  whyItMatters: string;
  buildPayload: () => TemplatePayload;
}

const SLOTS: Slot[] = [
  {
    name: EXTENSION_APOLOGY_TEMPLATE_NAME,
    label: 'Extension — apology',
    whyItMatters:
      'Carries the "we broke something, here are free days" message to a customer with no open 24-hour window. Used for outage, degraded service and billing errors.',
    buildPayload: buildExtensionApologyTemplatePayload,
  },
  {
    name: EXTENSION_GOODWILL_TEMPLATE_NAME,
    label: 'Extension — goodwill',
    whyItMatters:
      'The same message without an apology, for credit granted as a gesture rather than an admission. Used for onboarding delays and support goodwill.',
    buildPayload: buildExtensionGoodwillTemplatePayload,
  },
  {
    name: SUPPORT_TICKET_REPLY_TEMPLATE_NAME,
    label: 'Support — ticket answer',
    whyItMatters:
      'Carries a help-desk answer to a requester who chose WhatsApp. Tickets are filed from the in-app helper, so the 24-hour window is almost never open — without this template the answer reaches nobody.',
    buildPayload: buildSupportTicketReplyTemplatePayload,
  },
];

/**
 * These two live on the PLATFORM WABA — this card is scoped to the
 * super-admin's own account, which is the account the platform sender
 * resolves to (src/lib/whatsapp/platform-sender.ts).
 *
 * Until they are approved, an extension notice can only fall back to
 * free-form text, which reaches nobody outside an open 24-hour window.
 * That failure is silent from the customer's side, so it needs to be
 * visible from ours.
 */
export default function PlatformTemplatesCard() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [statuses, setStatuses] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data } = await supabase
        .from('message_templates')
        .select('name, status, last_submitted_at')
        .eq('account_id', accountId)
        .in(
          'name',
          SLOTS.map((s) => s.name)
        )
        .order('last_submitted_at', { ascending: false, nullsFirst: false });

      const next: Record<string, string | null> = {};
      for (const row of data || []) {
        // Rows are newest-first; keep the first status seen per name.
        if (!(row.name in next)) next[row.name] = row.status;
      }
      setStatuses(next);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  async function submit(slot: Slot) {
    setSubmitting(slot.name);
    try {
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slot.buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      setStatuses((prev) => ({ ...prev, [slot.name]: 'PENDING' }));
      toast.success(`${slot.label} submitted to Meta for approval.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Template submission failed'
      );
    } finally {
      setSubmitting(null);
    }
  }

  function badge(status: string | null | undefined) {
    if (status === 'APPROVED') {
      return (
        <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
          Approved
        </Badge>
      );
    }
    if (status === 'PENDING') {
      return (
        <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-400">
          Pending approval
        </Badge>
      );
    }
    if (status) {
      return (
        <Badge className="border border-red-500/30 bg-red-500/15 text-red-400">
          {status.toLowerCase()}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-slate-600 text-slate-400">
        Not created
      </Badge>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <MessageSquareHeart className="text-primary h-4 w-4" />
          Notification Templates
        </CardTitle>
        <CardDescription className="text-slate-400">
          The Meta templates the extension notice is delivered through, on
          ConvoReal&apos;s own WhatsApp number. Without an approved template the
          notice can only reach customers who have messaged us in the last 24
          hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking template
            status…
          </div>
        ) : (
          SLOTS.map((slot) => (
            <div
              key={slot.name}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {slot.label}
                  </span>
                  {badge(statuses[slot.name])}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {slot.whyItMatters}
                </p>
              </div>
              {statuses[slot.name] !== 'APPROVED' && (
                <button
                  type="button"
                  onClick={() => submit(slot)}
                  disabled={submitting === slot.name}
                  className="border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-40"
                >
                  {submitting === slot.name ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  {statuses[slot.name] ? 'Resubmit' : 'Create'}
                </button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
