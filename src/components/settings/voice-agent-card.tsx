'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Loader2, PhoneCall, RefreshCw } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface VoiceConfig {
  agent_ref: string | null;
  phone_number: string | null;
  webhook_token: string;
  is_active: boolean;
  reminder_calls_enabled: boolean;
}

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

/**
 * Settings → WhatsApp → Voice: the account's voice provider setup —
 * default agent id (used by campaigns and reminder calls when a
 * campaign carries none), the per-account webhook credential the
 * provider's post-call webhook must present, and the reminder-call
 * opt-in.
 */
export function VoiceAgentCard() {
  const canManage = useCan('edit-settings');
  const { accountId } = useAuth();
  const queryClient = useQueryClient();
  const [agentRef, setAgentRef] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ['voice-config'],
    queryFn: () => api<VoiceConfig | null>('/api/voice-config'),
  });
  const config = configQuery.data ?? null;

  const saveMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<VoiceConfig>('/api/voice-config', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      toast.success('Voice settings saved');
      queryClient.invalidateQueries({ queryKey: ['voice-config'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const webhookUrl =
    config && accountId
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/voice-agent?token=${config.webhook_token}&account_id=${accountId}`
      : null;

  if (configQuery.isPending) {
    return (
      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <PhoneCall className="text-primary h-5 w-5" />
          Voice Agent
        </CardTitle>
        <CardDescription>
          Powers qualification call campaigns and phone-call reminders. Create
          the agent at your voice provider (Sarvam by default), then connect it
          here — its post-call webhook must POST to the URL below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vac-agent">Default voice agent id</Label>
            <Input
              id="vac-agent"
              value={agentRef ?? config?.agent_ref ?? ''}
              onChange={(e) => setAgentRef(e.target.value)}
              placeholder="agent id from your provider"
              disabled={!canManage}
            />
            <p className="text-xs text-slate-500">
              Used by campaigns and reminder calls when a campaign has no agent
              of its own.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vac-phone">Provisioned phone number</Label>
            <Input
              id="vac-phone"
              value={phoneNumber ?? config?.phone_number ?? ''}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+91…"
              disabled={!canManage}
            />
            <p className="text-xs text-slate-500">
              The number your provider dials from — informational.
            </p>
          </div>
        </div>

        {config && (
          <div className="space-y-1.5">
            <Label>Post-call webhook URL</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={webhookUrl ?? ''}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (webhookUrl) {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success('Webhook URL copied');
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {canManage && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Rotate the webhook token? The provider must be updated with the new URL or its results stop landing.'
                      )
                    ) {
                      saveMutation.mutate({ regenerate_token: true });
                    }
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rotate
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Paste this into the agent&apos;s post-call webhook at your
              provider. The token is this account&apos;s credential — rotate it
              if it leaks.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-white">Voice agent active</p>
            <p className="text-xs text-slate-500">
              Master switch for account-default calling.
            </p>
          </div>
          <Switch
            checked={config?.is_active ?? false}
            disabled={!canManage || saveMutation.isPending}
            onCheckedChange={(v) => saveMutation.mutate({ is_active: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-white">
              Appointment reminders as calls
            </p>
            <p className="text-xs text-slate-500">
              Contacts who prefer phone calls get their reminder as a
              voice-agent call (25 cr per call, refunded if it fails to start).
              Others are unaffected.
            </p>
          </div>
          <Switch
            checked={config?.reminder_calls_enabled ?? false}
            disabled={!canManage || saveMutation.isPending}
            onCheckedChange={(v) =>
              saveMutation.mutate({ reminder_calls_enabled: v })
            }
          />
        </div>

        {canManage && (
          <Button
            disabled={saveMutation.isPending}
            onClick={() =>
              saveMutation.mutate({
                ...(agentRef !== null ? { agent_ref: agentRef } : {}),
                ...(phoneNumber !== null ? { phone_number: phoneNumber } : {}),
              })
            }
          >
            {saveMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save voice settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
