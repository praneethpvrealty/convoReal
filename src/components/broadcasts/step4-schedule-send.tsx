'use client';

import { useState } from 'react';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, RefreshCw } from 'lucide-react';
import {
  useAudienceCount,
  type AudienceConfig,
} from '@/hooks/useBroadcastSending';

function contactsLabel(count: number): string {
  return `${count.toLocaleString()} contact${count === 1 ? '' : 's'}`;
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const countQuery = useAudienceCount(audience);
  const reach = countQuery.data;
  const confirmedReach =
    reach !== undefined &&
    reach > 0 &&
    !countQuery.isFetching &&
    !countQuery.isError
      ? reach
      : null;

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'csv'
          ? `CSV Upload (${audience.csvContacts?.length ?? 0} numbers)`
          : audience.type === 'custom_field'
            ? 'Custom Field'
            : `Selected contacts (${audience.contactIds?.length ?? 0})`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Review & Send</h2>
        <p className="mt-1 text-sm text-slate-400">
          Name your broadcast, review the details, and send.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-white">
          Broadcast Name
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Summary Card */}
      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-sm font-medium text-white">Summary</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Template</p>
            <p className="text-white">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Audience</p>
            <p className="text-white">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Recipients</p>
            <div className="flex items-center gap-1.5" aria-live="polite">
              {countQuery.isError ? (
                <>
                  <span className="text-xs text-red-400">
                    Couldn&apos;t count
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => countQuery.refetch()}
                    className="border-slate-700 text-slate-300"
                  >
                    <RefreshCw />
                    Retry
                  </Button>
                </>
              ) : reach === undefined ? (
                <Loader2 className="text-primary h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Users className="text-primary h-3.5 w-3.5" />
                  <p className="font-medium text-white">
                    {reach.toLocaleString()}
                  </p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400">Language</p>
            <p className="text-white">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <p className="text-sm font-medium text-white">
                Sending broadcast...
              </p>
            </div>
            <span className="text-primary text-xs font-medium">
              {progress}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save as Draft
            </Button>
          )}

          <Dialog
            open={showConfirm}
            onOpenChange={(open) => {
              setShowConfirm(open);
              if (open) void countQuery.refetch();
            }}
          >
            <DialogTrigger
              render={
                <Button
                  disabled={
                    !name.trim() ||
                    isProcessing ||
                    countQuery.isError ||
                    reach === 0
                  }
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                />
              }
            >
              <Send className="h-4 w-4" />
              Send Broadcast
            </DialogTrigger>
            <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white">
                  Confirm Broadcast
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  You are about to send this broadcast to{' '}
                  <span className="font-medium text-white">
                    {confirmedReach !== null
                      ? contactsLabel(confirmedReach)
                      : '…'}
                  </span>{' '}
                  using the{' '}
                  <span className="font-medium text-white">
                    {template.name}
                  </span>{' '}
                  template. This action cannot be undone.
                </DialogDescription>
                {countQuery.isError && !countQuery.isFetching && (
                  <p role="alert" className="text-sm text-red-400">
                    Couldn&apos;t recount the recipients, so sending is paused.
                    Retry to confirm the number first.
                  </p>
                )}
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-slate-700 text-slate-300"
                >
                  Cancel
                </Button>
                {countQuery.isError && !countQuery.isFetching ? (
                  <Button
                    onClick={() => countQuery.refetch()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry count
                  </Button>
                ) : (
                  <Button
                    disabled={confirmedReach === null}
                    onClick={() => {
                      setShowConfirm(false);
                      onSend();
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {confirmedReach !== null ? (
                      <Send className="h-4 w-4" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {confirmedReach !== null
                      ? `Send to ${contactsLabel(confirmedReach)}`
                      : 'Counting recipients…'}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
