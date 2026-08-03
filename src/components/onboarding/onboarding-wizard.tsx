'use client';

// ============================================================
// First-run wizard for consultants. Assumes a user who has never
// touched a CRM: every step explains WHY before HOW, carries an
// illustration (upgraded to a walkthrough video via the media
// registry once recorded), and offers one clearly-recommended
// action plus an escape hatch.
//
// The three tracked steps mirror /api/onboarding/status —
// WhatsApp connected, first property, first lead — and the
// WhatsApp step hands off to the guided Meta setup at
// /settings/whatsapp-setup rather than dumping a naive user into
// a credentials form.
// ============================================================

import { useState } from 'react';
import {
  MessageCircle,
  Building2,
  Users,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  RefreshCw,
  Forward,
  Bot,
  Compass,
  Copy,
  KeyRound,
  Mail,
  Share2,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepMedia } from '@/components/onboarding/step-media';
import {
  ChatIllustration,
  EmailLeadIllustration,
  PropertyParseIllustration,
  LeadFlowIllustration,
} from '@/components/onboarding/illustrations';
import type { OnboardingStatus } from '@/hooks/useOnboarding';

interface Props {
  status: OnboardingStatus;
  onDismiss: () => void;
  onRefresh: () => Promise<void>;
  onSkipEmailLeads: () => void;
}

function HowItWorks({
  items,
}: {
  items: { icon: React.ReactNode; label: string; sub: string }[];
}) {
  return (
    <div className="space-y-2">
      {items.map((step, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60">
            {step.icon}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{step.label}</p>
            <p className="mt-0.5 text-xs text-slate-400">{step.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="bg-primary/15 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
          <Compass className="text-primary h-8 w-8" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Welcome — here&apos;s how ConvoReal works
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Your whole business runs through one WhatsApp number. Buyers message
          it, listings go out from it, and everything lands here — organised,
          searchable, and followed up automatically.
        </p>
      </div>

      <StepMedia slug="engine-welcome" title="How ConvoReal works">
        <ChatIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <MessageCircle className="size-4 text-emerald-400" />,
            label: '1 · Connect your WhatsApp number',
            sub: 'One-time setup. We walk you through every screen — no tech knowledge needed.',
          },
          {
            icon: <Building2 className="size-4 text-blue-400" />,
            label: '2 · Add your first property',
            sub: 'Forward any listing message and AI turns it into a shareable page.',
          },
          {
            icon: <Users className="size-4 text-violet-400" />,
            label: '3 · Watch leads arrive',
            sub: 'Every enquiry becomes a contact by itself. You just reply.',
          },
        ]}
      />

      <Button className="w-full gap-2" onClick={onNext}>
        Start setup — takes a few minutes <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Step 1: Connect WhatsApp ──────────────────────────────────────────────────

function StepWhatsApp({
  done,
  onDone,
  onRefresh,
}: {
  done: boolean;
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
          <MessageCircle className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">Connect WhatsApp</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          This is the only technical step, and you don&apos;t have to do it
          alone. Our guided setup walks you through Meta&apos;s screens one at a
          time, with pictures of exactly what to click — or we can do the whole
          thing for you.
        </p>
      </div>

      <StepMedia slug="engine-connect-whatsapp" title="Connect WhatsApp">
        <ChatIllustration />
      </StepMedia>

      {done ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          <Check className="size-4" /> WhatsApp is connected
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            className="w-full gap-2"
            onClick={() => window.open('/settings/whatsapp-setup', '_blank')}
          >
            <Compass className="h-4 w-4" /> Open the guided setup
          </Button>
          <Button
            variant="outline"
            className="w-full gap-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => window.open('/settings?tab=whatsapp', '_blank')}
          >
            <KeyRound className="h-4 w-4" /> I already have my API credentials
          </Button>
          <Button
            variant="ghost"
            onClick={checkNow}
            disabled={checking}
            className="w-full gap-2 text-slate-400 hover:text-slate-200"
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> I&apos;ve connected it — check
                now
              </>
            )}
          </Button>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-slate-500 hover:text-slate-300"
        onClick={onDone}
      >
        {done ? 'Continue' : "I'll do this later"}
      </Button>
    </div>
  );
}

// ── Step 2: Add first property ────────────────────────────────────────────────

function StepProperty({
  onDone,
  onRefresh,
}: {
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/15">
          <Building2 className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Add your first property
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          You already have listings sitting in your WhatsApp chats. Forward one
          to your connected number and the AI turns it into a proper listing —
          photos, price, location, everything.
        </p>
      </div>

      <StepMedia
        slug="engine-add-property"
        title="Add a property from WhatsApp"
      >
        <PropertyParseIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <Forward className="size-4 text-blue-400" />,
            label: 'Forward any property listing',
            sub: 'Text, photos, price, location — send it all at once to your ConvoReal number',
          },
          {
            icon: <Bot className="size-4 text-violet-400" />,
            label: 'AI reads the details',
            sub: 'Title, type, price, area, amenities — it shows you a draft to review',
          },
          {
            icon: <Check className="size-4 text-emerald-400" />,
            label: 'Tap Confirm',
            sub: 'The property lands in your inventory with a shareable showcase link',
          },
        ]}
      />

      <p className="text-center text-xs text-slate-500">
        Prefer typing? Go to{' '}
        <b className="text-slate-400">Inventory → Add Property</b> and fill the
        form instead — both end up in the same place.
      </p>

      <div className="flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking} className="w-full gap-2">
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> I&apos;ve added one — check now
            </>
          )}
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

