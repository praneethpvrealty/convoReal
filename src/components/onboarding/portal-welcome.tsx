'use client';

// First-run welcome for the consumer Portfolio portals (owner + buyer).
// Owners and buyers arrive here from a WhatsApp link with zero context,
// so the first thing they see explains what this place is in 3–4
// swipeable cards. Shown once per portal user (localStorage), and the
// first card carries a media slot that upgrades to a walkthrough video
// via the onboarding media registry.

import { useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StepMedia } from '@/components/onboarding/step-media';
import type { OnboardingMediaSlug } from '@/lib/onboarding/media';
import { readStored, writeStored } from '@/lib/safe-storage';

export interface PortalWelcomeStep {
  icon: React.ReactNode;
  title: string;
  body: string;
}

interface PortalWelcomeProps {
  /** Unique per portal user, e.g. `den_welcome_seen_<den_user_id>`. */
  storageKey: string;
  mediaSlug: OnboardingMediaSlug;
  steps: PortalWelcomeStep[];
  doneLabel: string;
}

export function PortalWelcome({
  storageKey,
  mediaSlug,
  steps,
  doneLabel,
}: PortalWelcomeProps) {
  // Lazy init is safe here: the portal shells render a loading screen
  // until their client-side session fetch resolves, so this component
  // never takes part in SSR/hydration.
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return readStored(storageKey) !== 'true';
    } catch {
      // Storage unavailable (private mode) — skip rather than nag every visit.
      return false;
    }
  });
  const [idx, setIdx] = useState(0);

  function dismiss() {
    try {
      writeStored(storageKey, 'true');
    } catch {
      // Best effort.
    }
    setOpen(false);
  }

  if (!open || steps.length === 0) return null;

  const step = steps[idx];
  const last = idx === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="bg-background relative w-full max-w-md rounded-2xl border p-6 shadow-2xl">
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-3 right-3 rounded-lg p-1.5 transition-colors"
          aria-label="Close welcome"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center gap-4 pt-2 text-center">
          <div className="bg-primary/10 border-primary/20 flex h-14 w-14 items-center justify-center rounded-2xl border">
            {step.icon}
          </div>
          <div>
            <h2 className="text-foreground text-lg font-bold">{step.title}</h2>
            <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm leading-relaxed">
              {step.body}
            </p>
          </div>

          {idx === 0 && (
            <StepMedia slug={mediaSlug} title={step.title} className="w-full" />
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          {idx > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground gap-1"
              onClick={() => setIdx(idx - 1)}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={dismiss}
            >
              Skip
            </Button>
          )}

          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? 'bg-primary w-4' : 'bg-muted w-1.5'
                }`}
              />
            ))}
          </div>

          <Button
            size="sm"
            className="gap-1"
            onClick={() => (last ? dismiss() : setIdx(idx + 1))}
          >
            {last ? doneLabel : 'Next'}
            {!last && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
