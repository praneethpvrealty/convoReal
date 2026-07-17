'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { replaceUrl } from "@/lib/navigation";
import { toast } from 'sonner';
import { Megaphone, CheckCircle2, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { usePlan } from '@/hooks/usePlan';

interface ConfigResponse {
  connected: boolean;
  status?: 'connected' | 'token_expired' | 'disconnected';
  adAccountId?: string | null;
  pageId?: string | null;
  igAccountId?: string | null;
  currency?: string | null;
  connectedAt?: string | null;
  needsAssetSelection?: boolean;
  reason?: string;
}

interface AdAccountOption {
  id: string;
  name: string;
  currency: string;
}
interface PageOption {
  id: string;
  name: string;
  instagramAccountId: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  consent_denied: 'You declined the Meta permission request — nothing was connected.',
  state_expired: 'That connection attempt timed out. Please try again.',
  state_bad_signature: 'That connection link was invalid. Please try again.',
  state_malformed: 'That connection link was invalid. Please try again.',
  account_mismatch: 'Please connect from the same account you started with.',
  invalid_request: 'Something went wrong starting the connection. Please try again.',
  connection_failed: 'Could not complete the Meta connection. Please try again.',
};

export function MetaAdsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { plan, isLoading: planLoading } = usePlan();

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [assetOptions, setAssetOptions] = useState<{ adAccounts: AdAccountOption[]; pages: PageOption[] } | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [selectedAdAccount, setSelectedAdAccount] = useState('');
  const [selectedPage, setSelectedPage] = useState('');
  const [savingSelection, setSavingSelection] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/config');
      const data = (await res.json()) as ConfigResponse;
      setConfig(data);
    } catch {
      setConfig({ connected: false, reason: 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // One-time toast for the OAuth callback's redirect params, then
  // strip them from the URL so a refresh doesn't re-toast.
  useEffect(() => {
    const connected = searchParams.get('meta_ads_connected');
    const error = searchParams.get('meta_ads_error');
    if (!connected && !error) return;

    if (connected) toast.success('Meta account connected.');
    if (error) toast.error(ERROR_MESSAGES[error] || 'Could not connect your Meta account.');

    const params = new URLSearchParams(searchParams.toString());
    params.delete('meta_ads_connected');
    params.delete('meta_ads_error');
    replaceUrl(router, `/settings?${params.toString()}`);
  }, [searchParams, router]);

  const loadAssetOptions = useCallback(async () => {
    setAssetsLoading(true);
    try {
      const res = await fetch('/api/meta-ads/config/select');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load your Meta ad accounts.');
        return;
      }
      setAssetOptions(data);
    } catch {
      toast.error('Could not load your Meta ad accounts.');
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (config?.needsAssetSelection) void loadAssetOptions();
  }, [config?.needsAssetSelection, loadAssetOptions]);

  async function handleConnect() {
    setConnecting(true);
    window.location.href = '/api/meta-ads/oauth/start';
  }

  async function handleSaveSelection() {
    if (!selectedAdAccount || !selectedPage) return;
    setSavingSelection(true);
    try {
      const res = await fetch('/api/meta-ads/config/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: selectedAdAccount, page_id: selectedPage }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save your selection.');
        return;
      }
      toast.success('Ad account connected.');
      await loadConfig();
    } catch {
      toast.error('Could not save your selection.');
    } finally {
      setSavingSelection(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/meta-ads/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Could not disconnect.');
        return;
      }
      toast.success('Meta account disconnected.');
      setConfirmDisconnect(false);
      await loadConfig();
    } catch {
      toast.error('Could not disconnect.');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading || planLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (plan === 'starter') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Meta Ads
          </CardTitle>
          <CardDescription>
            Promote your properties on Instagram &amp; Facebook — buyers land directly in your WhatsApp inbox,
            and every lead is auto-attributed back to the ad that produced it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Megaphone className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Meta Ads is available on Solo Pro and above.{' '}
              <a href="/settings?tab=billing" className="underline font-medium">Upgrade your plan</a> to connect
              your Meta account.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Meta Ads
          </CardTitle>
          <CardDescription>
            Run Instagram &amp; Facebook &ldquo;Click to WhatsApp&rdquo; ads for your properties. Buyers who tap
            your ad message you directly on WhatsApp — leads land in your inbox automatically, tagged with the
            ad that brought them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!config?.connected && (
            <>
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Megaphone className="h-4 w-4 mr-2" />}
                Connect Meta account
              </Button>
              <p className="text-xs text-muted-foreground">
                Ad spend is billed by Meta directly to your own card. ConvoReal never charges for ad delivery.
              </p>
            </>
          )}

          {config?.status === 'token_expired' && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm flex items-center justify-between gap-4">
                <span>Your Meta connection expired. Reconnect to keep running ads.</span>
                <Button size="sm" onClick={handleConnect} disabled={connecting}>
                  Reconnect
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {config?.connected && config.needsAssetSelection && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose which ad account and Facebook Page to run property ads from.
              </p>
              {assetsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your ad accounts…
                </div>
              ) : assetOptions ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Ad account</label>
                    <select
                      value={selectedAdAccount}
                      onChange={(e) => setSelectedAdAccount(e.target.value)}
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">Select an ad account…</option>
                      {assetOptions.adAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Facebook Page</label>
                    <select
                      value={selectedPage}
                      onChange={(e) => setSelectedPage(e.target.value)}
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">Select a Page…</option>
                      {assetOptions.pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.instagramAccountId ? ' · Instagram connected' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Button
                      size="sm"
                      onClick={handleSaveSelection}
                      disabled={savingSelection || !selectedAdAccount || !selectedPage}
                    >
                      {savingSelection && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No ad accounts or Pages found for this Meta login. Create one in{' '}
                  <a
                    href="https://business.facebook.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-0.5"
                  >
                    Meta Business Suite <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  and reconnect.
                </p>
              )}
            </div>
          )}

          {config?.connected && !config.needsAssetSelection && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">Connected</span>
                  {config.currency && <Badge variant="secondary">{config.currency}</Badge>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ad account: <span className="font-mono">{config.adAccountId}</span>
              </p>
              <p className="text-xs text-muted-foreground">Page: <span className="font-mono">{config.pageId}</span></p>
              {config.connectedAt && (
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(config.connectedAt).toLocaleDateString('en-IN')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Meta account?</DialogTitle>
            <DialogDescription>
              Any campaigns you&apos;ve created will keep running in Meta Ads Manager, but you won&apos;t be able
              to manage them from ConvoReal until you reconnect. Past leads and attribution history are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
