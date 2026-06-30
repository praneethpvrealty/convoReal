'use client';

import { useState } from 'react';
import {
  MessageCircle,
  Building2,
  Users,
  Check,
  X,
  ArrowRight,
  Loader2,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Forward,
  Bot,
  UserCheck,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OnboardingStatus } from '@/hooks/useOnboarding';

interface Props {
  status: OnboardingStatus;
  onDismiss: () => void;
  onRefresh: () => Promise<void>;
}

// ── Step 1: Connect WhatsApp ──────────────────────────────────────────────────

function StepWhatsApp({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
        <MessageCircle className="h-8 w-8 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Connect WhatsApp</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          ConvoReal runs through your WhatsApp Business number. Connect it once — every
          lead, listing, and follow-up flows through there.
        </p>
      </div>

      <div className="w-full bg-slate-800/60 rounded-xl border border-slate-700 p-4 text-left space-y-3">
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">You&apos;ll need</p>
        {[
          'A WhatsApp Business account',
          'Your Phone Number ID from Meta Business Manager',
          'A permanent access token',
        ].map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-slate-400">
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
            {item}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 w-full">
        <Button
          className="w-full gap-2"
          onClick={() => window.open('/settings?tab=whatsapp', '_blank')}
        >
          Open WhatsApp Settings <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-300"
          onClick={onDone}
        >
          I&apos;ll do this later
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Add first property via WhatsApp ───────────────────────────────────

function StepProperty({ onDone, onRefresh }: { onDone: () => void; onRefresh: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    // Parent re-checks status; if hasProperties is now true it will advance
    onDone();
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto w-full">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/15 flex items-center justify-center mx-auto mb-4">
          <Building2 className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Add your first property</h2>
        <p className="text-sm text-slate-400">
          The fastest way is through WhatsApp — just forward a property listing and our
          AI will parse and create it for you.
        </p>
      </div>

      {/* WhatsApp flow instructions */}
      <div className="space-y-2">
        {[
          {
            icon: <Forward className="h-4 w-4 text-blue-400" />,
            label: 'Forward any property listing',
            sub: 'Text, photos, price, location — send it all at once to your ConvoReal number',
          },
          {
            icon: <Bot className="h-4 w-4 text-violet-400" />,
            label: 'AI parses the details',
            sub: 'Extracts title, type, price, area, amenities — shows you a draft to review',
          },
          {
            icon: <Check className="h-4 w-4 text-emerald-400" />,
            label: 'Tap Confirm',
            sub: 'Property is created in your inventory with a shareable showcase link',
          },
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div className="w-8 h-8 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0">
              {step.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{step.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{step.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking} className="w-full gap-2">
          {checking
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
            : <><RefreshCw className="h-4 w-4" /> I&apos;ve sent it — check now</>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-300"
          onClick={onDone}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Get first lead via WhatsApp ───────────────────────────────────────

function StepContact({ onDone, onRefresh }: { onDone: () => void; onRefresh: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto w-full">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/15 flex items-center justify-center mx-auto mb-4">
          <Users className="h-8 w-8 text-violet-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Get your first lead</h2>
        <p className="text-sm text-slate-400">
          Leads come in automatically when buyers message your WhatsApp. You can
          also share your property showcase link to drive inquiries.
        </p>
      </div>

      {/* How leads flow in */}
      <div className="space-y-2">
        {[
          {
            icon: <MessageCircle className="h-4 w-4 text-emerald-400" />,
            label: 'Buyer messages your WhatsApp',
            sub: 'ConvoReal auto-creates their contact and opens a conversation in your inbox',
          },
          {
            icon: <Zap className="h-4 w-4 text-amber-400" />,
            label: 'Share your property showcase',
            sub: 'Every property has a public link — share it and inquiries flow in automatically',
          },
          {
            icon: <UserCheck className="h-4 w-4 text-blue-400" />,
            label: 'Or add one manually',
            sub: 'Go to Contacts → Add Contact to add a lead you already spoke to',
          },
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div className="w-8 h-8 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0">
              {step.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{step.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{step.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking} className="w-full gap-2">
          {checking
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
            : <><RefreshCw className="h-4 w-4" /> I&apos;ve got a lead — check now</>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-500 hover:text-slate-300"
          onClick={onDone}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// ── All done ─────────────────────────────────────────────────────────────────

function AllDone({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm mx-auto">
      <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <Sparkles className="h-10 w-10 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">You&apos;re all set! 🎉</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          ConvoReal is ready to go. Leads flow into your inbox, your listings are
          shareable, and everything is tracked in one place.
        </p>
      </div>
      <Button onClick={onClose} className="w-full gap-2">
        Go to Dashboard <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

interface StepDef {
  id: string;
  label: string;
  done: boolean;
}

function StepIndicator({ steps, current }: { steps: StepDef[]; current: number }) {
  return (
    <div className="flex items-center gap-1 mb-8 flex-wrap">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              step.done
                ? 'bg-emerald-500/20 text-emerald-400'
                : i === current
                ? 'bg-primary/20 text-primary'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {step.done ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="w-3 h-3 rounded-full border border-current flex items-center justify-center text-[9px]">
                {i + 1}
              </span>
            )}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-4 ${i < current || step.done ? 'bg-primary/40' : 'bg-slate-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function OnboardingWizard({ status, onDismiss, onRefresh }: Props) {
  function firstIncompleteStep() {
    if (!status.hasWhatsApp) return 0;
    if (!status.hasProperties) return 1;
    if (!status.hasContacts) return 2;
    return 3;
  }

  const [step, setStep] = useState(firstIncompleteStep);
  const [localDone, setLocalDone] = useState({
    whatsapp: status.hasWhatsApp,
    properties: status.hasProperties,
    contacts: status.hasContacts,
  });

  const allDone = localDone.whatsapp && localDone.properties && localDone.contacts;

  const steps: StepDef[] = [
    { id: 'whatsapp', label: 'Connect WhatsApp', done: localDone.whatsapp },
    { id: 'property', label: 'Add property', done: localDone.properties },
    { id: 'contact', label: 'Get a lead', done: localDone.contacts },
  ];

  async function advanceStep(doneKey: keyof typeof localDone) {
    const updated = { ...localDone, [doneKey]: true };
    setLocalDone(updated);
    // Move to next incomplete step
    if (!updated.whatsapp) { setStep(0); return; }
    if (!updated.properties) { setStep(1); return; }
    if (!updated.contacts) { setStep(2); return; }
    setStep(3);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg bg-[#0d1424] border border-slate-700/60 rounded-2xl shadow-2xl p-8">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          aria-label="Skip setup"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        {!allDone && step < 3 && (
          <div className="mb-6">
            <div className="text-xs text-slate-500 mb-1">Getting started</div>
            <h1 className="text-lg font-bold text-white">Set up your ConvoReal workspace</h1>
          </div>
        )}

        {/* Step indicator */}
        {!allDone && step < 3 && <StepIndicator steps={steps} current={step} />}

        {/* Content */}
        {allDone || step === 3 ? (
          <AllDone onClose={onDismiss} />
        ) : step === 0 ? (
          <StepWhatsApp onDone={() => advanceStep('whatsapp')} />
        ) : step === 1 ? (
          <StepProperty onDone={() => advanceStep('properties')} onRefresh={onRefresh} />
        ) : (
          <StepContact onDone={() => advanceStep('contacts')} onRefresh={onRefresh} />
        )}

        {/* Dot navigation */}
        {!allDone && step < 3 && (
          <div className="flex justify-center gap-1.5 mt-8">
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'bg-primary w-4' : s.done ? 'bg-emerald-500 w-1.5' : 'bg-slate-700 w-1.5'
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
