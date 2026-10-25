'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { CalendarPlus, Check, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  GoogleCalendarSync,
  useGoogleCalendarReturn,
} from '@/components/calendar/google-calendar-sync';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FeedStatus {
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
  url?: string;
  webcal_url?: string;
  google_url?: string;
}

const FEED_QUERY_KEY = ['calendar-feed'];

async function feedRequest(method: 'GET' | 'POST' | 'DELETE') {
  const res = await fetch('/api/calendar/feed', { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Calendar feed request failed');
  return body.data as FeedStatus;
}

export function SubscribeFeedDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<FeedStatus | null>(null);
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: FEED_QUERY_KEY,
    queryFn: () => feedRequest('GET'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => feedRequest('POST'),
    onSuccess: (data) => {
      setCreated(data);
      setCopied(false);
      queryClient.setQueryData(FEED_QUERY_KEY, data);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const turnOff = useMutation({
    mutationFn: () => feedRequest('DELETE'),
    onSuccess: (data) => {
      setCreated(null);
      queryClient.setQueryData(FEED_QUERY_KEY, data);
      toast.success('Calendar link turned off');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copyUrl = async () => {
    if (!created?.url) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const openDialog = useCallback(() => setOpen(true), []);
  useGoogleCalendarReturn(openDialog);
  const busy = create.isPending || turnOff.isPending;
  const enabled = status.data?.enabled ?? false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreated(null);
      }}
    >
      <button
        onClick={() => setOpen(true)}
        className="hover:bg-slate-850 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Sync</span>
      </button>
      <DialogContent className="max-w-lg rounded-2xl border-slate-800 bg-slate-900/95 p-6 text-white">
        <DialogHeader>
          <DialogTitle>Your calendar in Google, Apple or Outlook</DialogTitle>
          <DialogDescription>
            Subscribe with a private link, or sync straight into Google Calendar
            below. Your appointments and dated open to-dos appear in your own
            calendar app. Anyone with the link can see them, including contact
            names and phone numbers, so keep it private.
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : created?.url ? (
          <div className="space-y-3">
            <p className="text-xs text-amber-300">
              Copy this link now. It is shown only once; reset it to get a new
              one.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={created.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
              />
              <Button variant="outline" size="sm" onClick={copyUrl}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={created.google_url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                Add to Google Calendar
              </a>
              <a
                href={created.webcal_url}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Open in Apple or Outlook
              </a>
            </div>
          </div>
        ) : enabled ? (
          <p className="text-sm text-slate-300">
            Your calendar link is on
            {status.data?.last_used_at
              ? `, last fetched ${formatDistanceToNow(new Date(status.data.last_used_at), { addSuffix: true })}.`
              : ' and has not been fetched yet.'}{' '}
            Reset it to get a new link; the old one stops working at once.
          </p>
        ) : (
          <p className="text-sm text-slate-300">
            Create a private link, then add it to your calendar app as a
            subscribed calendar.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {enabled && (
            <Button
              variant="outline"
              onClick={() => turnOff.mutate()}
              disabled={busy}
            >
              Turn off
            </Button>
          )}
          <Button onClick={() => create.mutate()} disabled={busy}>
            {create.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {enabled ? 'Reset link' : 'Create link'}
          </Button>
        </div>
        <GoogleCalendarSync enabled={open} />
      </DialogContent>
    </Dialog>
  );
}
