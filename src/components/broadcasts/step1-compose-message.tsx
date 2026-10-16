'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, Loader2, MessageCircle } from 'lucide-react';
import {
  BROADCAST_MESSAGE_MAX,
  broadcastMessageProblem,
  broadcastTemplateBlockReason,
  previewBroadcastUpdate,
  type BroadcastTemplateState,
} from '@/lib/broadcasts/carrier-template';

interface Step1Props {
  message: string;
  onChange: (message: string) => void;
  template: BroadcastTemplateState | undefined;
  templateLoading: boolean;
  templateError: string | null;
  onRetryTemplate: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ComposeMessage({
  message,
  onChange,
  template,
  templateLoading,
  templateError,
  onRetryTemplate,
  onNext,
  onBack,
}: Step1Props) {
  const [sampleName, setSampleName] = useState<string | null>(null);

  // A real contact in the preview, so the agent sees what a recipient
  // sees rather than a placeholder.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('name')
        .not('name', 'is', null)
        .limit(1)
        .maybeSingle();
      if (!cancelled) setSampleName(data?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const problem = broadcastMessageProblem(message);
  const blocked = broadcastTemplateBlockReason(template ?? null);
  const preview = previewBroadcastUpdate({
    bodyText: template?.bodyText,
    message,
    agencyName: template?.agencyName ?? '',
    contactName: sampleName,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">
          What do you want to say?
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Write it once. Every recipient is greeted by name and the message goes
          out from {template?.agencyName || 'your agency'} on WhatsApp.
        </p>
      </div>

      <div className="space-y-1.5">
        <Textarea
          value={message}
          onChange={(e) =>
            onChange(e.target.value.slice(0, BROADCAST_MESSAGE_MAX))
          }
          rows={5}
          placeholder="e.g. Site visits at Lakeview Residences are open this Saturday and Sunday, 10 am to 5 pm. Reply to book a slot."
          aria-label="Broadcast message"
          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
        />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Sent as one paragraph.</span>
          <span>
            {message.length}/{BROADCAST_MESSAGE_MAX}
          </span>
        </div>
      </div>

      {templateLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking WhatsApp setup…
        </div>
      ) : templateError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <span>{templateError}</span>
          <Button
            size="xs"
            variant="outline"
            onClick={onRetryTemplate}
            className="border-amber-500/40 text-amber-200"
          >
            Retry
          </Button>
        </div>
      ) : blocked ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300"
        >
          {blocked}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageCircle className="text-primary h-4 w-4" />
          <p className="text-sm font-medium text-white">Preview</p>
          <span className="text-xs text-slate-500">
            {sampleName ? `as ${sampleName} sees it` : 'sample recipient'}
          </span>
        </div>
        <div className="max-w-md rounded-2xl rounded-tl-sm border border-slate-700 bg-slate-800 px-4 py-3">
          <p className="text-sm whitespace-pre-wrap text-slate-100">
            {preview}
          </p>
          {template?.footerText && (
            <p className="mt-2 text-xs text-slate-400">{template.footerText}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-700 text-slate-300"
        >
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={problem !== null || blocked !== null || !template}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
