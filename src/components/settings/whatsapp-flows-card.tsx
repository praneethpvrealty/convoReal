'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Copy,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

/**
 * Settings card for native Meta WhatsApp Flows (form screens inside
 * WhatsApp) — currently the Buyer Preference Intake flow. One click
 * generates/registers the encryption keys, uploads the Flow JSON to
 * Meta, and publishes it (POST /api/whatsapp/flows/setup, idempotent —
 * the same button re-syncs after an update).
 */

interface MetaFlowStatus {
  flow: {
    meta_flow_id: string | null;
    status: 'draft' | 'published' | 'deprecated' | 'error';
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
  is_published: boolean;
  endpoint_uri: string;
}

interface FlowValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line_start?: number }>;
}

export function WhatsAppFlowsCard() {
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [status, setStatus] = useState<MetaFlowStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/flows/setup', { method: 'GET' });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Non-fatal — the card just shows the "not set up" state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await fetch('/api/whatsapp/flows/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to publish the preference flow');
      } else {
        toast.success('Preference flow published to WhatsApp');
      }
    } catch {
      toast.error('Failed to publish the preference flow');
    } finally {
      setPublishing(false);
      await loadStatus();
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch('/api/whatsapp/flows/validate', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error || 'Failed to validate the flow JSON against Meta'
        );
        return;
      }
      const result = data as FlowValidationResult;
      if (result.valid) {
        toast.success('Meta accepted the flow JSON — no validation errors');
      } else {
        toast.error(
          `Meta rejected the flow JSON: ${result.errors.map((e) => e.message).join('; ')}`
        );
      }
    } catch {
      toast.error('Failed to validate the flow JSON against Meta');
    } finally {
      setValidating(false);
    }
  };

  const handleCopyEndpoint = () => {
    if (!status?.endpoint_uri) return;
    navigator.clipboard.writeText(status.endpoint_uri);
    toast.success('Endpoint URL copied');
  };

  const flow = status?.flow;
  const statusBadge = !flow ? (
    <Badge variant="outline" className="border-slate-600 text-slate-400">
      Not set up
    </Badge>
  ) : flow.status === 'published' ? (
    <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
      Published
    </Badge>
  ) : flow.status === 'error' ? (
    <Badge className="border border-red-500/30 bg-red-500/15 text-red-400">
      Error
    </Badge>
  ) : (
    <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-400">
      {flow.status === 'draft' ? 'Draft' : 'Deprecated'}
    </Badge>
  );

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="text-primary size-4" />
            <CardTitle className="text-white">WhatsApp Flows</CardTitle>
          </div>
          {!loading && statusBadge}
        </div>
        <CardDescription className="text-slate-400">
          Native in-chat forms. The Buyer Preference Intake flow lets buyers
          fill or update their budget, localities, property types and expected
          ROI inside WhatsApp — replies save straight onto the contact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" /> Loading flow status...
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm leading-relaxed text-slate-300">
              <p className="mb-1">
                Publishing creates the flow on your WhatsApp Business Account,
                registers the encryption keys, and uploads the form. Afterwards,
                buyers can text{' '}
                <span className="font-medium text-white">
                  &quot;update my preferences&quot;
                </span>{' '}
                to receive it.
              </p>
              <p className="text-xs text-slate-400">
                Requires the Official Meta Cloud API integration with a WABA ID.
                Re-run after app updates to sync the latest form to Meta.
              </p>
            </div>

            {flow?.status === 'error' && flow.last_error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                {flow.last_error}
              </div>
            )}

            {flow?.meta_flow_id && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <span>
                  Meta Flow ID:{' '}
                  <span className="font-mono text-slate-300">
                    {flow.meta_flow_id}
                  </span>
                </span>
                {flow.last_synced_at && (
                  <span>
                    Last synced:{' '}
                    <span className="text-slate-300">
                      {new Date(flow.last_synced_at).toLocaleString()}
                    </span>
                  </span>
                )}
              </div>
            )}

            {status?.endpoint_uri && (
              <div className="space-y-2">
                <Label className="text-slate-300">Flow Data Endpoint URL</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={status.endpoint_uri}
                    className="border-slate-700 bg-slate-800 font-mono text-sm text-slate-300"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyEndpoint}
                    className="shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Registered on the flow automatically — shown here for
                  reference and debugging in the Meta App Dashboard.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleValidate}
                disabled={validating || publishing}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {validating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    Validate Against Meta
                  </>
                )}
              </Button>
              <Button
                onClick={handlePublish}
                disabled={publishing || validating}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {publishing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Publishing...
                  </>
                ) : flow?.status === 'published' ? (
                  <>
                    <RefreshCw className="size-4" />
                    Re-sync Preference Flow
                  </>
                ) : (
                  'Set Up & Publish Preference Flow'
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Validate checks the current flow JSON against Meta&apos;s real
              validator without publishing — safe to run any time, including on
              an already-live flow.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
