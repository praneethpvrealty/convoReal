'use client';

// ============================================================
// Beta waitlist capture.
//
// Used by every dead-end state on /i/<token> and by the invite-only
// notice on /signup. An invite-only launch generates forwarded links
// by design, so the people who arrive without a usable seat are the
// warmest leads the programme produces — this is the difference
// between capturing them and showing them a wall.
//
// Posts to /api/public/engine-lead with source=beta_waitlist, so
// entries land in the same master-account sales pipeline as every
// other prospect rather than needing their own table.
// ============================================================

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WaitlistFormProps {
  /** Why this visitor couldn't use a seat — recorded on the lead note
   *  so sales can see whether they hit an expired link or a full
   *  programme. */
  inviteState: string;
  cta?: string;
}

export function WaitlistForm({ inviteState, cta }: WaitlistFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!phone.trim() || saving) return;
      setSaving(true);
      try {
        const res = await fetch('/api/public/engine-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            source: 'beta_waitlist',
            invite_state: inviteState,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(data.error || 'Could not save that — try again.');
          return;
        }
        setDone(true);
      } catch {
        toast.error('Could not save that — check your connection.');
      } finally {
        setSaving(false);
      }
    },
    [name, phone, inviteState, saving],
  );

  if (done) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3.5 text-sm text-slate-200">
        You&apos;re on the list. We&apos;ll message you on WhatsApp the moment
        a seat opens.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          className="border-slate-700 bg-slate-950 text-white placeholder:text-slate-500"
        />
        <Input
          type="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="WhatsApp number"
          aria-label="WhatsApp number"
          className="border-slate-700 bg-slate-950 text-white placeholder:text-slate-500"
        />
      </div>
      <Button type="submit" disabled={saving} className="h-11 w-full">
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          (cta ?? 'Tell me when a seat opens')
        )}
      </Button>
    </form>
  );
}
