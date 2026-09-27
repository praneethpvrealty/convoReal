'use client';

import { Copy, Globe, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import type { DenSellerPage } from './den-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface SellerPageCardProps {
  pages: DenSellerPage[];
  hasProperties: boolean;
}

export function SellerPageCard({ pages, hasProperties }: SellerPageCardProps) {
  const live = pages.filter((page) => page.url);
  const off = hasProperties ? pages.filter((page) => !page.url) : [];
  if (live.length === 0 && off.length === 0) return null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <span className="border-primary/20 bg-primary/10 flex h-8 w-8 items-center justify-center rounded-xl border">
            <Globe className="text-primary h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-black tracking-tight">
              Your public page
            </p>
            <p className="text-muted-foreground text-xs font-medium">
              One link with all your live listings. Share it anywhere.
            </p>
          </div>
        </div>
        {live.map((page) => (
          <div
            key={page.url}
            className="bg-muted/30 flex flex-col gap-2 rounded-xl border p-3"
          >
            <p className="text-sm font-semibold break-all">{page.url}</p>
            <p className="text-muted-foreground text-xs">
              Buyers who open it reach {page.agency_name || 'your agency'}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(page.url!)}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(page.share_message ?? page.url!)}`,
                    '_blank',
                    'noopener,noreferrer'
                  )
                }
              >
                <Share2 className="mr-1 h-3.5 w-3.5" /> Share on WhatsApp
              </Button>
            </div>
          </div>
        ))}
        {off.map((page) => (
          <p
            key={page.account_id}
            className="text-muted-foreground text-xs font-medium"
          >
            Ask {page.agency_name || 'your agency'} to switch on your public
            page.
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
