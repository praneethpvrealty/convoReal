'use client';

import { useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface VisitorCapturePromptProps {
  title: string;
  body: string;
  submitLabel?: string;
  initialName?: string;
  initialPhone?: string;
  submitting?: boolean;
  onSubmit: (name: string, phone: string) => void;
  onDismiss?: () => void;
}

export function VisitorCapturePrompt({
  title,
  body,
  submitLabel = 'Send my number',
  initialName = '',
  initialPhone = '',
  submitting = false,
  onSubmit,
  onDismiss,
}: VisitorCapturePromptProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);

  return (
    <form
      data-visitor-capture
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || !phone.trim()) return;
        onSubmit(name.trim(), phone.trim());
      }}
      className="border-primary/25 relative space-y-3 rounded-xl border bg-slate-950/70 p-4"
    >
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Not now"
          className="absolute top-3 right-3 cursor-pointer text-slate-500 hover:text-slate-300"
        >
          <X className="size-4" />
        </button>
      )}
      <div className="flex items-start gap-2.5 pr-6">
        <div className="bg-primary/10 border-primary/25 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
          <MessageCircle className="text-primary size-4" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white">{title}</h4>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
            {body}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          required
          maxLength={120}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          className="h-9 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
        />
        <Input
          required
          type="tel"
          maxLength={30}
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="WhatsApp number"
          aria-label="WhatsApp number"
          className="h-9 border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-600"
        />
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="bg-primary hover:bg-primary-hover text-primary-foreground flex h-9 w-full items-center justify-center gap-2 text-xs font-bold"
      >
        {submitting ? (
          <div className="border-primary-foreground h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
        ) : (
          <Send className="size-3.5" />
        )}
        {submitLabel}
      </Button>
    </form>
  );
}
