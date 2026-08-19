'use client';

import { useState } from 'react';
import { FilePlus2, Loader2, Radar } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ContactRequirementProfile } from '@/types';

interface AdditionalRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  existingCount?: number;
  onSaved?: (profile: ContactRequirementProfile) => void;
}

interface SaveResult {
  data: {
    profile: ContactRequirementProfile;
    duplicate: boolean;
    match_count: number;
    alerts_active: boolean;
  };
}

export function AdditionalRequirementDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  existingCount = 0,
  onSaved,
}: AdditionalRequirementDialogProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const name = contactName.trim() || 'this buyer';

  function close() {
    if (saving) return;
    setText('');
    onOpenChange(false);
  }

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: 'personal_whatsapp' }),
      });
      const body = (await response.json().catch(() => ({}))) as
        | SaveResult
        | { error?: string };
      if (!response.ok || !('data' in body)) {
        throw new Error(
          ('error' in body && body.error) || 'Could not save the requirement'
        );
      }

      const {
        profile,
        duplicate,
        match_count: matchCount,
        alerts_active: alertsActive,
      } = body.data;
      const matchText =
        matchCount > 0
          ? `${matchCount} current match${matchCount === 1 ? '' : 'es'} found.`
          : 'No current match; Match Radar will keep watching.';
      const deliveryText = alertsActive
        ? ' Future matches will be sent from the connected business WhatsApp.'
        : ' Future matches stay in Match Radar until WhatsApp alerts are enabled.';
      toast.success(
        `${duplicate ? 'Requirement already saved.' : 'Additional requirement saved.'} ${matchText}${deliveryText}`
      );
      onSaved?.(profile);
      setText('');
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save the requirement'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <FilePlus2 className="text-primary size-5" />
            Add a brief
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Paste what {name} sent on your personal WhatsApp. ConvoReal saves it
            as a separate brief, so it will not overwrite existing searches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="border-primary/20 bg-primary/5 flex items-start gap-2 rounded-xl border p-3 text-xs text-slate-300">
            <Radar className="text-primary mt-0.5 size-4 shrink-0" />
            <p>
              AI extracts area, property type, size and budget, checks current
              inventory, and keeps this brief active for future Match Radar and
              WhatsApp alerts.
              {existingCount > 0
                ? ` ${existingCount} additional brief${existingCount === 1 ? ' is' : 's are'} already saved.`
                : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="additional-requirement"
              className="text-xs text-slate-300"
            >
              Requirement message
            </Label>
            <Textarea
              id="additional-requirement"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="For Dabaspete, 2–3 acres, for cold storage / warehouse on or close to STRR"
              className="min-h-32 border-slate-700 bg-slate-950/60 text-white placeholder:text-slate-600"
              maxLength={4000}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!text.trim() || saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FilePlus2 className="size-4" />
            )}
            {saving ? 'Reading and matching…' : 'Save to Engine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
