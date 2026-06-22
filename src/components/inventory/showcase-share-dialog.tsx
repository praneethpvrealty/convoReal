'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Share2, Copy, Check, ExternalLink } from 'lucide-react';
import type { ShowcaseSettings } from '@/types';

interface ShowcaseShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  showcaseSettings: ShowcaseSettings | null;
}

function getBaseHost() {
  if (typeof window === 'undefined') return '';
  const host = window.location.host;
  const parts = host.split('.');
  
  // If it's localhost or IP address or simple domain
  if (parts.length <= 2 || host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return host;
  }
  
  // Strip first part if there are 3 parts (e.g. app.convoreal.com -> convoreal.com)
  return parts.slice(1).join('.');
}

export function ShowcaseShareDialog({
  open,
  onOpenChange,
  accountId,
  showcaseSettings,
}: ShowcaseShareDialogProps) {
  const [shareCategory, setShareCategory] = useState<'All' | 'Residential' | 'Commercial' | 'Agricultural'>('All');
  const [copied, setCopied] = useState(false);

  const generatedLink = useMemo(() => {
    if (typeof window === 'undefined') return '';

    let targetDomain = window.location.host;
    let isSubdomainUsed = false;

    if (showcaseSettings?.subdomain) {
      const baseDomain = getBaseHost();
      targetDomain = `${showcaseSettings.subdomain}.${baseDomain}`;
      isSubdomainUsed = true;
    }

    const protocol = window.location.protocol;
    const urlObj = new URL(`${protocol}//${targetDomain}`);

    // If no subdomain is configured, we must append the ref parameter so page.tsx can resolve the account showcase page
    if (!isSubdomainUsed && accountId) {
      urlObj.searchParams.set('ref', accountId);
    }

    // Add category filter if selected (and not 'All')
    if (shareCategory !== 'All') {
      urlObj.searchParams.set('category', shareCategory);
    }

    return urlObj.toString();
  }, [accountId, shareCategory, showcaseSettings]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success('Showcase link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
      console.error(err);
    }
  };

  const handleViewShowcase = () => {
    window.open(generatedLink, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-800 pb-3 mb-2">
          <DialogTitle className="text-white flex items-center gap-2 text-lg font-black tracking-tight">
            <Share2 className="size-5 text-primary" />
            Share Showcase Portal
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Generate and copy the public URL to share your listings with clients.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Category Filter Options */}
          <div className="space-y-2">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider">
              Filter by Category
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['All', 'Residential', 'Commercial', 'Agricultural'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setShareCategory(cat)}
                  className={`text-xs px-2.5 py-2 rounded-lg border transition-all cursor-pointer font-semibold text-center select-none ${
                    shareCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary font-bold shadow-md shadow-primary/20'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {cat === 'All' ? 'All Properties' : cat}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 font-medium">
              Selecting a category will automatically apply the filter when the customer opens the link.
            </p>
          </div>

          {/* Generated Link Input */}
          <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
            <Label className="text-slate-350 text-xs font-bold uppercase tracking-wider block">
              🔗 Showcase Portal URL
            </Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={generatedLink}
                className="bg-slate-900 border-slate-800 text-xs h-9 text-slate-200 select-all font-mono"
              />
              <Button
                onClick={handleCopyLink}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 px-3 shrink-0 flex items-center gap-1"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="outline"
                onClick={handleViewShowcase}
                className="border-slate-800 hover:bg-slate-800 text-slate-350 text-xs h-9 px-3 shrink-0 flex items-center gap-1"
              >
                <ExternalLink className="size-3.5" />
                View
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3.5 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-800 hover:bg-slate-850 text-xs text-slate-300 h-9"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