// ── Step 3: Get first lead ────────────────────────────────────────────────────

function StepContact({
  onDone,
  onRefresh,
}: {
  onDone: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15">
          <Users className="h-8 w-8 text-violet-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Get your first lead
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          You never type a lead into ConvoReal — they arrive by themselves the
          moment someone messages your WhatsApp or opens your property link.
        </p>
      </div>

      <StepMedia slug="engine-first-lead" title="How leads arrive">
        <LeadFlowIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <Share2 className="size-4 text-amber-400" />,
            label: 'Share your property link',
            sub: 'Every property has a public page — post it in your groups and status. Interest flows back here.',
          },
          {
            icon: <MessageCircle className="size-4 text-emerald-400" />,
            label: 'Buyer messages your WhatsApp',
            sub: 'The contact and conversation are created automatically in your Inbox',
          },
          {
            icon: <UserPlus className="size-4 text-blue-400" />,
            label: 'Or add someone you already know',
            sub: 'Contacts → Add Contact for a buyer you spoke to before ConvoReal',
          },
        ]}
      />

      <div className="flex flex-col gap-2">
        <Button onClick={checkNow} disabled={checking} className="w-full gap-2">
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> I&apos;ve got a lead — check now
            </>
          )}
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

// ── Step 4: Import portal email leads ─────────────────────────────────────────

function StepEmailLeads({
  done,
  onDone,
  onSkip,
  onRefresh,
}: {
  done: boolean;
  onDone: () => void;
  onSkip: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
    onDone();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15">
          <Mail className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">
          Bring in your portal leads
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Getting enquiries on 99acres, MagicBricks or Housing? Set one
          forwarding rule in your email — done once, in about two minutes — and
          every portal lead lands here as a WhatsApp contact, replied to within
          seconds.
        </p>
      </div>

      <StepMedia slug="engine-email-leads" title="Portal leads by email">
        <EmailLeadIllustration />
      </StepMedia>

      <HowItWorks
        items={[
          {
            icon: <Copy className="size-4 text-amber-400" />,
            label: 'Copy your ConvoReal lead address',
            sub: 'Every account has its own. One click in Settings → Other → Email Lead Sourcing',
          },
          {
            icon: <Forward className="size-4 text-blue-400" />,
            label: 'Add a forwarding rule in Gmail / Outlook',
            sub: 'Forward portal emails to that address — the step-by-step guide is on the same screen, and we confirm the rule for you automatically',
          },
          {
            icon: <Bot className="size-4 text-violet-400" />,
            label: 'Leads arrive by themselves',
            sub: 'Name, phone and budget are read from the email, matched to your inventory, and greeted on WhatsApp if you switch auto-reply on',
          },
        ]}
      />

      {done ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          <Check className="size-4" /> Email lead sync is on
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            className="w-full gap-2"
            onClick={() => window.open('/settings?tab=other', '_blank')}
          >
            <Mail className="h-4 w-4" /> Open email lead setup
          </Button>
          <Button
            variant="ghost"
            onClick={checkNow}
            disabled={checking}
            className="w-full gap-2 text-slate-400 hover:text-slate-200"
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> I&apos;ve set it up — check
                now
              </>
            )}
          </Button>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-slate-500 hover:text-slate-300"
        onClick={done ? onDone : onSkip}
      >
        {done ? 'Continue' : "I don't get leads by email — skip"}
      </Button>
    </div>
  );
}

// ── All done ─────────────────────────────────────────────────────────────────

