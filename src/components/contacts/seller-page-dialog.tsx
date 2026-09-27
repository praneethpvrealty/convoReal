'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  PowerOff,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SellerPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
}

interface SellerPageStatus {
  enabled: boolean;
  url: string | null;
  listing_count: number;
  owns_listings: boolean;
  share_message: string | null;
}

type SellerPageAction = 'enable' | 'rotate' | 'disable';

async function readStatus(response: Response): Promise<SellerPageStatus> {
  const body = (await response.json().catch(() => ({}))) as {
    data?: SellerPageStatus;
    error?: string;
  };
  if (!response.ok || !body.data) {
    throw new Error(body.error || 'Could not load the seller page');
  }
  return body.data;
}

export function SellerPageDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
}: SellerPageDialogProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<SellerPageAction | null>(null);
  const path = `/api/contacts/${contactId}/seller-page`;
  const queryKey = ['seller-page', contactId];
  const status = useQuery({
    queryKey,
    enabled: open,
    queryFn: async () => readStatus(await fetch(path)),
  });
  const name = contactName.trim() || contactPhone || 'this seller';
  const data = status.data;

  async function run(action: SellerPageAction) {
    if (pending) return;
    if (
      action === 'rotate' &&
      !window.confirm(
        'Create a new link? The current link stops working immediately.'
      )
    ) {
      return;
    }
    setPending(action);
    try {
      const response = await fetch(path, {
        method: action === 'disable' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:
          action === 'disable'
            ? undefined
            : JSON.stringify({ rotate: action === 'rotate' }),
      });
      queryClient.setQueryData(queryKey, await readStatus(response));
      toast.success(
        action === 'disable'
          ? 'Seller page turned off'
          : action === 'rotate'
            ? 'New seller page link created'
            : 'Seller page is live'
      );
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : 'Could not update the page'
      );
    } finally {
      setPending(null);
    }
  }

  async function copyLink() {
    if (!data?.url) return;
    try {
      await navigator.clipboard.writeText(data.url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  function sendOnWhatsApp() {
    const digits = contactPhone?.replace(/\D/g, '') ?? '';
    if (!digits || !data?.share_message) return;
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(data.share_message)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  const listingsLine = data
    ? data.listing_count === 1
      ? '1 live listing is on the page.'
      : `${data.listing_count} live listings are on the page.`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Globe className="text-primary size-5" />
            Seller page
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            A link {name} can share that shows only their live listings on your
            showcase. Every call and WhatsApp enquiry on it comes to you.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          {status.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : status.error ? (
            <p className="text-sm text-red-300">
              {status.error instanceof Error
                ? status.error.message
                : 'Could not load the seller page'}
            </p>
          ) : data?.enabled && data.url ? (
            <div className="space-y-3">
              <p className="text-sm font-medium break-all text-white">
                {data.url}
              </p>
              <p className="text-xs text-slate-400">{listingsLine}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={copyLink}>
                  <Copy className="size-4" />
                  Copy link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(data.url!, '_blank', 'noopener')}
                >
                  <ExternalLink className="size-4" />
                  Open
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-400">
              {data?.owns_listings
                ? `Off. ${listingsLine} Turn it on to create a private link.`
                : `${name} has no listings as owner yet. You can still turn the page on; it shows listings as soon as they are published.`}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-slate-800 bg-slate-900 sm:justify-between">
          {data?.enabled ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run('rotate')}
                  disabled={Boolean(pending)}
                >
                  {pending === 'rotate' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  New link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run('disable')}
                  disabled={Boolean(pending)}
                >
                  {pending === 'disable' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PowerOff className="size-4" />
                  )}
                  Turn off
                </Button>
              </div>
              <Button
                onClick={sendOnWhatsApp}
                disabled={!contactPhone || !data.share_message}
              >
                <ExternalLink className="size-4" />
                Send on WhatsApp
              </Button>
            </>
          ) : (
            <Button
              onClick={() => run('enable')}
              disabled={Boolean(pending) || status.isLoading || !data}
            >
              {pending === 'enable' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Globe className="size-4" />
              )}
              Turn on
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
