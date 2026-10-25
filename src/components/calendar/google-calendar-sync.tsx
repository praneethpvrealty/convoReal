'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  GOOGLE_CALENDAR_ERROR_MESSAGES,
  googleCalendarErrorMessage,
} from '@/lib/google-calendar/messages';

interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  google_email: string | null;
  status: 'connected' | 'token_expired' | 'error' | null;
  last_error: string | null;
  last_synced_at: string | null;
}

const GOOGLE_QUERY_KEY = ['google-calendar'];

async function googleRequest(method: 'GET' | 'POST' | 'DELETE') {
  const res = await fetch('/api/google-calendar', { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Google Calendar request failed');
  return body.data as GoogleCalendarStatus;
}

export function useGoogleCalendarReturn(onResult: () => void) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const connected = searchParams.get('google_calendar');
    const error = searchParams.get('google_calendar_error');
    if (!connected && !error) return;
    handled.current = true;
    if (connected === 'connected') {
      toast.success('Google Calendar connected');
    } else if (error) {
      toast.error(googleCalendarErrorMessage(error));
    }
    queryClient.invalidateQueries({ queryKey: GOOGLE_QUERY_KEY });
    onResult();
    const next = new URLSearchParams(searchParams.toString());
    next.delete('google_calendar');
    next.delete('google_calendar_error');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, queryClient, onResult, router, pathname]);
}

interface GoogleCalendarSyncProps {
  enabled: boolean;
}

export function GoogleCalendarSync({ enabled }: GoogleCalendarSyncProps) {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: GOOGLE_QUERY_KEY,
    queryFn: () => googleRequest('GET'),
    enabled,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/google-calendar/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: 'web' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || 'Could not start Google sign-in');
      return body.data.url as string;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const syncNow = useMutation({
    mutationFn: () => googleRequest('POST'),
    onSuccess: (data) => {
      queryClient.setQueryData(GOOGLE_QUERY_KEY, data);
      if (data.status === 'connected')
        toast.success('Synced with Google Calendar');
      else toast.error(data.last_error || 'Sync failed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnect = useMutation({
    mutationFn: () => googleRequest('DELETE'),
    onSuccess: (data) => {
      queryClient.setQueryData(GOOGLE_QUERY_KEY, data);
      toast.success('Google Calendar disconnected');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const data = status.data;
  const busy = connect.isPending || syncNow.isPending || disconnect.isPending;

  return (
    <div className="space-y-3 border-t border-slate-800 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Sync to Google Calendar
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Adds a ConvoReal calendar to your Google account and keeps it up to
          date every 15 minutes. ConvoReal can only see and change that one
          calendar.
        </p>
      </div>

      {status.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : !data?.configured ? (
        <p className="text-xs text-slate-400">
          {GOOGLE_CALENDAR_ERROR_MESSAGES.not_configured}
        </p>
      ) : data.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Connected{data.google_email ? ` as ${data.google_email}` : ''}
            {data.last_synced_at
              ? `, last synced ${formatDistanceToNow(new Date(data.last_synced_at), { addSuffix: true })}.`
              : '.'}
          </p>
          {data.status !== 'connected' && data.last_error && (
            <p className="text-xs text-amber-300">{data.last_error}</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => disconnect.mutate()}
              disabled={busy}
            >
              Disconnect
            </Button>
            {data.status === 'token_expired' ? (
              <Button onClick={() => connect.mutate()} disabled={busy}>
                Reconnect
              </Button>
            ) : (
              <Button onClick={() => syncNow.mutate()} disabled={busy}>
                {syncNow.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Sync now
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => connect.mutate()} disabled={busy}>
            {connect.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Connect Google Calendar
          </Button>
        </div>
      )}
    </div>
  );
}
