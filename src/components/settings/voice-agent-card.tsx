'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Loader2, PhoneCall, RefreshCw } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { AI_FEATURE_COSTS, voiceCallCost } from '@/lib/credits/types';
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

type VoiceMode = 'shared' | 'dedicated' | 'byo';

interface VoiceConfig {
  mode: VoiceMode;
  provider: string | null;
  has_api_key: boolean;
  agent_ref: string | null;
  phone_number: string | null;
  webhook_token: string;
  is_active: boolean;
  reminder_calls_enabled: boolean;
  reminder_audio_enabled: boolean;
}

const MODES: {
  value: VoiceMode;
  title: string;
  blurb: string;
}[] = [
  {
    value: 'shared',
    title: 'Shared number',
    blurb:
      'Use our voice agent and number. Nothing to set up — best for trying it out or running the occasional campaign. Calls show a ConvoReal number, so callbacks reach us, not you.',
  },
  {
    value: 'dedicated',
    title: 'Your own number',
    blurb:
      'Your agent and your number, hosted in our provider workspace. Leads see your number and callbacks reach you. You supply the agent id; we bill the minutes as credits.',
  },
  {
    value: 'byo',
    title: 'Your own provider account',
    blurb:
      'Your provider credentials, your bill, your call capacity. Best at volume or where compliance sits with you. Paste your API key below — it is encrypted and never shown again.',
  },
];

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
  const [apiKey, setApiKey] = useState('');

  const configQuery = useQuery({
    queryKey: ['voice-config'],
    queryFn: () => api<VoiceConfig | null>('/api/voice-config'),
  });
  const config = configQuery.data ?? null;
  const mode: VoiceMode = config?.mode ?? 'shared';

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
        <div className="space-y-2">
          <Label>How your calls are made</Label>
          <div className="grid gap-2">
            {MODES.map((m) => {
              const active = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  disabled={!canManage || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ mode: m.value })}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700',
                    !canManage && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <p className="text-sm font-medium text-white">{m.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{m.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        {mode === 'byo' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vac-provider">Provider</Label>
              <select
                id="vac-provider"
                value={config?.provider ?? 'sarvam'}
                disabled={!canManage || saveMutation.isPending}
                onChange={(e) =>
                  saveMutation.mutate({ provider: e.target.value })
                }
                className="w-full rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-white"
              >
                <option value="sarvam">Sarvam</option>
                <option value="custom">Custom HTTP bridge</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vac-key">
                API key{' '}
                {config?.has_api_key && (
                  <span className="text-xs text-emerald-400">— on file</span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="vac-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    config?.has_api_key ? 'Replace stored key' : 'Paste key'
                  }
                  disabled={!canManage}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canManage || !apiKey.trim()}
                  onClick={() => {
                    saveMutation.mutate({ api_key: apiKey.trim() });
                    setApiKey('');
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Encrypted at rest and never displayed again.
              </p>
            </div>
          </div>
        )}

        <div
          className={cn(
            'grid gap-4 sm:grid-cols-2',
            mode === 'shared' && 'hidden'
          )}
        >
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

        {config && mode !== 'shared' && (
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
              voice-agent call ({voiceCallCost(mode)} cr per call, refunded if
              it fails to start). Others are unaffected.
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
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-white">
              Appointment reminders as voice notes
            </p>
            <p className="text-xs text-slate-500">
              Contacts who prefer audio updates get their reminder spoken and
              sent as a WhatsApp voice note when their 24-hour window is open (
              {AI_FEATURE_COSTS.reminder_audio} cr per note, refunded if it
              never lands). Others are unaffected.
            </p>
          </div>
          <Switch
            checked={config?.reminder_audio_enabled ?? false}
            disabled={!canManage || saveMutation.isPending}
            onCheckedChange={(v) =>
              saveMutation.mutate({ reminder_audio_enabled: v })
            }
          />
        </div>

        {canManage && mode !== 'shared' && (
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
