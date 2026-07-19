'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { replaceUrl } from '@/lib/navigation';
import { toast } from 'sonner';
import { CirclePlay, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface ConfigResponse {
  configured: boolean;
  connected: boolean;
  status?: 'connected' | 'token_expired' | 'disconnected';
  channelId?: string | null;
  channelTitle?: string | null;
  autoUpload?: boolean;
  connectedAt?: string | null;
  reason?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  consent_denied:
    'You declined the Google permission request — nothing was connected.',
  state_expired: 'That connection attempt timed out. Please try again.',
  state_bad_signature: 'That connection link was invalid. Please try again.',
  state_malformed: 'That connection link was invalid. Please try again.',
  account_mismatch: 'Please connect from the same account you started with.',
  invalid_request:
    'Something went wrong starting the connection. Please try again.',
  no_refresh_token:
    'Google did not grant offline access. Please try connecting again.',
  no_channel:
    'That Google account has no YouTube channel. Create one on YouTube and reconnect.',
  connection_failed:
    'Could not complete the YouTube connection. Please try again.',
};

export function YouTubeConnectCard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/youtube/config');
      const data = (await res.json()) as ConfigResponse;
      setConfig(data);
    } catch {
      setConfig({
        configured: false,
        connected: false,
        reason: 'fetch_failed',
      });
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
    const connected = searchParams.get('youtube_connected');
    const error = searchParams.get('youtube_error');
    if (!connected && !error) return;

    if (connected) toast.success('YouTube channel connected.');
    if (error)
      toast.error(
        ERROR_MESSAGES[error] || 'Could not connect your YouTube channel.'
      );

    const params = new URLSearchParams(searchParams.toString());
    params.delete('youtube_connected');
    params.delete('youtube_error');
    replaceUrl(router, `/settings?${params.toString()}`);
  }, [searchParams, router]);

  function handleConnect() {
    setConnecting(true);
    window.location.href = '/api/youtube/oauth/start';
  }

  async function handleToggleAutoUpload(next: boolean) {
    setSavingToggle(true);
    try {
      const res = await fetch('/api/youtube/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoUpload: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update the setting.');
        return;
      }
      setConfig((prev) =>
        prev ? { ...prev, autoUpload: data.autoUpload } : prev
      );
    } catch {
      toast.error('Could not update the setting.');
    } finally {
      setSavingToggle(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/youtube/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Could not disconnect.');
        return;
      }
      toast.success('YouTube channel disconnected.');
      setConfirmDisconnect(false);
      await loadConfig();
    } catch {
      toast.error('Could not disconnect.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
          <CirclePlay className="size-5 text-red-500" />
          YouTube Channel
        </CardTitle>
        <CardDescription className="text-slate-400">
          Auto-upload generated listing videos to your own YouTube channel as
          Unlisted — free hosting and streaming, embedded on your Showcase next
          to the photos. Unlisted videos are reachable only via the link, never
          in your channel&apos;s public feed or search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !config?.configured ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              YouTube uploads are not configured on this server. Set{' '}
              <code className="text-primary">GOOGLE_OAUTH_CLIENT_ID</code> and{' '}
              <code className="text-primary">GOOGLE_OAUTH_CLIENT_SECRET</code> —
              see{' '}
              <code className="text-primary">
                docs/youtube-integration-setup.md
              </code>
              .
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {!config.connected && config.status !== 'token_expired' && (
              <>
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CirclePlay className="mr-2 h-4 w-4" />
                  )}
                  Connect YouTube
                </Button>
                <p className="text-xs text-slate-400">
                  Videos upload to your own channel — you keep full ownership
                  and can delete them from YouTube Studio anytime.
                </p>
              </>
            )}

            {config.status === 'token_expired' && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    Your YouTube connection expired. Reconnect to keep uploading
                    videos.
                  </span>
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    disabled={connecting}
                  >
                    Reconnect
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {config.connected && (
              <div className="space-y-3 rounded-lg border border-slate-800 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium text-white">
                      {config.channelTitle || 'Connected'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    Disconnect
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-300">
                      Auto-upload new listing videos
                    </p>
                    <p className="text-xs text-slate-500">
                      Every freshly generated video is uploaded to the channel
                      automatically. You can also upload per property from the
                      listing form.
                    </p>
                  </div>
                  <Switch
                    checked={config.autoUpload ?? true}
                    onCheckedChange={handleToggleAutoUpload}
                    disabled={savingToggle}
                  />
                </div>
                {config.connectedAt && (
                  <p className="text-xs text-slate-500">
                    Connected{' '}
                    {new Date(config.connectedAt).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect YouTube channel?</DialogTitle>
            <DialogDescription>
              New listing videos will stop uploading to YouTube. Videos already
              on your channel stay there — manage or delete them from YouTube
              Studio.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDisconnect(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