function AllDone({ onClose }: { onClose: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
        <Sparkles className="h-10 w-10 text-emerald-400" />
      </div>
      <div>
        <h2 className="mb-2 text-2xl font-bold text-white">
          You&apos;re all set! 🎉
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          ConvoReal is ready to go. Leads flow into your inbox, your listings
          are shareable, and everything is tracked in one place. If you&apos;re
          ever stuck, the Copilot button at the bottom-right can walk you
          through any screen.
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

function StepIndicator({
  steps,
  current,
}: {
  steps: StepDef[];
  current: number;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
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
              <span className="flex h-3 w-3 items-center justify-center rounded-full border border-current text-[9px]">
                {i + 1}
              </span>
            )}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-4 ${i < current || step.done ? 'bg-primary/40' : 'bg-slate-700'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

// Screen order: welcome (0) → whatsapp (1) → property (2) → lead (3) →
// email leads (4) → done (5). The welcome screen only shows on a completely
// fresh account; a returning user resumes at their first incomplete tracked
// step.

export function OnboardingWizard({
  status,
  onDismiss,
  onRefresh,
  onSkipEmailLeads,
}: Props) {
  function firstIncompleteScreen() {
    if (!status.hasWhatsApp)
      return !status.hasProperties && !status.hasContacts ? 0 : 1;
    if (!status.hasProperties) return 2;
    if (!status.hasContacts) return 3;
    if (!status.hasEmailLeadSync) return 4;
    return 5;
  }

  const [screen, setScreen] = useState(firstIncompleteScreen);
  const [localDone, setLocalDone] = useState({
    whatsapp: status.hasWhatsApp,
    properties: status.hasProperties,
    contacts: status.hasContacts,
    emailLeads: status.hasEmailLeadSync,
  });

  const allDone =
    localDone.whatsapp &&
    localDone.properties &&
    localDone.contacts &&
    localDone.emailLeads;

  const steps: StepDef[] = [
    { id: 'whatsapp', label: 'Connect WhatsApp', done: localDone.whatsapp },
    { id: 'property', label: 'Add property', done: localDone.properties },
    { id: 'contact', label: 'Get a lead', done: localDone.contacts },
    { id: 'email-leads', label: 'Portal leads', done: localDone.emailLeads },
  ];

  function advanceStep(doneKey: keyof typeof localDone) {
    const updated = { ...localDone, [doneKey]: true };
    setLocalDone(updated);
    if (!updated.whatsapp) {
      setScreen(1);
      return;
    }
    if (!updated.properties) {
      setScreen(2);
      return;
    }
    if (!updated.contacts) {
      setScreen(3);
      return;
    }
    if (!updated.emailLeads) {
      setScreen(4);
      return;
    }
    setScreen(5);
  }

  const showChrome = !allDone && screen > 0 && screen < 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-[#0d1424] p-8 shadow-2xl">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          aria-label="Skip setup"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Back — from a tracked step to the welcome explainer */}
        {showChrome && (
          <button
            onClick={() => setScreen(0)}
            className="absolute top-4 left-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            aria-label="Back to overview"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}

        {/* Header */}
        {showChrome && (
          <div className="mt-4 mb-6">
            <div className="mb-1 text-xs text-slate-500">Getting started</div>
            <h1 className="text-lg font-bold text-white">
              Set up your ConvoReal workspace
            </h1>
          </div>
        )}

        {/* Step indicator */}
        {showChrome && <StepIndicator steps={steps} current={screen - 1} />}

        {/* Content */}
        {allDone || screen === 5 ? (
          <AllDone onClose={onDismiss} />
        ) : screen === 0 ? (
          <StepWelcome onNext={() => setScreen(firstIncompleteScreen() || 1)} />
        ) : screen === 1 ? (
          <StepWhatsApp
            done={localDone.whatsapp}
            onDone={() => advanceStep('whatsapp')}
            onRefresh={onRefresh}
          />
        ) : screen === 2 ? (
          <StepProperty
            onDone={() => advanceStep('properties')}
            onRefresh={onRefresh}
          />
        ) : screen === 3 ? (
          <StepContact
            onDone={() => advanceStep('contacts')}
            onRefresh={onRefresh}
          />
        ) : (
          <StepEmailLeads
            done={localDone.emailLeads}
            onDone={() => advanceStep('emailLeads')}
            onSkip={() => {
              onSkipEmailLeads();
              advanceStep('emailLeads');
            }}
            onRefresh={onRefresh}
          />
        )}

        {/* Dot navigation */}
        {showChrome && (
          <div className="mt-8 flex justify-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setScreen(i + 1)}
                className={`h-1.5 rounded-full transition-all ${
                  i + 1 === screen
                    ? 'bg-primary w-4'
                    : s.done
                      ? 'w-1.5 bg-emerald-500'
                      : 'w-1.5 bg-slate-700'
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
