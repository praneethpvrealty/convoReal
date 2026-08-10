'use client';

// ============================================================
// "Help & feedback" — floating pill on every dashboard route, plus
// Ctrl/Cmd+Shift+B. Named for help, not just defects: it is the only
// always-visible support channel, and copy elsewhere points users at
// it for questions ("this isn't enabled for my account") as much as
// for breakage. The severity list has always carried "Idea / request".
//
// Two fields: what happened, and how bad. page_url, build_id and
// user_agent ride along silently. That's deliberate — four fields
// halves the submission rate, and a beta that produces 100 accounts
// and 4 bug reports produced 100 signups, not 100 testers.
//
// The reference shown on success matters as much as the capture. A
// tester who files three reports into silence stops at three.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  BUG_SEVERITIES,
  SEVERITY_LABEL,
  type BugSeverity,
} from '@/lib/beta/bug-reports';
import { cn } from '@/lib/utils';

export function BugReportSheet() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('minor');
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = useCallback(() => {
    setOpen(false);
    setBody('');
    setSeverity('minor');
    setReference(null);
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!body.trim() || saving) return;
      setSaving(true);
      try {
        const res = await fetch('/api/bug-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: body.trim(),
            severity,
            page_url: window.location.pathname + window.location.search,
            // Set by vercel.json's build command. Without it a report
            // can't be tied to a deploy, which is most of its value.
            build_id: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
          }),
        });
        const data = (await res.json()) as { reference?: string; error?: string };
        if (!res.ok) {
          toast.error(data.error || 'Could not send that — try again.');
          return;
        }
        setReference(data.reference ?? null);
      } catch {
        toast.error('Could not send that — check your connection.');
      } finally {
        setSaving(false);
      }
    },
    [body, severity, saving],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Help & feedback (Ctrl+Shift+B)"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs font-medium text-slate-300 shadow-lg backdrop-blur transition-colors hover:border-slate-600 hover:text-white"
      >
        <LifeBuoy className="size-3.5" />
        Help &amp; feedback
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <LifeBuoy className="size-4 text-primary" />
          {reference ? 'Thanks — logged' : 'Help & feedback'}
        </h2>
        <button
          type="button"
          onClick={reset}
          aria-label="Close"
          className="text-slate-500 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {reference ? (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-3">
            <Check className="size-4 shrink-0 text-primary" />
            <p className="text-sm text-slate-200">
              Filed as{' '}
              <b className="font-mono text-white">{reference}</b>. Quote that
              if you need to chase it.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            We captured the page you were on and the exact build, so you
            don&apos;t have to describe either.
          </p>
          <Button variant="outline" onClick={reset} className="border-slate-700">
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bug-body" className="text-xs font-medium text-slate-400">
              What do you need help with?
            </label>
            <textarea
              id="bug-body"
              autoFocus
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ask a question, or tell us what went wrong."
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">
              How urgent is it?
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {BUG_SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  aria-pressed={severity === s}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-xs transition-colors',
                    severity === s
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-700 text-slate-400 hover:text-white',
                  )}
                >
                  {SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={saving || !body.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Send'}
          </Button>
        </form>
      )}
    </div>
  );
}
