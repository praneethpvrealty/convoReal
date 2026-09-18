'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, Loader2, Megaphone } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface WhatsAppNumberChangeCardProps {
  refreshToken: string | null;
}

interface NumberChangeStatus {
  active: boolean;
  previousNumber: string | null;
  changedAt: string | null;
  expiresAt: string | null;
  days: number;
  audienceCount?: number;
  notifiedCount?: number;
  templateStatus?: 'approved' | 'pending' | 'missing';
}

interface NotifyResult {
  audience: number;
  sent: number;
  viaTemplate: number;
  viaFreeform: number;
  skippedNoTemplate: number;
  failed: number;
}

const QUERY_KEY = ['whatsapp-number-change'] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export function WhatsAppNumberChangeCard({
  refreshToken,
}: WhatsAppNumberChangeCardProps) {
  const canManage = useCan('edit-settings');
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);

  const statusQuery = useQuery({
    queryKey: [...QUERY_KEY, refreshToken, days],
    queryFn: () =>
      api<NumberChangeStatus>(`/api/whatsapp/number-change?days=${days}`),
  });
  const status = statusQuery.data;

  const notifyMutation = useMutation({
    mutationFn: () =>
      api<NotifyResult>('/api/whatsapp/number-change/notify', {
        method: 'POST',
        body: JSON.stringify({ days }),
      }),
    onSuccess: async (result) => {
      if (result.sent > 0) {
        toast.success(
          `Number-change notice sent to ${result.sent} of ${result.audience} contacts (${result.viaTemplate} by template, ${result.viaFreeform} in open chats).`
        );
      } else if (result.skippedNoTemplate > 0) {
        toast.warning(
          'The notice template is not approved yet, so contacts outside their 24-hour window were skipped. Submit it from the Templates tab and try again once Meta approves it.',
          { duration: 12000 }
        );
      } else if (result.audience === 0) {
        toast.info(
          'Every contact active in this period has already been told.'
        );
      }
      if (result.failed > 0) {
        toast.error(
          `${result.failed} sends failed. Check the inbox for details.`
        );
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: Error) => toast.error(err.message, { duration: 10000 }),
  });

  if (statusQuery.isPending) {
    return (
      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-slate-500" />
        </CardContent>
      </Card>
    );
  }

  if (!status?.active) return null;

  const changedAt = status.changedAt
    ? new Date(status.changedAt).toLocaleString()
    : 'recently';
  const expiresAt = status.expiresAt
    ? new Date(status.expiresAt).toLocaleDateString()
    : '';

  return (
    <Card className="border-amber-700/50 bg-amber-950/20 ring-0 ring-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-100">
          <ArrowLeftRight className="size-4 text-amber-300" />
          Number changed
        </CardTitle>
        <CardDescription className="text-amber-100/80">
          Since {changedAt} you message from a different number than{' '}
          <strong className="text-amber-50">{status.previousNumber}</strong>.
          Until {expiresAt}, the first message to each contact is preceded once
          by a notice explaining the change, so routine check-ins do not arrive
          from an unknown number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-800/50 bg-slate-900/60 p-3">
            <p className="text-[11px] tracking-wide text-slate-400 uppercase">
              Not yet told
            </p>
            <p className="text-2xl font-semibold text-white">
              {status.audienceCount ?? 0}
            </p>
            <p className="text-xs text-slate-400">
              active in the last {days} days
            </p>
          </div>
          <div className="rounded-lg border border-amber-800/50 bg-slate-900/60 p-3">
            <p className="text-[11px] tracking-wide text-slate-400 uppercase">
              Already told
            </p>
            <p className="text-2xl font-semibold text-white">
              {status.notifiedCount ?? 0}
            </p>
            <p className="text-xs text-slate-400">
              by request or as a precursor
            </p>
          </div>
          <div className="rounded-lg border border-amber-800/50 bg-slate-900/60 p-3">
            <p className="text-[11px] tracking-wide text-slate-400 uppercase">
              Notice template
            </p>
            <p className="text-2xl font-semibold text-white capitalize">
              {status.templateStatus ?? 'missing'}
            </p>
            <p className="text-xs text-slate-400">
              {status.templateStatus === 'approved'
                ? 'reaches contacts outside their 24-hour window'
                : 'needed for contacts outside their 24-hour window'}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">
                Contacts active in the last
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  onChange={(e) =>
                    setDays(
                      Math.min(30, Math.max(1, Number(e.target.value) || 1))
                    )
                  }
                  className="h-9 w-20 border-slate-700 bg-slate-900 text-white"
                />
                <span className="text-sm text-slate-400">days</span>
              </div>
            </div>
            <Button
              className="gap-1.5"
              disabled={
                notifyMutation.isPending || (status.audienceCount ?? 0) === 0
              }
              onClick={() => notifyMutation.mutate()}
            >
              {notifyMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Megaphone className="size-4" />
              )}
              Notify {status.audienceCount ?? 0} contacts now
            </Button>
          </div>
        )}

        {status.templateStatus !== 'approved' && (
          <p className="text-xs text-amber-200/80">
            Contacts who messaged in the last 24 hours receive the notice as a
            normal message. Everyone else needs the approved{' '}
            <code className="text-amber-100">contact_number_update</code>{' '}
            template: submit it from Settings → WhatsApp → Templates under
            &quot;templates the Engine sends&quot;.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
